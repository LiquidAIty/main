import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import {
  appendConversationReplyOnce,
  appendConversationTurn,
  getConversationMessages,
  type ConversationMessage,
  type ConversationParticipant,
} from '../conversations/store';
import { BUILDER_CARD_ID } from '../decks/deckDomainClient';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { autoModelCandidates } from '../llm/models.config';
import {
  ensureSavedCardProfile,
  materializeSavedCardProfile,
  savedCardBotRoster,
  type HermesProfileState,
} from '../hermes/profileMaterialization';
import { readToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import {
  hermesGateway,
  type HermesGatewayClient,
  type HermesGatewayEvent,
} from '../services/hermesGateway';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { getOwnedProjectByReference } from '../services/projectStore';
import {
  projectCardAuthority,
  type ProjectCardBinding,
  type ProjectCardAuthority,
} from '../services/projectCardAuthority';
import {
  resolveBuilderProjectCodeDirectory,
  resolveProductChatWorkingDirectory,
} from '../services/workingDirectories';

export const mainSessionRoutes = Router();

const MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const USER_PARTICIPANT: ConversationParticipant = { kind: 'user', label: 'You' };
export type ProjectCardSession = {
  sessionId: string;
  botModeRoster: string[];
  botModeSessions: Record<string, string>;
  profileCapabilityFingerprint: string;
};

type CardSessionBinding = ProjectCardSession & {
  liveHandle: string;
  info: Record<string, unknown>;
};

export type SessionBinding = CardSessionBinding & {
  cardSessions: Record<string, CardSessionBinding>;
};

type SessionScope = {
  cwd?: string;
  projectId?: string;
  projectSessionId?: string;
  userId?: string;
};

type PreparedRun = { runId: string; request: Record<string, any> };

type TurnResult = {
  text: string;
  event: HermesGatewayEvent;
  toolCalls: number;
  speaker: ProjectCardBinding;
  mainCompletion?: { text: string; event: HermesGatewayEvent };
};

const sessionBindingTails = new Map<string, Promise<void>>();

async function withSessionBindingLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionBindingTails.get(key) || Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => completion);
  sessionBindingTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (sessionBindingTails.get(key) === tail) sessionBindingTails.delete(key);
  }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function exactStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

function savedCardReasoningEffort(card: ProjectCardBinding): string {
  const value = String(card.card.runtimeOptions?.reasoningEffort || '').trim().toLowerCase();
  if (value && !CARD_REASONING_EFFORTS.has(value)) {
    throw new Error(`hermes_card_reasoning_effort_invalid:${card.profile}`);
  }
  return value;
}

type ProjectAuthorization = { userId: string; projectSessionId: string };

async function authorizeProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<ProjectAuthorization | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'main_owner_authentication_required' });
    return null;
  }
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'main_project_access_denied' });
    return null;
  }
  const projectSessionId = String(project.id || '').trim();
  if (!projectSessionId) throw new Error('main_project_identity_missing');
  return { userId, projectSessionId };
}

function participant(card: ProjectCardBinding): ConversationParticipant {
  return {
    kind: 'card',
    label: card.title,
    cardId: card.card.id,
    profile: card.profile,
    ...(card.address ? { address: card.address } : {}),
  };
}

function cardsByProfile(authority: ProjectCardAuthority): Map<string, ProjectCardBinding> {
  const cards = new Map<string, ProjectCardBinding>();
  for (const card of authority.cards) {
    if (card.card.runtime.kind !== 'hermes') continue;
    const profile = card.profile.toLowerCase();
    if (cards.has(profile)) throw new Error(`hermes_profile_card_ambiguous:${profile}`);
    cards.set(profile, card);
  }
  return cards;
}

function mainBotRosterCards(authority: ProjectCardAuthority): ProjectCardBinding[] {
  const indexed = cardsByProfile(authority);
  return savedCardBotRoster(authority.deck, authority.main.card).map((profile) => {
    const card = indexed.get(profile.toLowerCase());
    if (!card) throw new Error(`hermes_bot_roster_card_missing:${profile}`);
    return card;
  });
}

function explicitlyAddressedCard(
  message: string,
  roster: ProjectCardBinding[],
): ProjectCardBinding | null {
  const match = /^\s*@([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/i.exec(message);
  if (!match) return null;
  const matches = roster.filter((card) => card.aliases.includes(match[1].toLowerCase()));
  if (matches.length > 1) throw new Error(`main_address_ambiguous:${match[1].toLowerCase()}`);
  return matches[0] || null;
}

function messageAgentTargetMatchesCard(value: unknown, card: ProjectCardBinding): boolean {
  const target = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return Boolean(target) && card.aliases.includes(target);
}

function botMentionInput(message: string, target: ProjectCardBinding | null): string {
  if (!target) return message;
  return `${message}\n\n[@mention resolved from the current Project's saved Bot Mode roster: `
    + `@${target.address || target.profile} = saved Card "${target.title}", `
    + `Hermes message_agent target "${target.profile}". Compose the message for that Card and send it `
    + `with message_agent; do not forward the user's text verbatim. This is an explicitly addressed `
    + `turn: after the queued dispatch acknowledgement, finish with Hermes's exact [SILENT] marker, `
    + `never a blank response or a second Main answer. The recipient session presents `
    + `its own answer directly; when its successful completion notice later arrives, return [SILENT] `
    + `again rather than adding or rewriting that answer. A real delivery failure remains visible.]`;
}

function participantFromStoredMessage(
  message: ConversationMessage,
  kind: 'shared_chat_speaker' | 'shared_chat_target',
): ConversationParticipant | null {
  // These persisted activity-kind values are read compatibility for existing
  // conversation rows. They do not identify or create a separate chat runtime.
  const activity = message.visibleActivities?.find((item) => item.kind === kind);
  if (!activity?.label) return null;
  return {
    kind: activity.status === 'user' ? 'user' : 'card',
    label: activity.label,
    ...(activity.cardId ? { cardId: activity.cardId } : {}),
    ...(activity.profile ? { profile: activity.profile } : {}),
    ...(activity.address ? { address: activity.address } : {}),
  };
}

function mainConversationMessage(message: ConversationMessage) {
  const speaker = participantFromStoredMessage(message, 'shared_chat_speaker')
    || (message.role === 'user' ? USER_PARTICIPANT : null);
  if (!speaker || (message.role !== 'user' && message.role !== 'assistant')) return null;
  const target = participantFromStoredMessage(message, 'shared_chat_target');
  return {
    messageId: message.messageId,
    seq: message.seq,
    role: message.role,
    text: message.content,
    speaker,
    ...(target ? { target } : {}),
  };
}

function sessionRows(value: unknown): Array<Record<string, any>> {
  const rows = record(value).sessions;
  if (!Array.isArray(rows)) throw new Error('hermes_session_list_invalid');
  return rows.map(record);
}

function sessionResult(
  value: unknown,
  botModeRoster: string[],
  botModeSessions: Record<string, string>,
  profileCapabilityFingerprint: string,
): CardSessionBinding {
  const result = record(value);
  const liveHandle = String(result.session_id || '').trim();
  const sessionId = String(result.stored_session_id || result.session_key || '').trim();
  if (!liveHandle || !sessionId) throw new Error('hermes_session_binding_invalid');
  return {
    liveHandle,
    sessionId,
    info: record(result.info),
    botModeRoster: [...botModeRoster],
    botModeSessions: { ...botModeSessions },
    profileCapabilityFingerprint,
  };
}

function projectSessionTitle(projectSessionId: string): string {
  const identity = String(projectSessionId || '').trim();
  if (!identity) throw new Error('hermes_project_session_identity_missing');
  return `Project ${identity}`;
}

function sessionCwd(
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  selected: ProjectCardBinding,
  scope: SessionScope,
): string {
  if (card.profile.toLowerCase() === selected.profile.toLowerCase() && scope.cwd) return scope.cwd;
  if (card.card.id === BUILDER_CARD_ID && scope.projectId) {
    return resolveBuilderProjectCodeDirectory(
      String(scope.projectSessionId || scope.projectId),
      authority.deck.projectCodeFolder,
    );
  }
  if (card.card.runtime.mode === 'main') return resolveProductChatWorkingDirectory();
  const identity = [scope.userId, scope.projectSessionId || scope.projectId, card.card.id]
    .map((value) => String(value || '').trim()).filter(Boolean).join(':');
  return resolveProductChatWorkingDirectory(identity || undefined);
}

function projectAgentCards(authority: ProjectCardAuthority): ProjectCardBinding[] {
  const indexed = cardsByProfile(authority);
  for (const card of indexed.values()) {
    for (const targetProfile of savedCardBotRoster(authority.deck, card.card)) {
      if (!indexed.has(targetProfile.toLowerCase())) {
        throw new Error(`hermes_bot_roster_card_missing:${targetProfile}`);
      }
    }
  }
  return [...indexed.values()].filter((card) => card.card.runtime.mode !== 'magentic_one');
}

function activeProjectCards(
  authority: ProjectCardAuthority,
  selected: ProjectCardBinding,
): ProjectCardBinding[] {
  const indexed = cardsByProfile(authority);
  const active = new Map<string, ProjectCardBinding>();
  const pending = [selected];
  while (pending.length) {
    const card = pending.shift()!;
    const profile = card.profile.toLowerCase();
    if (active.has(profile)) continue;
    active.set(profile, card);
    for (const targetProfile of savedCardBotRoster(authority.deck, card.card)) {
      const target = indexed.get(targetProfile.toLowerCase());
      if (!target) throw new Error(`hermes_bot_roster_card_missing:${targetProfile}`);
      pending.push(target);
    }
  }
  return [...active.values()];
}

async function ensureProjectCardSession(args: {
  client: HermesGatewayClient;
  card: ProjectCardBinding;
  profileState: HermesProfileState;
  roster: string[];
  cwd: string;
  projectSessionId: string;
}): Promise<ProjectCardSession> {
  const { client, card, profileState, roster, cwd, projectSessionId } = args;
  const profile = card.profile;
  const reasoningEffort = savedCardReasoningEffort(card);
  const fingerprint = String(profileState.capability_fingerprint || '').trim();
  if (!/^[0-9a-f]{12}$/.test(fingerprint)) {
    throw new Error(`hermes_profile_capability_fingerprint_invalid:${profile}`);
  }
  const title = projectSessionTitle(projectSessionId);
  return withSessionBindingLock(JSON.stringify([profile, title]), async () => {
    const list = async () => sessionRows(await client.request('session.list', {
      profile,
      title,
      include_hidden: true,
      limit: 200,
    }));
    const stored = (row: Record<string, any>): ProjectCardSession => {
      const sessionId = String(row.resolved_id || row.id || '').trim();
      if (!sessionId) throw new Error('hermes_session_binding_invalid');
      return {
        sessionId,
        botModeRoster: [...roster],
        botModeSessions: {},
        profileCapabilityFingerprint: fingerprint,
      };
    };
    const existing = await list();
    if (existing.length > 1) throw new Error(`hermes_session_binding_ambiguous:${profile}`);
    if (existing.length === 1) return stored(existing[0]);
    let createdSessionId = '';
    try {
      const created = sessionResult(await client.request('session.create', {
        profile,
        title,
        cwd,
        source: 'desktop',
        model: String(profileState.model?.default || ''),
        provider: String(profileState.model?.provider || ''),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        hidden: true,
        close_on_disconnect: false,
        follow_profile_config: false,
        bot_mode_roster: roster,
      }), roster, {}, fingerprint);
      createdSessionId = created.liveHandle;
      await client.request('session.title', { session_id: created.liveHandle, title });
      await client.request('session.close', { session_id: created.liveHandle });
    } catch (error) {
      if (createdSessionId) {
        await client.request('session.close', { session_id: createdSessionId }).catch(() => undefined);
      }
      const adopted = await list();
      if (adopted.length === 1) return stored(adopted[0]);
      throw error;
    }
    const readback = await list();
    if (readback.length !== 1) throw new Error(`hermes_project_session_readback_invalid:${profile}`);
    return stored(readback[0]);
  });
}

async function resumeProjectCardSession(args: {
  client: HermesGatewayClient;
  card: ProjectCardBinding;
  profileState: HermesProfileState;
  stored: ProjectCardSession;
}): Promise<CardSessionBinding> {
  const { client, card, profileState, stored } = args;
  const resumed = sessionResult(await client.request('session.resume', {
    session_id: stored.sessionId,
    profile: card.profile,
    omit_messages: true,
    close_on_disconnect: false,
    bot_mode_roster: stored.botModeRoster,
    bot_mode_sessions: stored.botModeSessions,
  }), stored.botModeRoster, stored.botModeSessions, stored.profileCapabilityFingerprint);
  let activated = sessionResult(await client.request('session.activate', {
    session_id: resumed.liveHandle,
    profile: card.profile,
    omit_messages: true,
    bot_mode_roster: stored.botModeRoster,
    bot_mode_sessions: stored.botModeSessions,
    expected_profile_capability_fingerprint: stored.profileCapabilityFingerprint,
  }), stored.botModeRoster, stored.botModeSessions, stored.profileCapabilityFingerprint);
  if (
    activated.liveHandle !== resumed.liveHandle
    || activated.sessionId !== resumed.sessionId
  ) throw new Error(`hermes_project_session_activation_mismatch:${card.profile}`);
  const desiredProvider = String(profileState.model?.provider || '').trim();
  const desiredModel = String(profileState.model?.default || '').trim();
  const desiredReasoningEffort = savedCardReasoningEffort(card);
  if (!desiredProvider || !desiredModel) {
    throw new Error(`hermes_project_session_model_missing:${card.profile}`);
  }
  if (
    String(activated.info.provider || '').trim() !== desiredProvider
    || String(activated.info.model || '').trim() !== desiredModel
  ) {
    const changed = record(await client.request('config.set', {
      profile: card.profile,
      session_id: activated.liveHandle,
      key: 'model',
      value: `${desiredModel} --provider ${desiredProvider} --session`,
      scope: 'session',
      confirm_expensive_model: false,
    }));
    if (
      String(changed.key || '') !== 'model'
      || String(changed.value || '') !== desiredModel
      || String(changed.scope || '') !== 'session'
      || changed.deferred === true
      || changed.confirm_required === true
    ) throw new Error(`hermes_project_session_model_apply_failed:${card.profile}`);
    activated = sessionResult(await client.request('session.activate', {
      session_id: activated.liveHandle,
      profile: card.profile,
      omit_messages: true,
      bot_mode_roster: stored.botModeRoster,
      bot_mode_sessions: stored.botModeSessions,
      expected_profile_capability_fingerprint: stored.profileCapabilityFingerprint,
    }), stored.botModeRoster, stored.botModeSessions, stored.profileCapabilityFingerprint);
  }
  if (
    desiredReasoningEffort
    && String(activated.info.reasoning_effort || '').trim().toLowerCase()
      !== desiredReasoningEffort
  ) {
    const changed = record(await client.request('config.set', {
      profile: card.profile,
      session_id: activated.liveHandle,
      key: 'reasoning',
      value: desiredReasoningEffort,
      scope: 'session',
    }));
    if (
      String(changed.key || '') !== 'reasoning'
      || String(changed.value || '').trim().toLowerCase() !== desiredReasoningEffort
    ) throw new Error(`hermes_project_session_reasoning_apply_failed:${card.profile}`);
    activated = sessionResult(await client.request('session.activate', {
      session_id: activated.liveHandle,
      profile: card.profile,
      omit_messages: true,
      bot_mode_roster: stored.botModeRoster,
      bot_mode_sessions: stored.botModeSessions,
      expected_profile_capability_fingerprint: stored.profileCapabilityFingerprint,
    }), stored.botModeRoster, stored.botModeSessions, stored.profileCapabilityFingerprint);
  }
  if (
    activated.liveHandle !== resumed.liveHandle
    || activated.sessionId !== resumed.sessionId
    || String(activated.info.provider || '').trim() !== desiredProvider
    || String(activated.info.model || '').trim() !== desiredModel
    || (desiredReasoningEffort
      && String(activated.info.reasoning_effort || '').trim().toLowerCase()
        !== desiredReasoningEffort)
  ) throw new Error(`hermes_project_session_model_readback_mismatch:${card.profile}`);
  return {
    ...activated,
    info: {
      provider: desiredProvider,
      model: desiredModel,
      ...activated.info,
    },
  };
}

async function projectSessionCatalog(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  selected: ProjectCardBinding = authority.main,
  scope: SessionScope = {},
): Promise<{
  sessions: Record<string, CardSessionBinding>;
}> {
  const projectCards = [...cardsByProfile(authority).values()];
  const requiredCards = projectAgentCards(authority);
  const projectSessionId = String(scope.projectSessionId || scope.projectId || '').trim();
  if (!projectSessionId) throw new Error('hermes_project_session_identity_missing');
  if (!requiredCards.some((card) => card.card.id === selected.card.id)) {
    throw new Error(`hermes_session_card_unavailable:${selected.card.id}`);
  }
  const request = <T>(method: string, params: Record<string, unknown> = {}) => client.request<T>(method, params);
  const provisioned = new Map<string, HermesProfileState>();
  for (const card of projectCards) {
    provisioned.set(card.profile.toLowerCase(), await ensureSavedCardProfile(request, card.card));
  }
  const profiles = new Map<string, HermesProfileState>();
  for (const card of projectCards) {
    const profile = card.profile.toLowerCase();
    profiles.set(profile, await materializeSavedCardProfile(
      request,
      card.card,
      savedCardBotRoster(authority.deck, card.card),
      provisioned.get(profile),
    ));
  }
  const sessions: Record<string, ProjectCardSession> = {};
  for (const card of requiredCards) {
    const profile = card.profile.toLowerCase();
    sessions[profile] = await ensureProjectCardSession({
      client,
      card,
      profileState: profiles.get(profile)!,
      roster: savedCardBotRoster(authority.deck, card.card),
      cwd: sessionCwd(authority, card, selected, scope),
      projectSessionId,
    });
  }
  for (const card of requiredCards) {
    const profile = card.profile.toLowerCase();
    sessions[profile].botModeSessions = Object.fromEntries(
      sessions[profile].botModeRoster.map((targetProfile) => {
        const target = sessions[targetProfile.toLowerCase()];
        if (!target) throw new Error(`hermes_bot_roster_session_missing:${targetProfile}`);
        return [targetProfile, target.sessionId];
      }),
    );
  }
  const liveSessions: Record<string, CardSessionBinding> = {};
  for (const card of activeProjectCards(authority, selected)) {
    const profile = card.profile.toLowerCase();
    liveSessions[profile] = await resumeProjectCardSession({
      client,
      card,
      profileState: profiles.get(profile)!,
      stored: sessions[profile],
    });
  }
  return { sessions: liveSessions };
}

export async function cardProjectSession(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  selected: ProjectCardBinding,
  scope: SessionScope,
): Promise<ProjectCardSession> {
  const { sessions } = await projectSessionCatalog(client, authority, selected, scope);
  const selectedSession = sessions[selected.profile.toLowerCase()];
  if (!selectedSession) throw new Error(`hermes_session_binding_missing:${selected.profile}`);
  return selectedSession;
}

export async function cardSession(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  selected: ProjectCardBinding = authority.main,
  scope: SessionScope = {},
): Promise<SessionBinding> {
  const { sessions } = await projectSessionCatalog(client, authority, selected, scope);
  const selectedProfile = selected.profile.toLowerCase();
  const selectedBinding = sessions[selectedProfile];
  if (!selectedBinding) throw new Error(`hermes_session_binding_missing:${selected.profile}`);
  return { ...selectedBinding, cardSessions: sessions };
}

async function ensureSavedCardTurnModel(args: {
  client: HermesGatewayClient;
  binding: CardSessionBinding;
  profile: string;
  runRequest: Record<string, unknown>;
}): Promise<void> {
  const provider = record(args.runRequest.provider);
  const desiredModel = String(provider.providerModelId || '').trim();
  const liveProvider = String(args.binding.info.provider || '').trim();
  if (!desiredModel || !liveProvider) throw new Error('hermes_session_model_binding_invalid');
  if (String(args.binding.info.model || '').trim() !== desiredModel) {
    const changed = record(await args.client.request('config.set', {
      profile: args.profile,
      session_id: args.binding.liveHandle,
      key: 'model',
      value: `${desiredModel} --provider ${liveProvider} --session`,
      scope: 'session',
      confirm_expensive_model: false,
    }));
    if (
      String(changed.key || '') !== 'model'
      || String(changed.value || '') !== desiredModel
      || String(changed.scope || '') !== 'session'
      || changed.deferred === true
      || changed.confirm_required === true
    ) throw new Error('hermes_session_model_apply_failed');
  }
  const activated = record(await args.client.request('session.activate', {
    profile: args.profile,
    session_id: args.binding.liveHandle,
    omit_messages: true,
    bot_mode_roster: args.binding.botModeRoster,
    bot_mode_sessions: args.binding.botModeSessions,
  }));
  const info = record(activated.info);
  const mismatches = [
    ...(String(activated.session_id || '') === args.binding.liveHandle ? [] : ['live_session_id']),
    ...(String(activated.stored_session_id || activated.session_key || '')
      === args.binding.sessionId ? [] : ['stored_session_id']),
    ...(activated.messages_omitted === true ? [] : ['messages_omitted']),
    ...(String(info.provider || '') === liveProvider ? [] : ['provider']),
    ...(String(info.model || '') === desiredModel ? [] : ['model']),
  ];
  if (mismatches.length) throw new Error(`hermes_session_model_readback_mismatch:${mismatches.join(',')}`);
  args.binding.info = info;
}

async function prepareRun(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  message: string;
  target: ProjectCardBinding;
  dataAnchors: unknown[];
  images: unknown[];
}): Promise<PreparedRun> {
  const runId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const catalog = await readToolCatalog();
  const prepared = record(await requestPythonRailsJson('/domain/runs/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      cardId: args.target.card.id,
      runId,
      correlationId: runId,
      conversationId: args.conversationId,
      assignment: args.message,
      dataAnchors: args.dataAnchors,
      images: args.images,
      discoveredTools: catalog.tools,
      discoveredToolCatalogState: catalog.state,
      unavailableToolCatalogFamilies: catalog.unavailableFamilies,
      discoveredToolFailures: catalog.toolFailures,
      autoModelCandidates,
    }),
  }));
  const transport = record(prepared.hermesTransport);
  const request = record(transport.request);
  if (
    String(prepared.runId || '') !== runId
    || String(transport.cardIdentity?.cardId || '') !== args.target.card.id
    || String(request.runtime?.profile || '') !== args.target.profile
    || !String(request.message || '').trim()
  ) throw new Error('saved_card_preparation_identity_mismatch');
  return { runId, request };
}

async function startRun(run: PreparedRun, binding: CardSessionBinding, event: HermesGatewayEvent): Promise<void> {
  const submissionId = String(event.payload?.submission_id || '').trim();
  if (submissionId !== run.runId) throw new Error('run_submission_identity_mismatch');
  const started = record(await requestPythonRailsJson('/domain/runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: run.runId,
      correlationId: run.runId,
      submissionId,
      hermesSessionRef: binding.sessionId,
    }),
  }));
  if (
    started.ok !== true
    || String(started.runId || '') !== run.runId
    || String(started.correlationId || '') !== run.runId
    || String(started.submissionId || '') !== run.runId
    || String(started.state || '') !== 'running'
  ) throw new Error('run_submission_start_readback_mismatch');
}

async function attachImages(
  client: HermesGatewayClient,
  binding: CardSessionBinding,
  profile: string,
  images: unknown,
): Promise<void> {
  if (!Array.isArray(images)) return;
  for (const [index, raw] of images.entries()) {
    const image = record(raw);
    const dataUrl = String(image.dataUrl || '').trim();
    if (!dataUrl) continue;
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw new Error('attachment_image_invalid');
    await client.request('image.attach_bytes', {
      session_id: binding.liveHandle,
      profile,
      content_base64: match[2],
      filename: String(image.name || `attachment-${index + 1}.png`),
    });
  }
}

function writeSse(res: Response, eventName: string, payload: Record<string, unknown>): boolean {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  return true;
}

async function submitTurn(args: {
  client: HermesGatewayClient;
  binding: SessionBinding;
  main: ProjectCardBinding;
  directRecipient: ProjectCardBinding | null;
  text: string;
  submissionId: string;
  onEvent(event: HermesGatewayEvent, speaker: ProjectCardBinding): void;
}): Promise<TurnResult> {
  const recipientBinding = args.directRecipient
    ? args.binding.cardSessions[args.directRecipient.profile.toLowerCase()]
    : null;
  if (args.directRecipient && !recipientBinding) {
    throw new Error(`hermes_recipient_session_missing:${args.directRecipient.profile}`);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let toolCalls = 0;
    let ownTurnStarted = false;
    let ownTurnCompleted = false;
    let messageAgentStarted = false;
    let messageAgentConfirmed = false;
    let consultationError: Error | null = null;
    let addressedToolId: string | null = null;
    let expectedRecipientSubmissionId: string | null = null;
    let activeRecipientSubmissionId: string | null = null;
    let mainCompletion: { text: string; event: HermesGatewayEvent } | null = null;
    let recipientCompletion: { text: string; event: HermesGatewayEvent } | null = null;
    let recipientError: Error | null = null;
    const pendingRecipientEvents = new Map<string, HermesGatewayEvent[]>();
    let timer: ReturnType<typeof setTimeout>;
    let detach: () => void = () => undefined;
    const finish = (error?: Error, value?: TurnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach();
      if (error) reject(error);
      else resolve(value!);
    };
    const finishRecipientIfReady = () => {
      if (!ownTurnCompleted) return;
      if (recipientError) finish(recipientError);
      else if (recipientCompletion && args.directRecipient) {
        if (!mainCompletion) return;
        finish(undefined, {
          ...recipientCompletion,
          toolCalls,
          speaker: args.directRecipient,
          mainCompletion,
        });
      }
    };
    const observeRecipientEvent = (event: HermesGatewayEvent) => {
      args.onEvent(event, args.directRecipient!);
      if (event.type === 'error') {
        recipientError = new Error(String(event.payload?.message || 'hermes_recipient_turn_failed'));
        finishRecipientIfReady();
        return;
      }
      if (event.type !== 'message.complete') return;
      const status = String(event.payload?.status || 'complete');
      const text = String(event.payload?.text || '');
      if (['error', 'failed'].includes(status)) {
        recipientError = new Error(String(event.payload?.error || text || 'hermes_recipient_turn_failed'));
      } else recipientCompletion = { text, event };
      finishRecipientIfReady();
    };
    const flushExpectedRecipientEvents = () => {
      if (!expectedRecipientSubmissionId) return;
      const events = pendingRecipientEvents.get(expectedRecipientSubmissionId) || [];
      pendingRecipientEvents.delete(expectedRecipientSubmissionId);
      for (const event of events) observeRecipientEvent(event);
    };
    detach = args.client.onEvent((event) => {
      if (recipientBinding && event.session_id === recipientBinding.liveHandle) {
        if (!addressedToolId && !expectedRecipientSubmissionId) return;
        const eventSubmissionId = String(event.payload?.submission_id || '').trim();
        if (event.type === 'prompt.submission.started') {
          if (!eventSubmissionId) return;
          activeRecipientSubmissionId = eventSubmissionId;
        }
        const recipientSubmissionId = eventSubmissionId || activeRecipientSubmissionId;
        if (!recipientSubmissionId) return;
        if (recipientSubmissionId === expectedRecipientSubmissionId) observeRecipientEvent(event);
        else {
          const buffered = pendingRecipientEvents.get(recipientSubmissionId) || [];
          buffered.push(event);
          pendingRecipientEvents.set(recipientSubmissionId, buffered);
        }
        if (event.type === 'message.complete' || event.type === 'error') {
          activeRecipientSubmissionId = null;
        }
        return;
      }
      if (event.session_id !== args.binding.liveHandle) return;
      const eventSubmissionId = String(event.payload?.submission_id || '');
      if (event.type === 'prompt.submission.started') {
        if (eventSubmissionId !== args.submissionId) return;
        ownTurnStarted = true;
      }
      if (!ownTurnStarted) return;
      if (eventSubmissionId && eventSubmissionId !== args.submissionId) return;
      args.onEvent(event, args.main);
      if (event.type === 'tool.start') {
        toolCalls += 1;
        if (String(event.payload?.name || '') === 'message_agent') {
          messageAgentStarted = true;
          if (
            args.directRecipient
            && messageAgentTargetMatchesCard(record(event.payload?.args).target, args.directRecipient)
          ) {
            const toolId = String(event.payload?.tool_id || '').trim();
            if (!toolId) recipientError = new Error('hermes_addressed_delivery_identity_missing');
            else if (addressedToolId && addressedToolId !== toolId) {
              recipientError = new Error('hermes_addressed_delivery_duplicate');
            } else addressedToolId = toolId;
          }
        }
      }
      if (
        event.type === 'tool.complete'
        && String(event.payload?.name || '') === 'message_agent'
      ) {
        const result = record(event.payload?.result);
        if (!args.directRecipient) {
          const deliveryId = String(result.delivery_id || '').trim();
          const processId = String(result.process_id || '').trim();
          if (
            String(result.status || '') !== 'queued'
            || !deliveryId
            || !processId
            || String(result.reply_delivery || 'notification') !== 'notification'
            || result.notification_error
          ) consultationError = new Error('hermes_consultation_delivery_not_confirmed');
          else messageAgentConfirmed = true;
        } else if (String(event.payload?.tool_id || '').trim() === addressedToolId) {
          const deliveryId = String(result.delivery_id || '').trim();
          if (String(result.status || '') !== 'queued' || !deliveryId) {
            recipientError = new Error('hermes_addressed_delivery_not_queued');
          } else {
            expectedRecipientSubmissionId = `__bot_dm__${deliveryId}`;
            flushExpectedRecipientEvents();
          }
        }
      }
      if (event.type === 'error') {
        finish(new Error(String(event.payload?.message || 'hermes_turn_failed')));
        return;
      }
      if (event.type !== 'message.complete') return;
      const status = String(event.payload?.status || 'complete');
      const text = String(event.payload?.text || '');
      if (['error', 'failed'].includes(status)) {
        finish(new Error(String(event.payload?.error || text || 'hermes_turn_failed')));
        return;
      }
      if (eventSubmissionId === args.submissionId) {
        if (args.directRecipient) {
          ownTurnCompleted = true;
          mainCompletion = { text, event };
          if (!addressedToolId) {
            finish(new Error('hermes_addressed_delivery_missing'));
            return;
          }
          if (!expectedRecipientSubmissionId && !recipientError) {
            recipientError = new Error('hermes_addressed_delivery_unconfirmed');
          }
          finishRecipientIfReady();
          return;
        }
        if (!args.directRecipient && messageAgentStarted) {
          ownTurnCompleted = true;
          if (consultationError) {
            finish(consultationError);
            return;
          }
          if (!messageAgentConfirmed) {
            finish(new Error('hermes_consultation_delivery_unconfirmed'));
            return;
          }
          return;
        }
        finish(undefined, { text, event, toolCalls, speaker: args.main });
        return;
      }
      if (!ownTurnCompleted) return;
      if (args.directRecipient) return;
      finish(undefined, {
        text,
        event,
        toolCalls,
        speaker: args.main,
      });
    });
    timer = setTimeout(() => finish(new Error('hermes_turn_timeout')), 30 * 60_000);
    timer.unref?.();
    void args.client.request<Record<string, unknown>>('prompt.submit', {
      session_id: args.binding.liveHandle,
      profile: args.main.profile,
      text: args.text,
      queued: true,
      submission_id: args.submissionId,
      bot_mode_roster: args.binding.botModeRoster,
      bot_mode_sessions: args.binding.botModeSessions,
      expected_profile_capability_fingerprint: args.binding.profileCapabilityFingerprint,
    }).then((submitted) => {
      const status = String(submitted.status || 'streaming');
      if (!['streaming', 'queued'].includes(status)) {
        finish(new Error(`hermes_submit_status_unsupported:${status || 'missing'}`));
      }
    }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

function usageFields(event: HermesGatewayEvent): Record<string, number | null> {
  const usage = record(event.payload?.usage);
  const number = (...values: unknown[]): number | null => {
    const value = values.find((item) => typeof item === 'number' && Number.isFinite(item));
    return typeof value === 'number' ? value : null;
  };
  return {
    providerInputTokens: number(usage.input, usage.prompt, usage.input_tokens),
    providerOutputTokens: number(usage.output, usage.completion, usage.output_tokens),
    providerCachedTokens: number(usage.cached, usage.cached_tokens),
    providerReasoningTokens: number(usage.reasoning, usage.reasoning_tokens),
    totalCostUsd: number(usage.cost_usd, usage.total_cost_usd),
  };
}

async function finishRun(args: {
  run: PreparedRun;
  binding: CardSessionBinding;
  result?: TurnResult;
  error?: unknown;
}): Promise<void> {
  const provider = record(args.binding.info);
  const runtimeOptions = record(args.run.request.runtimeOptions);
  const requestedProvider = record(args.run.request.provider);
  const usage = args.result ? usageFields(args.result.event) : {};
  await requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: args.run.runId,
      state: args.error ? 'failed' : 'completed',
      finalResult: args.result?.text,
      errorCode: args.error ? 'hermes_turn_failed' : undefined,
      errorSummary: args.error instanceof Error ? args.error.message : args.error ? String(args.error) : undefined,
      hermesSessionRef: args.binding.sessionId,
      providerTurnRef: args.result
        ? String(args.result.event.payload?.submission_id || args.run.runId)
        : undefined,
      effectiveProvider: String(provider.provider || requestedProvider.provider || ''),
      providerApiMode: String(runtimeOptions.openaiRuntime || ''),
      model: String(provider.model || requestedProvider.providerModelId || ''),
      provider: String(provider.provider || requestedProvider.provider || ''),
      toolCallCount: args.result?.toolCalls ?? 0,
      ...usage,
    }),
  });
}

mainSessionRoutes.post('/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const message = String(req.body?.message || '');
  const clientMessageId = String(req.body?.clientMessageId || '').trim();
  const clientReplyMessageId = String(req.body?.clientReplyMessageId || '').trim();
  if (!projectId || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'project_message_required' });
  }
  if (
    !MESSAGE_ID_PATTERN.test(clientMessageId)
    || !MESSAGE_ID_PATTERN.test(clientReplyMessageId)
    || clientMessageId === clientReplyMessageId
  ) return res.status(400).json({ ok: false, error: 'main_conversation_message_identity_invalid' });
  let authorization: ProjectAuthorization | null;
  try {
    authorization = await authorizeProject(req, res, projectId);
  } catch {
    return res.status(503).json({ ok: false, error: 'main_project_authority_unavailable' });
  }
  if (!authorization) return undefined;
  const { userId, projectSessionId } = authorization;
  const conversationId = projectSessionId;

  let authority: ProjectCardAuthority;
  let main: ProjectCardBinding;
  let addressedTarget: ProjectCardBinding | null;
  try {
    authority = await projectCardAuthority(projectId, deckId);
    main = authority.main;
    addressedTarget = explicitlyAddressedCard(message, mainBotRosterCards(authority));
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'project_card_authority_unavailable',
    });
  }
  try {
    await appendConversationTurn({
      projectId,
      conversationId,
      messages: [{
        messageId: clientMessageId,
        role: 'user',
        content: message,
        speaker: USER_PARTICIPANT,
        target: participant(addressedTarget || main),
      }],
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_message_persist_failed',
    });
  }

  let run: PreparedRun;
  try {
    run = await prepareRun({
      projectId,
      deckId,
      conversationId,
      message: botMentionInput(message, addressedTarget),
      target: main,
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'saved_card_preparation_failed',
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const identity = {
    projectId,
    deckId,
    cardId: main.card.id,
    runId: run.runId,
    participant: participant(main),
    requestedParticipant: participant(addressedTarget || main),
    userMessageId: clientMessageId,
    assistantMessageId: clientReplyMessageId,
  };
  writeSse(res, 'run', { ...identity, state: 'preparing' });

  let binding: SessionBinding | null = null;
  let runSettled = false;
  try {
    const client = await hermesGateway();
    binding = await cardSession(client, authority, main, {
      projectId,
      projectSessionId,
      userId,
    });
    await ensureSavedCardTurnModel({ client, binding, profile: main.profile, runRequest: run.request });
    await attachImages(client, binding, main.profile, run.request.images);
    const runtimeMode = String(record(run.request.runtime).mode || '').trim();
    if (!['main', 'delegate', 'magentic_one'].includes(runtimeMode)) {
      throw new Error('card_runtime_mode_invalid');
    }
    writeSse(res, 'session', {
      ...identity,
      sessionId: binding.sessionId,
      configuration: {
        profile: main.profile,
        unavailableTools: exactStrings(run.request.unavailableTools),
      },
    });
    let started: Promise<void> | null = null;
    const result = await submitTurn({
      client,
      binding,
      main,
      directRecipient: addressedTarget,
      text: String(run.request.message),
      submissionId: run.runId,
      onEvent: (event, speaker) => {
        const eventIdentity = { ...identity, participant: participant(speaker) };
        if (event.type === 'prompt.submission.started' && event.session_id === binding!.liveHandle) {
          started ||= startRun(run, binding!, event).then(() => {
            writeSse(res, 'run', { ...eventIdentity, state: 'running' });
          });
          void started.catch(() => undefined);
        } else if (event.type === 'message.delta') {
          if (!addressedTarget || speaker.card.id === addressedTarget.card.id) {
            writeSse(res, 'text', { ...eventIdentity, text: String(event.payload?.text || '') });
          }
        } else if (event.type.includes('reasoning')) {
          writeSse(res, 'reasoning', { ...eventIdentity, event });
        } else if (event.type === 'tool.start') {
          writeSse(res, 'tool_start', { ...eventIdentity, event });
        } else if (event.type === 'tool.complete') {
          writeSse(res, 'tool_result', { ...eventIdentity, event });
        }
      },
    });
    if (!started) throw new Error('run_submission_start_missing');
    await started;
    const mainRunResult = result.mainCompletion
      ? {
        ...result.mainCompletion,
        toolCalls: result.toolCalls,
        speaker: main,
      }
      : result;
    await finishRun({ run, binding, result: mainRunResult });
    runSettled = true;
    if (result.text.trim()) {
      const resultBinding = result.speaker.card.id === main.card.id
        ? binding
        : binding.cardSessions[result.speaker.profile.toLowerCase()];
      const providerMessageId = result.speaker.card.id === main.card.id
        ? `run:${run.runId}`
        : String(result.event.payload?.submission_id || '').trim();
      if (!resultBinding || !providerMessageId) {
        throw new Error('hermes_completion_identity_missing');
      }
      await appendConversationReplyOnce({
        projectId,
        conversationId,
        message: {
          messageId: clientReplyMessageId,
          role: 'assistant',
          content: result.text,
          speaker: participant(result.speaker),
          target: USER_PARTICIPANT,
          providerContinuationRef: resultBinding.sessionId,
          providerMessageId,
        },
      });
    }
    writeSse(res, 'done', {
      ...identity,
      participant: participant(result.speaker),
      fullText: result.text,
    });
  } catch (error) {
    if (binding && !runSettled) await finishRun({ run, binding, error }).catch(() => undefined);
    writeSse(res, 'error', {
      ...identity,
      code: error instanceof Error ? error.message : 'hermes_turn_failed',
      message: error instanceof Error ? error.message : 'The Hermes turn failed.',
      correlationId: run.runId,
      route: '/api/main/session/chat',
      status: 502,
    });
  } finally {
    writeSse(res, 'end', identity);
    res.end();
  }
  return undefined;
});

mainSessionRoutes.post('/voice/start', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const ttsRequested = req.body?.tts !== false;
  if (!projectId || !deckId) return res.status(400).json({ ok: false, error: 'voice_scope_required' });
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  const { userId, projectSessionId } = authorization;
  let client: HermesGatewayClient;
  let binding: SessionBinding;
  let main: ProjectCardBinding;
  let status: Record<string, any>;
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    main = authority.main;
    client = await hermesGateway();
    binding = await cardSession(client, authority, main, {
      projectId, projectSessionId, userId,
    });
    status = record(await client.request('voice.toggle', {
      action: 'status', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000));
    if (status.available === false || status.stt_available === false) {
      return res.status(503).json({ ok: false, error: 'hermes_voice_unavailable' });
    }
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'voice_start_failed',
    });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  const identity = { projectId, deckId, cardId: main.card.id, sessionId: binding.sessionId };
  const detach = client.onEvent((event) => {
    if (event.session_id !== binding.liveHandle) return;
    if (event.type === 'voice.status') writeSse(res, 'status', { ...identity, event });
    else if (event.type === 'voice.transcript') writeSse(res, 'transcript', { ...identity, event });
    else if (event.type === 'voice.interrupted') {
      writeSse(res, 'status', { ...identity, event: { ...event, payload: { state: 'interrupted' } } });
    }
  });
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    detach();
    void client.request('voice.toggle', {
      action: 'off', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000).catch(() => undefined);
  };
  req.once('aborted', cleanup);
  res.once('close', cleanup);
  try {
    let voiceState = record(await client.request('voice.toggle', {
      action: 'on', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000));
    if (ttsRequested && voiceState.tts !== true) {
      voiceState = record(await client.request('voice.toggle', {
        action: 'tts', profile: main.profile, session_id: binding.liveHandle,
      }, 60_000));
    }
    const recording = record(await client.request('voice.record', {
      action: 'start', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000));
    if (recording.status !== 'recording') throw new Error('voice_capture_busy');
    writeSse(res, 'ready', {
      ...identity,
      state: {
        enabled: voiceState.enabled === true,
        tts: voiceState.tts === true,
        available: status.available === true,
        audioAvailable: status.audio_available === true,
        sttAvailable: status.stt_available === true,
        details: String(status.details || ''),
        recordStatus: recording.status,
      },
    });
  } catch (error) {
    writeSse(res, 'error', { ...identity, error: error instanceof Error ? error.message : 'voice_start_failed' });
    res.end();
  }
  return undefined;
});

mainSessionRoutes.post('/voice/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const cancel = req.body?.cancel === true;
  if (!projectId || !deckId) return res.status(400).json({ ok: false, error: 'voice_scope_required' });
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  const { userId, projectSessionId } = authorization;
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const main = authority.main;
    const client = await hermesGateway();
    const binding = await cardSession(client, authority, main, {
      projectId, projectSessionId, userId,
    });
    const result = record(await client.request(
      cancel ? 'voice.toggle' : 'voice.record',
      cancel
        ? { action: 'off', profile: main.profile, session_id: binding.liveHandle }
        : { action: 'stop', profile: main.profile, session_id: binding.liveHandle },
      60_000,
    ));
    return res.json({ ok: true, state: String(result.status || (cancel ? 'off' : 'stopped')) });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'voice_stop_failed',
    });
  }
});

mainSessionRoutes.get('/history', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'project_required' });
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  const conversationId = authorization.projectSessionId;
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const messages = (await getConversationMessages(projectId, conversationId))
      .map(mainConversationMessage)
      .filter((message): message is NonNullable<ReturnType<typeof mainConversationMessage>> => (
        message !== null
      ));
    return res.json({
      ok: true,
      mainCardId: authority.main.card.id,
      addressableAgents: mainBotRosterCards(authority).map((card) => ({
        cardId: card.card.id,
        cardRevisionId: card.cardRevisionId,
        profile: card.profile,
        title: card.title,
        address: card.address || card.profile,
        aliases: card.aliases,
      })),
      messages,
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_history_read_failed',
    });
  }
});

mainSessionRoutes.post('/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  if (!projectId || !deckId || !expectedRunId) {
    return res.status(400).json({ ok: false, error: 'project_and_expected_run_required' });
  }
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const main = authority.main;
    const client = await hermesGateway();
    const storedRows = sessionRows(await client.request('session.list', {
      profile: main.profile,
      title: projectSessionTitle(authorization.projectSessionId),
      include_hidden: true,
      limit: 200,
    }));
    if (storedRows.length !== 1) return res.status(409).json({ ok: false, error: 'no_active_turn' });
    const sessionId = String(storedRows[0].resolved_id || storedRows[0].id || '').trim();
    const active = record(await client.request('session.active_list', { profile: main.profile })).sessions;
    const sessions = Array.isArray(active) ? active.map(record) : [];
    const matches = sessions.filter((item) => String(item.session_key || '').trim() === sessionId);
    if (matches.length !== 1) return res.status(409).json({ ok: false, error: 'no_active_turn' });
    const liveHandle = String(matches[0].id || '').trim();
    if (!liveHandle) return res.status(409).json({ ok: false, error: 'no_active_turn' });
    const interrupted = record(await client.request('session.interrupt', {
      session_id: liveHandle,
      expected_submission_id: expectedRunId,
    }));
    if (interrupted.status !== 'interrupted') {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    return res.json({ ok: true, runId: expectedRunId, state: 'stopping' });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_run_stop_failed',
    });
  }
});

export default mainSessionRoutes;
