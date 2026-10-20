/**
 * Entity: Main Chat
 * Relationship: This file owns Main's authenticated chat, history, stop, and voice routes and streams the exact visible speaker and completion events to the Project conversation.
 *
 * Entity: Hermes Profiles
 * Relationship: This file materializes each participating saved Card's stable profile and verifies the saved provider, model, and reasoning selection before inference.
 *
 * Entity: Hermes Card Sessions
 * Relationship: This file creates, resumes, activates, and readbacks one hidden Project-scoped Hermes session per participating saved Card.
 *
 * Entity: Bot Mode Delegation
 * Relationship: This file resolves explicit @Card addresses only from outbound orange authority, binds exact recipient sessions, and correlates direct and consultation completions without impersonation.
 *
 * Entity: Card Invocation
 * Relationship: This file prepares one saved Main Card invocation, submits its exact Run identity to Hermes, attaches bounded images, and forwards the authorized tool and Script presentation.
 *
 * Entity: Run Ledger
 * Relationship: This file starts and settles the outer Card Run from real Hermes events, usage, provider evidence, cancellation, failure, and final-result state.
 *
 * Entity: Tool Catalog
 * Relationship: This file reads the canonical catalog while materializing participating Card profiles and passes only the prepared Run's selected tools to Hermes.
 *
 * Entity: Card Scripts
 * Relationship: This file forwards an enabled immutable prepared Card Script only when the Run presentation declares Script mode.
 *
 * Entity: Authentication
 * Relationship: This file authorizes either the signed-in Project owner or one exact external identity grant before resolving Main and any recipient Card.
 */

import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import { resolveExternalIdentityProjectGrant } from '../auth/externalIdentityGrantStore';
import {
  appendConversationReplyOnce,
  appendConversationTurn,
  getConversationMessages,
  settleConversationMessage,
  type ConversationMessage,
  type ConversationParticipant,
} from '../conversations/store';
import { BUILDER_CARD_ID } from '../decks/deckDomainClient';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import {
  ensureSavedCardProfile,
  hermesProfileModelSelection,
  materializeSavedCardProfile,
  savedCardBotRoster,
  type HermesProfileState,
} from '../hermes/profileMaterialization';
import {
  hermesGateway,
  type HermesGatewayClient,
  type HermesGatewayEvent,
} from '../services/hermesGateway';
import {
  finishCardRun,
  hermesUsageFields,
  internalCardTurnEndpoint,
  prepareCardRun,
  startCardRun,
  type PreparedCardRun,
} from '../services/cardRunLifecycle';
import {
  assertHermesProfileOwner,
  getOwnedProjectByReference,
} from '../services/projectStore';
import {
  projectCardAuthority,
  type ProjectCardBinding,
  type ProjectCardAuthority,
} from '../services/projectCardAuthority';
import { readToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import {
  registerActiveThinkGraphCapture,
  withThinkGraphCaptureLock,
} from '../services/thinkGraphCaptureSynchronization';
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
};

type CardSessionBinding = ProjectCardSession & {
  liveHandle: string;
  info: Record<string, unknown>;
};

export type SessionBinding = CardSessionBinding & {
  cardSessions: Record<string, CardSessionBinding>;
};

type ProfileMaterializationCacheEntry = {
  cardRevisionId: string;
  catalogFingerprint: string;
  profileFingerprint: string;
};

const profileMaterializationCache = new Map<string, ProfileMaterializationCacheEntry>();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function profileStateFingerprint(value: HermesProfileState): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function toolCatalogFingerprint(value: Awaited<ReturnType<typeof readToolCatalog>>): string {
  return createHash('sha256').update(JSON.stringify({
    state: value.state,
    tools: value.tools,
    unavailableFamilies: [...value.unavailableFamilies].sort(),
    toolFailures: Object.fromEntries(Object.entries(value.toolFailures).sort(([left], [right]) => (
      left.localeCompare(right)
    ))),
  })).digest('hex');
}

type SessionScope = {
  cwd?: string;
  projectId?: string;
  projectSessionId?: string;
  userId?: string;
};

type CardTurnContext = {
  endpoint: string;
  project_id: string;
  deck_id: string;
  conversation_id: string;
  card_id: string;
  profile: string;
};

type TurnResult = {
  text: string;
  event: HermesGatewayEvent;
  toolCalls: number;
  speaker: ProjectCardBinding;
  mainCompletion?: { text: string; event: HermesGatewayEvent };
};

type ActiveTurnInterruptTarget = {
  sessionId: string;
  submissionId: string;
  stopRequested: boolean;
};

type MainSteerTarget = {
  client: HermesGatewayClient;
  sessionId: string;
  runId: string;
} | {
  error: string;
};

type ActiveMainTurn = {
  runId: string | null;
  inputMessageIds: string[];
  ready: Promise<MainSteerTarget>;
  resolveReady(value: MainSteerTarget): void;
  readyResolved: boolean;
};

const sessionBindingTails = new Map<string, Promise<void>>();
const activeTurnInterruptTargets = new Map<string, ActiveTurnInterruptTarget>();
const mainTurnAdmissionTails = new Map<string, Promise<void>>();
const activeMainTurns = new Map<string, ActiveMainTurn>();

function activeTurnKey(
  runId: string, projectId: string, deckId: string, userId: string,
): string {
  return JSON.stringify([runId, projectId, deckId, userId]);
}

function mainTurnScopeKey(
  projectId: string,
  deckId: string,
  conversationId: string,
  userId: string,
  mainCardId: string,
): string {
  return JSON.stringify([projectId, deckId, conversationId, userId, mainCardId]);
}

async function withMainTurnAdmission<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mainTurnAdmissionTails.get(key) || Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => completion);
  mainTurnAdmissionTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (mainTurnAdmissionTails.get(key) === tail) mainTurnAdmissionTails.delete(key);
  }
}

function createActiveMainTurn(): ActiveMainTurn {
  let resolveReady!: (value: MainSteerTarget) => void;
  const ready = new Promise<MainSteerTarget>((resolve) => { resolveReady = resolve; });
  return {
    runId: null,
    inputMessageIds: [],
    ready,
    resolveReady,
    readyResolved: false,
  };
}

function settleActiveMainTurnReadiness(entry: ActiveMainTurn, value: MainSteerTarget): void {
  if (entry.readyResolved) return;
  entry.readyResolved = true;
  entry.resolveReady(value);
}

function releaseActiveMainTurn(key: string, entry: ActiveMainTurn, error?: unknown): void {
  if (activeMainTurns.get(key) === entry) activeMainTurns.delete(key);
  settleActiveMainTurnReadiness(entry, {
    error: error instanceof Error ? error.message : error ? String(error) : 'main_turn_unavailable',
  });
}

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

type ProjectAuthorization = {
  userId: string;
  projectSessionId: string;
  expectedMainCardId?: string;
};

async function authorizeProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<ProjectAuthorization | null> {
  let userId = String((req as Request & { userId?: string }).userId || '').trim();
  let expectedMainCardId = '';
  if (!userId && internalMcpProcessSecretAuthorized(
    req.headers['x-liquidaity-internal-mcp-secret'],
  )) {
    const issuer = String(req.body?.externalIssuer || '').trim();
    const subject = String(req.body?.externalSubject || '').trim();
    expectedMainCardId = String(req.body?.expectedMainCardId || '').trim();
    if (!issuer || !subject || !expectedMainCardId) {
      res.status(401).json({ ok: false, error: 'main_external_identity_required' });
      return null;
    }
    const grant = await resolveExternalIdentityProjectGrant(issuer, subject);
    if (!grant) {
      res.status(403).json({ ok: false, error: 'external_identity_grant_required' });
      return null;
    }
    userId = grant.userId;
  }
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
  return {
    userId,
    projectSessionId,
    ...(expectedMainCardId ? { expectedMainCardId } : {}),
  };
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

function leadingCardAddress(message: string): string | null {
  const trimmed = message.trimStart();
  if (!trimmed.startsWith('@')) return null;
  let address = '';
  for (const character of trimmed.slice(1, 65)) {
    const lower = character.toLowerCase();
    const allowed = (lower >= 'a' && lower <= 'z')
      || (character >= '0' && character <= '9')
      || character === '_'
      || character === '-';
    if (!allowed) break;
    address += character;
  }
  if (!address || !((address[0].toLowerCase() >= 'a' && address[0].toLowerCase() <= 'z')
    || (address[0] >= '0' && address[0] <= '9'))) return null;
  const following = trimmed[address.length + 1];
  if (following && ![' ', '\t', '\r', '\n'].includes(following)) return null;
  return address.toLowerCase();
}

export function explicitlyAddressedCard(
  message: string,
  roster: ProjectCardBinding[],
): ProjectCardBinding | null {
  const address = leadingCardAddress(message);
  if (!address) return null;
  const matches = roster.filter((card) => card.address?.toLowerCase() === address);
  if (matches.length > 1) throw new Error(`main_address_ambiguous:${address}`);
  if (matches.length === 0) throw new Error(`main_address_not_authorized:${address}`);
  return matches[0];
}

export function messageAgentTargetMatchesCard(value: unknown, card: ProjectCardBinding): boolean {
  const target = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return Boolean(target) && (
    target === card.profile.toLowerCase()
    || target === String(card.address || '').trim().replace(/^@/, '').toLowerCase()
  );
}

export function directRecipientSubmissionId(value: unknown): string {
  const result = record(value);
  const deliveryId = String(result.delivery_id || '').trim();
  const processId = String(result.process_id || '').trim();
  if (
    !deliveryId
    || !processId
    || String(result.reply_delivery || '').trim() !== 'direct'
    || Boolean(result.notification_error)
  ) throw new Error('hermes_addressed_delivery_correlation_missing');
  return `__bot_dm__${deliveryId}`;
}

export function hermesCompletionError(payloadValue: unknown): Error | null {
  const payload = record(payloadValue);
  const status = String(payload.status || 'complete').trim().toLowerCase();
  if (['interrupted', 'cancelled'].includes(status)) {
    return new Error('hermes_turn_cancelled');
  }
  if (['error', 'failed'].includes(status)) {
    return new Error(String(payload.error || payload.text || 'hermes_turn_failed'));
  }
  return null;
}

function botMentionInput(message: string, target: ProjectCardBinding | null): string {
  if (!target) return message;
  if (!target.address) throw new Error(`main_address_unavailable:${target.card.id}`);
  return `${message}\n\n[@mention resolved from the current Project's saved Bot Mode roster: `
    + `@${target.address} = saved Card "${target.title}", `
    + `Hermes profile and message_agent target "${target.profile}". Compose the message for that Card and send it `
    + `with message_agent; do not forward the user's text verbatim. This is an explicitly addressed `
    + `turn: Main must not answer or describe delivery state. Finish with Hermes's exact [SILENT] `
    + `marker, never a blank response or a second Main answer. The recipient session presents its `
    + `actual completed answer directly; internal delivery state is not user-facing completion. `
    + `A real delivery failure remains visible.]`;
}

function participantFromStoredMessage(
  message: ConversationMessage,
  kind: 'conversation_speaker' | 'conversation_target',
): ConversationParticipant | null {
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
  const speaker = participantFromStoredMessage(message, 'conversation_speaker')
    || (message.role === 'user' ? USER_PARTICIPANT : null);
  if (!speaker || (message.role !== 'user' && message.role !== 'assistant')) return null;
  const target = participantFromStoredMessage(message, 'conversation_target');
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

function cardTurnContext(
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: SessionScope,
): CardTurnContext {
  const projectId = String(scope.projectSessionId || scope.projectId || '').trim();
  const conversationId = projectId;
  if (!projectId || !conversationId) throw new Error('card_turn_context_required');
  return {
    endpoint: internalCardTurnEndpoint(),
    project_id: projectId,
    deck_id: authority.deck.id,
    conversation_id: conversationId,
    card_id: card.card.id,
    profile: card.profile,
  };
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
  roster: string[];
  cwd: string;
  projectSessionId: string;
  turnContext: CardTurnContext;
}): Promise<ProjectCardSession> {
  const { client, card, roster, cwd, projectSessionId, turnContext } = args;
  const profile = card.profile;
  const reasoningEffort = savedCardReasoningEffort(card);
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
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        hidden: true,
        close_on_disconnect: false,
        follow_profile_config: true,
        bot_mode_roster: roster,
        card_turn_context: turnContext,
      }), roster, {});
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
  turnContext: CardTurnContext;
}): Promise<CardSessionBinding> {
  const { client, card, profileState, stored, turnContext } = args;
  const resumed = sessionResult(await client.request('session.resume', {
    session_id: stored.sessionId,
    profile: card.profile,
    omit_messages: true,
    eager_build: true,
    close_on_disconnect: false,
    follow_profile_config: true,
    bot_mode_roster: stored.botModeRoster,
    bot_mode_sessions: stored.botModeSessions,
    card_turn_context: turnContext,
  }), stored.botModeRoster, stored.botModeSessions);
  let activated = sessionResult(await client.request('session.activate', {
    session_id: resumed.liveHandle,
    profile: card.profile,
    omit_messages: true,
    bot_mode_roster: stored.botModeRoster,
    bot_mode_sessions: stored.botModeSessions,
    card_turn_context: turnContext,
  }), stored.botModeRoster, stored.botModeSessions);
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
      card_turn_context: turnContext,
    }), stored.botModeRoster, stored.botModeSessions);
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
  directRecipient: ProjectCardBinding | null = null,
): Promise<Record<string, CardSessionBinding>> {
  const directRoster = directRecipient ? savedCardBotRoster(authority.deck, selected.card) : [];
  if (
    directRecipient
    && !directRoster.some((profile) => profile.toLowerCase() === directRecipient.profile.toLowerCase())
  ) throw new Error(`hermes_recipient_not_authorized:${directRecipient.profile}`);
  const requiredCards = directRecipient
    ? [...new Map(
      [selected, ...activeProjectCards(authority, directRecipient)]
        .map((card) => [card.profile.toLowerCase(), card]),
    ).values()]
    : activeProjectCards(authority, selected);
  const projectSessionId = String(scope.projectSessionId || scope.projectId || '').trim();
  if (!projectSessionId) throw new Error('hermes_project_session_identity_missing');
  const ownerUserId = String(scope.userId || '').trim();
  if (!ownerUserId) throw new Error('hermes_profile_owner_required');
  if (!requiredCards.some((card) => card.card.id === selected.card.id)) {
    throw new Error(`hermes_session_card_unavailable:${selected.card.id}`);
  }
  const request = <T>(method: string, params: Record<string, unknown> = {}) => client.request<T>(method, params);
  const toolCatalog = await readToolCatalog();
  const catalogFingerprint = toolCatalogFingerprint(toolCatalog);
  const provisioned = new Map<string, HermesProfileState>();
  for (const card of requiredCards) {
    await assertHermesProfileOwner(card.profile, ownerUserId);
    provisioned.set(
      card.profile.toLowerCase(),
      await ensureSavedCardProfile(request, card.card, ownerUserId),
    );
  }
  const profiles = new Map<string, HermesProfileState>();
  for (const card of requiredCards) {
    const profile = card.profile.toLowerCase();
    const existingProfile = provisioned.get(profile)!;
    const existingFingerprint = profileStateFingerprint(existingProfile);
    const cacheKey = `${ownerUserId}:${profile}`;
    const cached = profileMaterializationCache.get(cacheKey);
    if (
      cached?.cardRevisionId === card.cardRevisionId
      && cached.catalogFingerprint === catalogFingerprint
      && cached.profileFingerprint === existingFingerprint
    ) {
      profiles.set(profile, existingProfile);
      continue;
    }
    const materialized = await materializeSavedCardProfile(
      request,
      card.card,
      ownerUserId,
      existingProfile,
      toolCatalog.tools,
      toolCatalog.unavailableFamilies,
    );
    profiles.set(profile, materialized);
    profileMaterializationCache.set(cacheKey, {
      cardRevisionId: card.cardRevisionId,
      catalogFingerprint,
      profileFingerprint: profileStateFingerprint(materialized),
    });
  }
  const sessions: Record<string, ProjectCardSession> = {};
  for (const card of requiredCards) {
    const profile = card.profile.toLowerCase();
    const roster = directRecipient && card.card.id === selected.card.id
      ? [directRecipient.profile]
      : savedCardBotRoster(authority.deck, card.card);
    sessions[profile] = await ensureProjectCardSession({
      client,
      card,
      roster,
      cwd: sessionCwd(authority, card, selected, scope),
      projectSessionId,
      turnContext: cardTurnContext(authority, card, scope),
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
  for (const card of requiredCards) {
    const profile = card.profile.toLowerCase();
    liveSessions[profile] = await resumeProjectCardSession({
      client,
      card,
      profileState: profiles.get(profile)!,
      stored: sessions[profile],
      turnContext: cardTurnContext(authority, card, scope),
    });
  }
  return liveSessions;
}

export async function cardProjectSession(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  selected: ProjectCardBinding,
  scope: SessionScope,
): Promise<ProjectCardSession> {
  const sessions = await projectSessionCatalog(client, authority, selected, scope);
  const selectedSession = sessions[selected.profile.toLowerCase()];
  if (!selectedSession) throw new Error(`hermes_session_binding_missing:${selected.profile}`);
  return selectedSession;
}

export async function cardSession(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  selected: ProjectCardBinding = authority.main,
  scope: SessionScope = {},
  directRecipient: ProjectCardBinding | null = null,
): Promise<SessionBinding> {
  const sessions = await projectSessionCatalog(
    client, authority, selected, scope, directRecipient,
  );
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
  const desired = hermesProfileModelSelection(record(args.runRequest.provider));
  if (!desired.model || !desired.provider) throw new Error('hermes_session_model_binding_invalid');
  if (
    String(args.binding.info.model || '').trim() !== desired.model
    || String(args.binding.info.provider || '').trim() !== desired.provider
  ) {
    const changed = record(await args.client.request('config.set', {
      profile: args.profile,
      session_id: args.binding.liveHandle,
      key: 'model',
      value: `${desired.model} --provider ${desired.provider} --once`,
      confirm_expensive_model: false,
    }));
    if (
      String(changed.key || '') !== 'model'
      || String(changed.value || '') !== desired.model
      || String(changed.scope || '') !== 'once'
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
    ...(String(info.provider || '') === desired.provider ? [] : ['provider']),
    ...(String(info.model || '') === desired.model ? [] : ['model']),
  ];
  if (mismatches.length) throw new Error(`hermes_session_model_readback_mismatch:${mismatches.join(',')}`);
  args.binding.info = info;
}

async function startRun(run: PreparedCardRun, binding: CardSessionBinding, event: HermesGatewayEvent): Promise<void> {
  const submissionId = String(event.payload?.submission_id || '').trim();
  if (submissionId !== run.runId) throw new Error('run_submission_identity_mismatch');
  await startCardRun({ runId: run.runId, submissionId, hermesSessionRef: binding.sessionId });
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

function runInputProviderMessageId(runId: string, ordinal: number): string {
  return `run:${runId}:input:${ordinal}`;
}

async function completedMainInputText(args: {
  projectId: string;
  conversationId: string;
  inputMessageIds: string[];
}): Promise<string> {
  const expected = new Set(args.inputMessageIds);
  const messages = (await getConversationMessages(args.projectId, args.conversationId))
    .filter((message) => expected.has(message.messageId));
  if (
    messages.length !== args.inputMessageIds.length
    || messages.some((message, index) => (
      message.role !== 'user'
      || message.messageId !== args.inputMessageIds[index]
      || message.status !== 'complete'
    ))
  ) throw new Error('main_run_input_evidence_mismatch');
  if (messages.length === 1) return messages[0].content;
  return messages.map((message, index) => (
    `USER INPUT ${index + 1}:\n${message.content}`
  )).join('\n\n');
}

function thinkGraphExtractionTask(preparation: Record<string, any>): string {
  const schema = record(preparation.enrichmentSchema);
  const prompt = String(preparation.enrichmentPrompt || '').trim();
  const input = record(preparation.enrichmentInput);
  if (!Object.keys(schema).length || !prompt || !Object.keys(input).length) {
    throw new Error('thinkgraph_prepare_extraction_contract_invalid');
  }
  return [
    'Apply the supplied structured extraction contract to this completed Main exchange.',
    'Use the saved ThinkGraph Card instructions and its granted capabilities as needed.',
    'Return exactly one JSON object that validates against OUTPUT_SCHEMA, with no surrounding prose.',
    '',
    'OUTPUT_SCHEMA:',
    JSON.stringify(schema),
    '',
    'EXTRACTION_PROMPT:',
    prompt,
    '',
    'EXTRACTION_INPUT:',
    JSON.stringify(input),
  ].join('\n');
}

async function assertHermesSessionIdle(
  client: HermesGatewayClient,
  sessionId: string,
): Promise<void> {
  const status = record(await client.request('session.status', { session_id: sessionId }));
  if (status.running === true) throw new Error('hermes_session_active');
}

type CompletedMainTurnCaptureArgs = {
  client: HermesGatewayClient;
  authority: ProjectCardAuthority;
  main: ProjectCardBinding;
  parentBinding: CardSessionBinding;
  parentRunId: string;
  userId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  userMessage: string;
  mainResponse: string;
};

async function executeCompletedMainTurnCapture(
  args: CompletedMainTurnCaptureArgs,
): Promise<Record<string, any>> {
  let childRun: PreparedCardRun | null = null;
  let childBinding: SessionBinding | null = null;
  let childSettled = false;
  try {
    const completedPair = {
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      runId: args.parentRunId,
      cardId: args.main.card.id,
      hermesSessionId: args.parentBinding.sessionId,
      completedAt: new Date().toISOString(),
      userMessage: args.userMessage,
      mainResponse: args.mainResponse,
    };
    const preparation = record(await requestPythonRailsJson(
      '/thinkgraph/completed-pair/prepare',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(completedPair),
      },
    ));
    if (preparation.revisionChanged !== false || !String(preparation.preparation?.status || '')) {
      throw new Error('thinkgraph_prepare_mutated_graph');
    }
    if (
      preparation.structuredExtractionRequired === false
      && preparation.intakeOperation === 'noop'
    ) return preparation;
    if (
      preparation.structuredExtractionRequired !== true
      || preparation.intakeOperation !== 'pending'
      || !String(preparation.pairReference || '').trim()
    ) throw new Error('thinkgraph_prepare_intake_contract_invalid');

    const targets = mainBotRosterCards(args.authority).filter(
      (candidate) => candidate.card.id === 'card_thinkgraph',
    );
    if (targets.length !== 1) {
      throw new Error(targets.length
        ? 'thinkgraph_saved_card_ambiguous'
        : 'thinkgraph_saved_card_not_authorized');
    }
    const target = targets[0];
    childRun = await prepareCardRun({
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      message: thinkGraphExtractionTask(preparation),
      target,
      dataAnchors: [],
      images: [],
      senderCardId: args.main.card.id,
      originatingRunId: args.parentRunId,
    });
    childBinding = await cardSession(args.client, args.authority, target, {
      projectId: args.projectId,
      projectSessionId: args.conversationId,
      userId: args.userId,
    });
    await ensureSavedCardTurnModel({
      client: args.client,
      binding: childBinding,
      profile: target.profile,
      runRequest: childRun.request,
    });
    await assertHermesSessionIdle(args.client, childBinding.liveHandle);
    const runtimeOptions = record(childRun.request.runtimeOptions);
    const scriptPresentation = record(childRun.request.scriptPresentation);
    const cardScript = scriptPresentation.mode === 'script'
      ? record(childRun.request.cardScript)
      : null;
    if (scriptPresentation.mode === 'script' && !Object.keys(cardScript || {}).length) {
      throw new Error('card_script_runtime_contract_missing');
    }
    let started: Promise<void> | null = null;
    const result = await executeHermesTurn({
      client: args.client,
      binding: childBinding,
      main: target,
      directRecipient: null,
      consultationCards: [],
      text: String(childRun.request.message),
      submissionId: childRun.runId,
      mcpToolSelection: runtimeOptions.autoTools === true || scriptPresentation.mode === 'script'
        ? { liquidaity: exactStrings(childRun.request.presentedTools) }
        : null,
      cardScript,
      botModeCardContexts: {},
      onTeamConsultation: () => undefined,
      onInterruptTarget: () => undefined,
      onEvent: (event) => {
        if (event.type === 'prompt.submission.started') {
          started ||= startRun(childRun!, childBinding!, event);
        }
      },
    });
    if (!started) throw new Error('run_submission_start_missing');
    await started;
    if (!result.text.trim()) throw new Error('thinkgraph_card_empty_response');
    let structuredOutput: Record<string, unknown>;
    try {
      structuredOutput = record(JSON.parse(result.text));
    } catch {
      throw new Error('thinkgraph_card_output_invalid');
    }
    if (!Array.isArray(structuredOutput.facts)) {
      throw new Error('thinkgraph_card_output_invalid');
    }
    await finishRun({ run: childRun, binding: childBinding, result });
    childSettled = true;
    const settled = record(await requestPythonRailsJson(
      '/thinkgraph/completed-pair/settle',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...completedPair,
          pairReference: String(preparation.pairReference),
          structuredOutput,
          cardRun: {
            runId: childRun.runId,
            cardId: target.card.id,
            revisionId: target.cardRevisionId,
            profile: target.profile,
            hermesSessionId: childBinding.sessionId,
            resolvedProvider: String(childBinding.info.provider || ''),
            resolvedModel: String(childBinding.info.model || ''),
          },
        }),
      },
    ));
    if (settled.ok !== true) throw new Error('thinkgraph_settlement_invalid');
    return settled;
  } catch (error) {
    if (childRun && !childSettled) {
      await finishRun({ run: childRun, binding: childBinding, error }).catch(() => undefined);
    }
    throw error;
  }
}

async function captureCompletedMainTurn(
  args: CompletedMainTurnCaptureArgs,
): Promise<Record<string, any>> {
  return withThinkGraphCaptureLock(
    args.projectId,
    args.deckId,
    () => executeCompletedMainTurnCapture(args),
  );
}

function writeSse(res: Response, eventName: string, payload: Record<string, unknown>): boolean {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  return true;
}

async function executeHermesTurn(args: {
  client: HermesGatewayClient;
  binding: SessionBinding;
  main: ProjectCardBinding;
  directRecipient: ProjectCardBinding | null;
  consultationCards: ProjectCardBinding[];
  text: string;
  submissionId: string;
  mcpToolSelection: Record<string, string[]> | null;
  cardScript: Record<string, unknown> | null;
  botModeCardContexts: Record<string, CardTurnContext>;
  onTeamConsultation(value: {
    taskId: string;
    runId: string;
    target: ProjectCardBinding;
  }): void;
  onInterruptTarget(target: { sessionId: string; submissionId: string }): void;
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
    let consultationError: Error | null = null;
    let expectedConsultationProcessId: string | null = null;
    let expectedConsultationTaskId: string | null = null;
    let expectedConsultationRunId: string | null = null;
    let consultationTarget: ProjectCardBinding | null = null;
    let addressedToolId: string | null = null;
    let expectedRecipientSubmissionId: string | null = null;
    let activeRecipientSubmissionId: string | null = null;
    let mainCompletion: { text: string; event: HermesGatewayEvent } | null = null;
    let recipientCompletion: { text: string; event: HermesGatewayEvent } | null = null;
    let recipientError: Error | null = null;
    const pendingRecipientEvents = new Map<string, HermesGatewayEvent[]>();
    let timer: ReturnType<typeof setTimeout>;
    let detachEvent: () => void = () => undefined;
    let detachState: () => void = () => undefined;
    const finish = (error?: Error, value?: TurnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detachEvent();
      detachState();
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
      const text = String(event.payload?.text || '');
      const completionError = hermesCompletionError(event.payload);
      if (completionError) recipientError = completionError;
      else if (recipientCompletion) {
        recipientError = new Error('hermes_recipient_completion_duplicate');
      } else recipientCompletion = { text, event };
      finishRecipientIfReady();
    };
    const flushExpectedRecipientEvents = () => {
      if (!expectedRecipientSubmissionId) return;
      const events = pendingRecipientEvents.get(expectedRecipientSubmissionId) || [];
      pendingRecipientEvents.delete(expectedRecipientSubmissionId);
      for (const event of events) observeRecipientEvent(event);
    };
    detachState = args.client.onState((state) => {
      if (state !== 'closed' && state !== 'error') return;
      finish(new Error(`hermes_gateway_${state}_during_turn`));
    });
    detachEvent = args.client.onEvent((event) => {
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
      const eventSubmissionId = String(event.payload?.submission_id || '').trim();
      const notificationProcessIds = exactStrings(event.payload?.notification_process_ids);
      const notificationTaskIds = exactStrings(event.payload?.notification_task_ids);
      if (event.type === 'prompt.submission.started') {
        if (eventSubmissionId !== args.submissionId) return;
        ownTurnStarted = true;
      }
      if (!ownTurnStarted) return;
      const ownSubmissionEvent = eventSubmissionId === args.submissionId
        || (!eventSubmissionId && !ownTurnCompleted);
      const consultationCompletionEvent = (
        event.type === 'message.complete'
        && ownTurnCompleted
        && (
          (
            Boolean(expectedConsultationProcessId)
            && notificationProcessIds.includes(expectedConsultationProcessId!)
          )
          || (
            Boolean(expectedConsultationTaskId)
            && notificationTaskIds.includes(expectedConsultationTaskId!)
          )
        )
      );
      if (!ownSubmissionEvent && !consultationCompletionEvent) return;
      args.onEvent(event, args.main);
      if (event.type === 'tool.start') {
        toolCalls += 1;
        if (String(event.payload?.name || '') === 'message_agent') {
          messageAgentStarted = true;
          const targetValue = record(event.payload?.args).target;
          const matches = args.consultationCards.filter((candidate) => (
            messageAgentTargetMatchesCard(targetValue, candidate)
          ));
          if (matches.length === 1) consultationTarget = matches[0];
          else consultationError = new Error('hermes_consultation_target_ambiguous');
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
        if (String(result.reply_delivery || '').trim() === 'team') {
          const taskId = String(result.task_id || '').trim();
          const runId = String(result.run_id || '').trim();
          if (!taskId || !runId || !consultationTarget) {
            consultationError = new Error('hermes_team_consultation_correlation_missing');
          } else if (
            (expectedConsultationTaskId && expectedConsultationTaskId !== taskId)
            || (expectedConsultationRunId && expectedConsultationRunId !== runId)
          ) {
            consultationError = new Error('hermes_team_consultation_duplicate');
          } else {
            expectedConsultationTaskId = taskId;
            expectedConsultationRunId = runId;
            args.onTeamConsultation({
              taskId,
              runId,
              target: consultationTarget,
            });
          }
        } else if (!args.directRecipient) {
          const deliveryId = String(result.delivery_id || '').trim();
          const processId = String(result.process_id || '').trim();
          if (
            !deliveryId
            || !processId
            || String(result.reply_delivery || '').trim() !== 'notification'
            || Boolean(result.notification_error)
          ) consultationError = new Error('hermes_consultation_delivery_correlation_missing');
          else if (expectedConsultationProcessId && expectedConsultationProcessId !== processId) {
            consultationError = new Error('hermes_consultation_delivery_duplicate');
          } else {
            expectedConsultationProcessId = processId;
          }
        } else if (String(event.payload?.tool_id || '').trim() === addressedToolId) {
          let recipientSubmissionId: string | null = null;
          try {
            recipientSubmissionId = directRecipientSubmissionId(result);
          } catch (error) {
            recipientError = error instanceof Error
              ? error
              : new Error('hermes_addressed_delivery_correlation_missing');
          }
          if (recipientSubmissionId && (
            expectedRecipientSubmissionId
            && expectedRecipientSubmissionId !== recipientSubmissionId
          )) {
            recipientError = new Error('hermes_addressed_delivery_duplicate');
          } else if (recipientSubmissionId) {
            expectedRecipientSubmissionId = recipientSubmissionId;
            args.onInterruptTarget({
              sessionId: recipientBinding!.liveHandle,
              submissionId: recipientSubmissionId,
            });
            flushExpectedRecipientEvents();
          }
        }
      }
      if (event.type === 'error') {
        finish(new Error(String(event.payload?.message || 'hermes_turn_failed')));
        return;
      }
      if (event.type !== 'message.complete') return;
      const text = String(event.payload?.text || '');
      const completionError = hermesCompletionError(event.payload);
      if (completionError) {
        finish(completionError);
        return;
      }
      if (ownSubmissionEvent) {
        if (args.directRecipient && !expectedConsultationTaskId) {
          ownTurnCompleted = true;
          mainCompletion = { text, event };
          if (!addressedToolId) {
            finish(new Error('hermes_addressed_delivery_missing'));
            return;
          }
          if (!expectedRecipientSubmissionId && !recipientError) {
            recipientError = new Error('hermes_addressed_delivery_correlation_missing');
          }
          finishRecipientIfReady();
          return;
        }
        if (messageAgentStarted) {
          ownTurnCompleted = true;
          if (consultationError) {
            finish(consultationError);
            return;
          }
          if (!expectedConsultationProcessId && !expectedConsultationTaskId) {
            finish(new Error('hermes_consultation_delivery_correlation_missing'));
            return;
          }
          return;
        }
        finish(undefined, { text, event, toolCalls, speaker: args.main });
        return;
      }
      if (!ownTurnCompleted) return;
      if (
        (
          expectedConsultationTaskId
            ? notificationTaskIds.length !== 1
              || notificationTaskIds[0] !== expectedConsultationTaskId
            : !expectedConsultationProcessId
              || notificationProcessIds.length !== 1
              || notificationProcessIds[0] !== expectedConsultationProcessId
        )
      ) {
        finish(new Error('hermes_consultation_completion_ambiguous'));
        return;
      }
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
      submission_id: args.submissionId,
      card_run_id: args.submissionId,
      ...(args.mcpToolSelection ? { mcp_tool_selection: args.mcpToolSelection } : {}),
      ...(args.cardScript ? { card_script: args.cardScript } : {}),
      bot_mode_roster: args.directRecipient
        ? [args.directRecipient.profile]
        : args.binding.botModeRoster,
      bot_mode_sessions: args.directRecipient && recipientBinding
        ? { [args.directRecipient.profile]: recipientBinding.sessionId }
        : args.binding.botModeSessions,
      bot_mode_card_contexts: args.botModeCardContexts,
      bot_mode_reply_delivery: args.directRecipient ? 'direct' : 'notification',
    }).then((submitted) => {
      const status = String(submitted.status || 'streaming');
      if (status !== 'streaming') {
        finish(new Error('hermes_submission_not_started'));
      }
    }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

async function finishRun(args: {
  run: PreparedCardRun;
  binding: CardSessionBinding | null;
  result?: TurnResult;
  error?: unknown;
  cancelled?: boolean;
  inputMessageIds?: string[];
}): Promise<void> {
  const provider = record(args.binding?.info);
  const requestedProvider = record(args.run.request.provider);
  const providerEvidence = args.binding ? {
    effectiveProvider: String(provider.provider || requestedProvider.provider || ''),
    model: String(provider.model || requestedProvider.providerModelId || ''),
    provider: String(provider.provider || requestedProvider.provider || ''),
  } : {};
  // `usage` is the cumulative lifetime session counter. A product Run owns the
  // exact current-turn delta emitted by Hermes as `turn_usage`.
  const usage = args.result ? hermesUsageFields(args.result.event.payload?.turn_usage) : {};
  await finishCardRun({
      runId: args.run.runId,
      state: args.cancelled ? 'cancelled' : args.error ? 'failed' : 'completed',
      finalResult: args.result?.text,
      errorCode: args.cancelled ? 'hermes_turn_cancelled' : args.error ? 'hermes_turn_failed' : undefined,
      errorSummary: args.cancelled
        ? 'hermes_turn_cancelled'
        : args.error instanceof Error ? args.error.message : args.error ? String(args.error) : undefined,
      hermesSessionRef: args.binding?.sessionId,
      providerTurnRef: args.result
        ? String(args.result.event.payload?.submission_id || args.run.runId)
        : undefined,
      ...providerEvidence,
      toolCallCount: args.result?.toolCalls ?? 0,
      ...(args.inputMessageIds?.length ? { inputMessageIds: args.inputMessageIds } : {}),
      ...usage,
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
  const { userId, projectSessionId, expectedMainCardId } = authorization;
  const conversationId = projectSessionId;

  let authority: ProjectCardAuthority;
  let main: ProjectCardBinding;
  let addressedTarget: ProjectCardBinding | null;
  try {
    authority = await projectCardAuthority(projectId, deckId);
    main = authority.main;
    if (expectedMainCardId && main.card.id !== expectedMainCardId) {
      throw new Error('external_main_card_binding_changed');
    }
    addressedTarget = explicitlyAddressedCard(message, mainBotRosterCards(authority));
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'project_card_authority_unavailable',
    });
  }
  const scopeKey = mainTurnScopeKey(
    projectId, deckId, conversationId, userId, main.card.id,
  );
  let activeTurn: ActiveMainTurn;
  let admission: 'run' | 'steer';
  try {
    ({ entry: activeTurn, kind: admission } = await withMainTurnAdmission(
      scopeKey,
      async () => {
        const active = activeMainTurns.get(scopeKey);
        if (!active) {
          const entry = createActiveMainTurn();
          activeMainTurns.set(scopeKey, entry);
          return { kind: 'run' as const, entry };
        }

        const ready = await active.ready;
        if ('error' in ready) throw new Error(ready.error);
        const ordinal = active.inputMessageIds.length + 1;
        const providerMessageId = runInputProviderMessageId(ready.runId, ordinal);
        let persisted = false;
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
              status: 'pending',
              providerMessageId,
            }],
          });
          persisted = true;
          const steerText = botMentionInput(message, addressedTarget);
          const result = record(await ready.client.request('session.steer', {
            session_id: ready.sessionId,
            text: steerText,
          }));
          if (String(result.status || '').trim() === 'rejected') {
            throw new Error('hermes_steer_rejected');
          }
          await settleConversationMessage({
            projectId,
            conversationId,
            messageId: clientMessageId,
            providerMessageId,
            status: 'complete',
          });
          active.inputMessageIds.push(clientMessageId);
          return { kind: 'steer' as const, entry: active };
        } catch (error) {
          if (persisted) {
            await settleConversationMessage({
              projectId,
              conversationId,
              messageId: clientMessageId,
              providerMessageId,
              status: 'error',
            }).catch(() => undefined);
          }
          throw error;
        }
      },
    ));
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_steer_failed',
    });
  }

  if (admission === 'steer') {
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
      runId: activeTurn.runId!,
      participant: participant(main),
      requestedParticipant: participant(addressedTarget || main),
      userMessageId: clientMessageId,
      assistantMessageId: clientReplyMessageId,
    };
    writeSse(res, 'run', { ...identity, state: 'running' });
    writeSse(res, 'done', { ...identity, fullText: '' });
    writeSse(res, 'end', identity);
    res.end();
    return undefined;
  }

  let run: PreparedCardRun;
  try {
    run = await prepareCardRun({
      projectId,
      deckId,
      conversationId,
      message: botMentionInput(message, addressedTarget),
      target: main,
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    activeTurn.runId = run.runId;
  } catch (error) {
    releaseActiveMainTurn(scopeKey, activeTurn, error);
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'saved_card_preparation_failed',
    });
  }

  const initialInputProviderMessageId = runInputProviderMessageId(run.runId, 1);
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
        status: 'pending',
        providerMessageId: initialInputProviderMessageId,
      }],
    });
    activeTurn.inputMessageIds.push(clientMessageId);
  } catch (error) {
    await finishRun({ run, binding: null, error }).catch(() => undefined);
    releaseActiveMainTurn(scopeKey, activeTurn, error);
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_message_persist_failed',
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
  const interruptTargetKey = activeTurnKey(run.runId, projectId, deckId, userId);
  writeSse(res, 'run', { ...identity, state: 'preparing' });

  let binding: SessionBinding | null = null;
  let runSettled = false;
  const teamConsultationState: {
    value: {
      taskId: string;
      runId: string;
      target: ProjectCardBinding;
    } | null;
    settled: boolean;
  } = { value: null, settled: false };
  let streamedReplyText = '';
  let streamedReplySpeaker = main;
  let started: Promise<void> | null = null;
  let initialInputSettled = false;
  let runInputMessageIds = [...activeTurn.inputMessageIds];
  try {
    const client = await hermesGateway();
    binding = await cardSession(client, authority, main, {
      projectId,
      projectSessionId,
      userId,
    }, addressedTarget);
    await ensureSavedCardTurnModel({ client, binding, profile: main.profile, runRequest: run.request });
    await attachImages(client, binding, main.profile, run.request.images);
    await assertHermesSessionIdle(client, binding.liveHandle);
    const runtimeMode = String(record(run.request.runtime).mode || '').trim();
    if (!['main', 'delegate', 'magentic_one'].includes(runtimeMode)) {
      throw new Error('card_runtime_mode_invalid');
    }
    const runtimeOptions = record(run.request.runtimeOptions);
    const scriptPresentation = record(run.request.scriptPresentation);
    const cardScript = scriptPresentation.mode === 'script'
      ? record(run.request.cardScript)
      : null;
    if (scriptPresentation.mode === 'script' && !Object.keys(cardScript || {}).length) {
      throw new Error('card_script_runtime_contract_missing');
    }
    activeTurnInterruptTargets.set(interruptTargetKey, {
      sessionId: binding.liveHandle,
      submissionId: run.runId,
      stopRequested: false,
    });
    writeSse(res, 'session', {
      ...identity,
      sessionId: binding.sessionId,
      configuration: {
        profile: main.profile,
        unavailableTools: exactStrings(run.request.unavailableTools),
      },
    });
    const result = await executeHermesTurn({
      client,
      binding,
      main,
      directRecipient: addressedTarget,
      consultationCards: addressedTarget
        ? [addressedTarget]
        : mainBotRosterCards(authority),
      text: String(run.request.message),
      submissionId: run.runId,
      mcpToolSelection: runtimeOptions.autoTools === true || scriptPresentation.mode === 'script'
        ? { liquidaity: exactStrings(run.request.presentedTools) }
        : null,
      cardScript,
      botModeCardContexts: Object.fromEntries(
        (addressedTarget ? [addressedTarget] : mainBotRosterCards(authority))
          .map((card) => [
            card.profile,
            cardTurnContext(authority, card, {
              projectId,
              projectSessionId,
              userId,
            }),
          ]),
      ),
      onTeamConsultation: (value) => {
        if (!teamConsultationState.value) teamConsultationState.value = value;
      },
      onInterruptTarget: (target) => {
        const active = activeTurnInterruptTargets.get(interruptTargetKey);
        if (!active) return;
        activeTurnInterruptTargets.set(interruptTargetKey, { ...active, ...target });
      },
      onEvent: (event, speaker) => {
        const eventIdentity = { ...identity, participant: participant(speaker) };
        if (event.type === 'prompt.submission.started' && event.session_id === binding!.liveHandle) {
          started ||= Promise.all([
            startRun(run, binding!, event),
            settleConversationMessage({
              projectId,
              conversationId,
              messageId: clientMessageId,
              providerMessageId: initialInputProviderMessageId,
              status: 'complete',
            }),
          ]).then(() => {
            initialInputSettled = true;
            settleActiveMainTurnReadiness(activeTurn, {
              client,
              sessionId: binding!.liveHandle,
              runId: run.runId,
            });
            writeSse(res, 'run', { ...eventIdentity, state: 'running' });
          });
          void started.catch(() => undefined);
        } else if (event.type === 'message.delta') {
          if (!addressedTarget || speaker.card.id === addressedTarget.card.id) {
            const text = String(event.payload?.text || '');
            streamedReplyText += text;
            streamedReplySpeaker = speaker;
            writeSse(res, 'text', { ...eventIdentity, text });
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
    runInputMessageIds = await withMainTurnAdmission(scopeKey, async () => {
      if (activeMainTurns.get(scopeKey) === activeTurn) activeMainTurns.delete(scopeKey);
      return [...activeTurn.inputMessageIds];
    });
    const mainRunResult = result.mainCompletion
      ? {
        ...result.mainCompletion,
        text: result.text,
        toolCalls: result.toolCalls,
        speaker: main,
      }
      : result;
    const teamConsultation = teamConsultationState.value;
    if (teamConsultation) {
      const childBinding = binding.cardSessions[
        teamConsultation.target.profile.toLowerCase()
      ];
      if (!childBinding) throw new Error('hermes_team_consultation_session_missing');
      const childProvider = record(childBinding.info);
      await finishCardRun({
        runId: teamConsultation.runId,
        state: 'completed',
        finalResult: result.text,
        hermesSessionRef: childBinding.sessionId,
        providerTurnRef: teamConsultation.taskId,
        effectiveProvider: String(childProvider.provider || ''),
        provider: String(childProvider.provider || ''),
        model: String(childProvider.model || ''),
        toolCallCount: 0,
      });
      teamConsultationState.settled = true;
    }
    await finishRun({
      run,
      binding,
      result: mainRunResult,
      inputMessageIds: runInputMessageIds,
    });
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
    if (!addressedTarget && result.speaker.card.id === main.card.id && result.text.trim()) {
      const capture = completedMainInputText({
        projectId,
        conversationId,
        inputMessageIds: runInputMessageIds,
      }).then((userMessage) => captureCompletedMainTurn({
        client,
        authority,
        main,
        parentBinding: binding!,
        parentRunId: run.runId,
        userId,
        projectId,
        deckId,
        conversationId,
        userMessage,
        mainResponse: result.text,
      }));
      registerActiveThinkGraphCapture(projectId, run.runId, capture);
      void capture.catch((graphError) => {
        console.error('[thinkgraph-capture]', {
          runId: run.runId,
          error: graphError instanceof Error
            ? graphError.message
            : 'thinkgraph_completed_pair_failed',
        });
      });
    }
    writeSse(res, 'done', {
      ...identity,
      participant: participant(result.speaker),
      fullText: result.text,
    });
  } catch (error) {
    releaseActiveMainTurn(scopeKey, activeTurn, error);
    const teamConsultation = teamConsultationState.value;
    if (teamConsultation && !teamConsultationState.settled) {
      await finishCardRun({
        runId: teamConsultation.runId,
        state: 'failed',
        errorCode: 'hermes_team_consultation_failed',
        errorSummary: error instanceof Error ? error.message : String(error),
        providerTurnRef: teamConsultation.taskId,
      }).catch(() => undefined);
    }
    if (!initialInputSettled) {
      await settleConversationMessage({
        projectId,
        conversationId,
        messageId: clientMessageId,
        providerMessageId: initialInputProviderMessageId,
        status: 'error',
      }).catch(() => undefined);
    }
    const cancelled = error instanceof Error && error.message === 'hermes_turn_cancelled'
      || activeTurnInterruptTargets.get(interruptTargetKey)?.stopRequested === true;
    if (!runSettled) await finishRun({
      run,
      binding,
      error,
      cancelled,
      inputMessageIds: activeTurn.inputMessageIds,
    }).catch(() => undefined);
    if (cancelled) {
      writeSse(res, 'done', {
        ...identity,
        participant: participant(streamedReplySpeaker),
        fullText: streamedReplyText,
        state: 'cancelled',
      });
    } else {
      writeSse(res, 'error', {
        ...identity,
        code: error instanceof Error ? error.message : 'hermes_turn_failed',
        message: error instanceof Error ? error.message : 'The Hermes turn failed.',
        correlationId: run.runId,
        route: '/api/main/session/chat',
        status: 502,
      });
    }
  } finally {
    releaseActiveMainTurn(scopeKey, activeTurn);
    activeTurnInterruptTargets.delete(interruptTargetKey);
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
      addressableAgents: mainBotRosterCards(authority).flatMap((card) => card.address ? [{
        cardId: card.card.id,
        cardRevisionId: card.cardRevisionId,
        profile: card.profile,
        title: card.title,
        address: card.address,
      }] : []),
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
  const interruptTargetKey = activeTurnKey(
    expectedRunId, projectId, deckId, authorization.userId,
  );
  try {
    const target = activeTurnInterruptTargets.get(interruptTargetKey);
    if (!target) return res.status(409).json({ ok: false, error: 'no_active_turn' });
    const client = await hermesGateway();
    activeTurnInterruptTargets.set(interruptTargetKey, { ...target, stopRequested: true });
    const interrupted = record(await client.request('session.interrupt', {
      session_id: target.sessionId,
      expected_submission_id: target.submissionId,
    }));
    if (interrupted.status !== 'interrupted') {
      const active = activeTurnInterruptTargets.get(interruptTargetKey);
      if (active) activeTurnInterruptTargets.set(interruptTargetKey, { ...active, stopRequested: false });
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    return res.json({ ok: true, runId: expectedRunId, state: 'stopping' });
  } catch (error) {
    const active = activeTurnInterruptTargets.get(interruptTargetKey);
    if (active) {
      activeTurnInterruptTargets.set(interruptTargetKey, { ...active, stopRequested: false });
    }
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_run_stop_failed',
    });
  }
});

export default mainSessionRoutes;
