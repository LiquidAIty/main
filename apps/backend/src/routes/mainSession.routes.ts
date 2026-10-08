import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Router, type Request, type Response } from 'express';
import {
  appendSharedConversationReplyOnce,
  appendSharedConversationTurn,
  getConversationMessages,
  listConversations,
  type ConversationMessage,
  type SharedChatParticipant,
} from '../conversations/store';
import { BUILDER_CARD_ID, BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { getProjectCard } from '../services/agentBuilderStore';
import {
  hermesGateway,
  type HermesGatewayClient,
  type HermesGatewayEvent,
} from '../services/hermesGateway';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import {
  internalMcpAuthorization,
  internalMcpBridgeSecretAuthorized,
  resolveInternalMcpUrl,
} from '../services/mcp/internalMcpAuth';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { readPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import {
  resolveProductChatWorkingDirectory,
  resolveRepoRoot,
} from '../services/workspaceRoot';
import type { AgentCardInstance, DeckDocument } from '../types';
import {
  materializeSavedCardProfile,
  savedCardBotRoster,
} from '../hermes/profileMaterialization';

export const mainSessionRoutes = Router();

const ADDRESS_PATTERN = /^@([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\s|$)/;
const MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_PARTICIPANT: SharedChatParticipant = { kind: 'user', label: 'You' };

export type AddressableCard = {
  card: AgentCardInstance;
  cardRevisionId: string;
  profile: string;
  title: string;
  address?: string;
  aliases: string[];
};

export type SharedChatAuthority = {
  deck: DeckDocument;
  main: AddressableCard;
  cards: AddressableCard[];
};

export type SessionBinding = {
  sessionId: string;
  storedSessionId: string;
  info: Record<string, unknown>;
};

type PreparedRun = {
  runId: string;
  cardId: string;
  request: Record<string, unknown>;
  prepared: Record<string, any>;
};

type DynamicToolDefinition = {
  type: 'function';
  name: string;
  canonical_name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type SavedSpecialistOperation = 'thinkgraph.reason' | 'knowgraph.research';

type ThinkGraphRevisionEvent = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'settled';
  revision: string;
  changedNodeIds: string[];
  changedEdgeIds: string[];
  affectedNodeIds: string[];
  newMainSubjects: Array<Record<string, unknown>>;
};

type ThinkGraphLifecycleFailure = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'prepare' | 'thinkgraph_card' | 'settle';
  error: string;
};

const SPECIALIST_TARGETS: Record<SavedSpecialistOperation, string> = {
  'thinkgraph.reason': 'card_thinkgraph',
  'knowgraph.research': 'card_knowgraph',
};
const thinkGraphStreams = new Map<string, Set<Response>>();

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

function requireSpecialistConfiguration(
  operation: SavedSpecialistOperation,
  target: AddressableCard,
): void {
  if (target.card.runtime.kind !== 'hermes' || target.card.runtime.mode !== 'delegate') {
    throw new Error('saved_specialist_runtime_invalid');
  }
  const runtimeOptions = record(target.card.runtimeOptions);
  const tools = new Set(exactStrings(runtimeOptions.tools));
  if (operation === 'thinkgraph.reason') {
    if (!tools.has('engraphis_recall_context')) {
      throw new Error('thinkgraph_recall_grant_required');
    }
    return;
  }
  const skills = new Set(exactStrings(runtimeOptions.skills));
  const toolsets = new Set(exactStrings(runtimeOptions.toolsets));
  if (!toolsets.has('web')) throw new Error('knowgraph_web_toolset_required');
  if (!skills.has('grounded-citations')) {
    throw new Error('knowgraph_grounded_citations_skill_required');
  }
  if (!tools.has('graphiti.add_memory')) {
    throw new Error('knowgraph_add_memory_grant_required');
  }
}

function dynamicToolDefinitions(value: unknown): DynamicToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const seenNames = new Set<string>();
  return value.map(record).map((definition, index) => {
    const canonicalName = String(definition.canonicalId || '').trim();
    const publications = exactStrings(definition.publications);
    const inputSchema = record(definition.inputSchema);
    if (
      !canonicalName
      || definition.available !== true
      || !publications.some((item) => item === 'card-runtime' || item === 'external-mcp')
      || !Object.keys(inputSchema).length
    ) {
      throw new Error(`dynamic_tool_contract_unavailable:${canonicalName || index}`);
    }
    const stem = canonicalName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 72)
      || `tool_${index + 1}`;
    const suffix = createHash('sha256').update(canonicalName).digest('hex').slice(0, 10);
    const name = `card__${stem}__${suffix}`;
    if (seenNames.has(name)) throw new Error(`dynamic_tool_name_collision:${canonicalName}`);
    seenNames.add(name);
    return {
      type: 'function' as const,
      name,
      canonical_name: canonicalName,
      description: String(definition.description || ''),
      input_schema: inputSchema,
    };
  });
}

function enabledCard(card: AgentCardInstance): boolean {
  const saved = card.runtimeOptions as (Record<string, unknown> & { enabled?: boolean }) | null | undefined;
  return (card as AgentCardInstance & { enabled?: boolean }).enabled !== false
    && saved?.enabled !== false;
}

function addressableCard(card: AgentCardInstance): AddressableCard {
  const cardId = String(card.id || '').trim();
  const cardRevisionId = String(card._cardRevisionId || '').trim();
  const profile = String(card.runtime?.profile || '').trim();
  const title = String(card.title || '').trim();
  if (!cardId || !cardRevisionId || !profile || !title || !enabledCard(card)) {
    throw new Error('shared_chat_card_invalid');
  }
  const address = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(title) ? title : undefined;
  return {
    card,
    cardRevisionId,
    profile,
    title,
    ...(address ? { address } : {}),
    aliases: [...new Set([cardId, profile, ...(address ? [address] : [])]
      .map((value) => value.toLowerCase()))],
  };
}

async function authorizeProject(req: Request, res: Response, projectId: string): Promise<string | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'main_owner_authentication_required' });
    return null;
  }
  const project = await getProjectCard(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'main_project_access_denied' });
    return null;
  }
  return userId;
}

export async function sharedChatAuthority(projectId: string, deckId: string): Promise<SharedChatAuthority> {
  const loaded = await getDeckDocument(projectId, deckId);
  if (!loaded.deck) throw new Error('deck_not_found');
  const cards = loaded.deck.nodes.filter(enabledCard).map(addressableCard);
  const mains = cards.filter(({ card }) => card.runtime.kind === 'hermes' && card.runtime.mode === 'main');
  if (mains.length !== 1) throw new Error('main_card_identity_invalid');
  return { deck: loaded.deck, main: mains[0], cards };
}

function participant(card: AddressableCard): SharedChatParticipant {
  return {
    kind: 'card',
    label: card.title,
    cardId: card.card.id,
    profile: card.profile,
    ...(card.address ? { address: card.address } : {}),
  };
}

function participantFromMessage(
  message: ConversationMessage,
  kind: 'shared_chat_speaker' | 'shared_chat_target',
): SharedChatParticipant | null {
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

function sharedMessage(message: ConversationMessage) {
  const speaker = participantFromMessage(message, 'shared_chat_speaker')
    || (message.role === 'user' ? USER_PARTICIPANT : null);
  if (!speaker || (message.role !== 'user' && message.role !== 'assistant')) return null;
  const target = participantFromMessage(message, 'shared_chat_target');
  return {
    messageId: message.messageId,
    seq: message.seq,
    role: message.role,
    text: message.content,
    speaker,
    ...(target ? { target } : {}),
  };
}

function boundedSharedContext(messages: ConversationMessage[]): Array<Record<string, string>> {
  const result: Array<Record<string, string>> = [];
  let characters = 0;
  for (const message of messages.slice(-24)) {
    const visible = sharedMessage(message);
    if (!visible) continue;
    characters += visible.text.length;
    if (characters > 12_000) break;
    result.push({
      role: visible.role,
      speakerCardId: visible.speaker.cardId || '',
      speakerLabel: visible.speaker.label,
      targetCardId: visible.target?.cardId || '',
      targetLabel: visible.target?.label || '',
      content: visible.text,
    });
  }
  return result;
}

function sessionTitle(args: {
  userId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId: string;
}): string {
  const digest = createHash('sha256').update(JSON.stringify([
    args.userId,
    args.projectId,
    args.deckId,
    args.cardId,
    args.conversationId,
  ])).digest('hex');
  return `Card Chat:${digest}`;
}

function cardWorkingDirectory(
  authority: SharedChatAuthority,
  card: AddressableCard,
  projectId: string,
  conversationId: string,
): string {
  if (card.card.id === BUILDER_CARD_ID) {
    const saved = String(authority.deck.workspaceRoot || '').trim();
    return saved && existsSync(saved) ? saved : resolveRepoRoot();
  }
  return resolveProductChatWorkingDirectory(`${projectId}:${card.card.id}:${conversationId}`);
}

function sessionRows(value: unknown): Array<Record<string, any>> {
  const rows = record(value).sessions;
  if (!Array.isArray(rows)) throw new Error('hermes_session_list_invalid');
  return rows.map(record);
}

function sessionResult(value: unknown): SessionBinding {
  const result = record(value);
  const sessionId = String(result.session_id || '').trim();
  const storedSessionId = String(result.stored_session_id || result.session_key || '').trim();
  if (!sessionId || !storedSessionId) throw new Error('hermes_session_binding_invalid');
  return { sessionId, storedSessionId, info: record(result.info) };
}

export async function cardSession(
  client: HermesGatewayClient,
  authority: SharedChatAuthority,
  card: AddressableCard,
  owner: { userId: string; projectId: string; deckId: string; conversationId: string },
): Promise<SessionBinding> {
  const title = sessionTitle({ ...owner, cardId: card.card.id });
  const roster = savedCardBotRoster(authority.deck, card.card);
  const profile = card.profile;
  const profileState = record(await materializeSavedCardProfile(
    (method, params = {}) => client.request(method, params),
    card.card,
  ));
  const profileModel = record(profileState.model);
  const completeBinding = (binding: SessionBinding): SessionBinding => ({
    ...binding,
    info: {
      provider: String(profileModel.provider || ''),
      model: String(profileModel.default || ''),
      ...binding.info,
    },
  });
  const listed = sessionRows(await client.request('session.list', {
    profile,
    title,
    include_hidden: true,
    limit: 200,
  }));
  if (listed.length > 1) throw new Error('hermes_session_binding_ambiguous');
  if (listed.length === 1) {
    const stored = String(listed[0].resolved_id || listed[0].id || '').trim();
    if (!stored) throw new Error('hermes_session_binding_invalid');
    return completeBinding(sessionResult(await client.request('session.resume', {
      session_id: stored,
      profile,
      omit_messages: true,
      close_on_disconnect: false,
      bot_mode_roster: roster,
    })));
  }
  return completeBinding(sessionResult(await client.request('session.create', {
    profile,
    title,
    cwd: cardWorkingDirectory(authority, card, owner.projectId, owner.conversationId),
    source: 'desktop',
    hidden: true,
    close_on_disconnect: false,
    follow_profile_config: true,
    bot_mode_roster: roster,
  })));
}

function selectTarget(
  authority: SharedChatAuthority,
  message: string,
  targetCardId: string,
): AddressableCard {
  const address = ADDRESS_PATTERN.exec(message)?.[1]?.toLowerCase() || '';
  const selected = targetCardId
    ? authority.cards.filter((card) => card.card.id === targetCardId)
    : [];
  if (targetCardId && selected.length !== 1) throw new Error('target_card_unavailable');
  const addressed = address
    ? authority.cards.filter((card) => card.aliases.includes(address))
    : [];
  if (address && addressed.length !== 1) {
    throw new Error(addressed.length ? 'addressed_card_ambiguous' : 'addressed_card_unavailable');
  }
  if (selected[0] && addressed[0] && selected[0].card.id !== addressed[0].card.id) {
    throw new Error('shared_chat_target_mismatch');
  }
  return selected[0] || addressed[0] || authority.main;
}

async function prepareRun(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  message: string;
  target: AddressableCard;
  main: AddressableCard;
  priorMessages: ConversationMessage[];
  dataAnchors: unknown[];
  images: unknown[];
  runId?: string;
  originatingRunId?: string;
  onAccepted?(runId: string): void;
}): Promise<PreparedRun> {
  const runId = args.runId || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const toolCatalog = await readPythonAgentMcpCatalog();
  const payload = {
    projectId: args.projectId,
    deckId: args.deckId,
    cardId: args.target.card.id,
    runId,
    correlationId: runId,
    acceptedAt: new Date().toISOString(),
    conversationId: args.conversationId,
    dataAnchors: args.dataAnchors,
    images: args.images,
    sharedConversation: boundedSharedContext(args.priorMessages),
    sharedConversationTargetLabel: args.target.title,
    discoveredTools: toolCatalog.tools,
    discoveredToolCatalogState: toolCatalog.state,
    unavailableToolCatalogFamilies: toolCatalog.unavailableFamilies,
    discoveredToolFailures: toolCatalog.toolFailures,
    ...(args.originatingRunId ? { originatingRunId: args.originatingRunId } : {}),
  };
  const direct = args.target.card.id !== args.main.card.id;
  const prepared = record(await requestPythonRailsJson(
    direct ? '/domain/runs/begin' : '/domain/main/runs/begin',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(direct
        ? { ...payload, assignment: args.message }
        : { ...payload, message: args.message }),
    },
  ));
  args.onAccepted?.(runId);
  const transport = record(prepared.hermesTransport);
  const request = record(transport.request);
  if (
    String(prepared.runId || '') !== runId
    || String(transport.cardIdentity?.cardId || '') !== args.target.card.id
    || String(request.runtime?.profile || '') !== args.target.profile
    || !String(request.message || '').trim()
  ) {
    throw new Error('saved_card_preparation_identity_mismatch');
  }
  return { runId, cardId: args.target.card.id, request, prepared };
}

async function attachImages(
  client: HermesGatewayClient,
  binding: SessionBinding,
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
      session_id: binding.sessionId,
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
  profile: string;
  text: string;
  submissionId: string;
  dynamicTools: DynamicToolDefinition[];
  toolEndpoint: string;
  toolAuthorization: string;
  onEvent(event: HermesGatewayEvent): void;
  signal?: AbortSignal;
  interrupt?(): Promise<void>;
  onSubmissionIssued?(): void;
}): Promise<{ text: string; event: HermesGatewayEvent; toolCalls: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let interruptionStarted = false;
    let toolCalls = 0;
    let submitStatus = '';
    let ownTurnStarted = false;
    let submitRequested = false;
    let submitSettled = false;
    let pendingInterruptError: Error | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let detach: () => void = () => undefined;
    const onAbort = () => fail(new Error('hermes_turn_cancelled'), true);
    const finish = (error?: Error, value?: { text: string; event: HermesGatewayEvent }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach();
      args.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve({ ...value!, toolCalls });
    };
    const beginInterrupt = (error: Error) => {
      if (settled) return;
      if (!args.interrupt) {
        finish(error);
        return;
      }
      if (interruptionStarted) return;
      interruptionStarted = true;
      void args.interrupt().then(
        () => finish(error),
        (interruptError) => finish(new Error(
          `hermes_target_interrupt_failed:${interruptError instanceof Error
            ? interruptError.message
          : String(interruptError)}`,
        )),
      );
    };
    const fail = (error: Error, interrupt: boolean) => {
      if (settled) return;
      if (!interrupt || !args.interrupt) {
        finish(error);
        return;
      }
      if (submitRequested && !submitSettled) {
        pendingInterruptError ||= error;
        return;
      }
      beginInterrupt(error);
    };
    detach = args.client.onEvent((event) => {
      if (event.session_id !== args.binding.sessionId) return;
      const eventSubmissionId = String(event.payload?.submission_id || '');
      if (event.type === 'prompt.submission.started') {
        if (eventSubmissionId !== args.submissionId) return;
        ownTurnStarted = true;
      }
      if (!ownTurnStarted) return;
      if (eventSubmissionId && eventSubmissionId !== args.submissionId) return;
      args.onEvent(event);
      if (event.type === 'tool.start') toolCalls += 1;
      if (event.type === 'error') {
        fail(new Error(String(event.payload?.message || 'hermes_turn_failed')), false);
        return;
      }
      if (event.type !== 'message.complete') return;
      const status = String(event.payload?.status || 'complete');
      const text = String(event.payload?.text || '');
      if (['error', 'failed'].includes(status)) {
        fail(new Error(String(event.payload?.error || text || 'hermes_turn_failed')), false);
        return;
      }
      finish(undefined, { text, event });
    });
    timer = setTimeout(() => fail(new Error('hermes_turn_timeout'), true), 30 * 60_000);
    timer.unref?.();
    args.signal?.addEventListener('abort', onAbort, { once: true });
    if (args.signal?.aborted) {
      onAbort();
      return;
    }
    submitRequested = true;
    void args.client.request<Record<string, unknown>>('prompt.submit', {
      session_id: args.binding.sessionId,
      profile: args.profile,
      text: args.text,
      queued: true,
      submission_id: args.submissionId,
      ...(args.dynamicTools.length ? {
        dynamic_tools: args.dynamicTools,
        tool_endpoint: args.toolEndpoint,
        tool_authorization: args.toolAuthorization,
      } : {}),
    }).then((submitted) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      if (pendingInterruptError) {
        beginInterrupt(pendingInterruptError);
        return;
      }
      submitStatus = String(submitted.status || 'streaming');
      if (!['streaming', 'queued'].includes(submitStatus)) {
        fail(new Error(`hermes_submit_status_unsupported:${submitStatus || 'missing'}`), true);
      }
    }).catch((error) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      beginInterrupt(
        pendingInterruptError
        || (error instanceof Error ? error : new Error(String(error))),
      );
    });
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
  binding: SessionBinding;
  result?: { text: string; event: HermesGatewayEvent; toolCalls: number };
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
      hermesSessionRef: args.binding.storedSessionId,
      effectiveProvider: String(provider.provider || requestedProvider.provider || ''),
      providerApiMode: String(runtimeOptions.openaiRuntime || ''),
      model: String(provider.model || requestedProvider.providerModelId || ''),
      provider: String(provider.provider || requestedProvider.provider || ''),
      toolCallCount: args.result?.toolCalls ?? 0,
      ...usage,
    }),
  });
}

async function failAcceptedRun(
  runId: string,
  error: unknown,
  binding?: SessionBinding | null,
): Promise<void> {
  await requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      state: 'failed',
      errorCode: 'hermes_turn_failed',
      errorSummary: error instanceof Error ? error.message : String(error),
      ...(binding?.storedSessionId ? { hermesSessionRef: binding.storedSessionId } : {}),
    }),
  });
}

async function interruptSubmission(
  client: HermesGatewayClient,
  binding: SessionBinding,
  submissionId: string,
): Promise<void> {
  const interrupted = record(await client.request('session.interrupt', {
    session_id: binding.sessionId,
    expected_submission_id: submissionId,
  }));
  if (interrupted.status !== 'interrupted') {
    throw new Error('hermes_target_submission_not_active');
  }
}

export function createMainSessionInternalRouter(): Router {
  const router = Router();
  router.post('/internal/specialists', async (req, res) => {
    if (!isLoopbackSocketRequest(req)
      || !internalMcpBridgeSecretAuthorized(req.headers['x-liquidaity-internal-mcp-secret'])) {
      return res.status(403).json({ ok: false, error: 'saved_specialist_authorization_required' });
    }
    const body = record(req.body);
    const operation = String(body.operation || '') as SavedSpecialistOperation;
    const request = String(body.request || '');
    const projectId = String(body.projectId || '').trim();
    const deckId = String(body.deckId || '').trim();
    const conversationId = String(body.conversationId || '').trim();
    const sourceCardId = String(body.sourceCardId || '').trim();
    const sourceRunId = String(body.sourceRunId || '').trim();
    const dataAnchors = body.dataAnchors === undefined ? [] : body.dataAnchors;
    const allowedKeys = new Set([
      'operation', 'request', 'dataAnchors', 'projectId', 'deckId',
      'conversationId', 'sourceCardId', 'sourceRunId',
    ]);
    if (
      !(operation in SPECIALIST_TARGETS)
      || !request.trim()
      || request.length > 20_000
      || !projectId
      || !deckId
      || !conversationId
      || !sourceCardId
      || !sourceRunId
      || !Array.isArray(dataAnchors)
      || dataAnchors.length > 16
      || dataAnchors.some((value) => !Object.keys(record(value)).length)
      || Object.keys(body).some((key) => !allowedKeys.has(key))
    ) {
      return res.status(400).json({ ok: false, error: 'saved_specialist_request_invalid' });
    }

    let authority: SharedChatAuthority;
    let source: AddressableCard;
    let target: AddressableCard;
    let ownerUserId: string;
    try {
      const project = await getProjectCard(projectId);
      ownerUserId = String(project?.ownerUserId || '').trim();
      if (!ownerUserId) throw new Error('saved_specialist_project_unavailable');
      authority = await sharedChatAuthority(projectId, deckId);
      const sources = authority.cards.filter((card) => card.card.id === sourceCardId);
      const targets = authority.cards.filter(
        (card) => card.card.id === SPECIALIST_TARGETS[operation],
      );
      if (sources.length !== 1) throw new Error('saved_specialist_source_card_unavailable');
      if (targets.length !== 1) throw new Error('saved_specialist_target_card_unavailable');
      source = sources[0];
      target = targets[0];
      if (source.card.id === target.card.id) throw new Error('saved_specialist_self_call_rejected');
      requireSpecialistConfiguration(operation, target);
      const sourceRead = record(await requestPythonRailsJson('/domain/runs/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          deckId,
          conversationId,
          runId: sourceRunId,
        }),
      }));
      const sourceRun = record(sourceRead.run);
      if (
        String(sourceRun.runId || '') !== sourceRunId
        || String(sourceRun.projectId || '') !== projectId
        || String(sourceRun.deckId || '') !== deckId
        || String(sourceRun.conversationId || '') !== conversationId
        || String(sourceRun.cardId || '') !== sourceCardId
        || String(sourceRun.state || '') !== 'running'
      ) {
        throw new Error('saved_specialist_source_run_unavailable');
      }
    } catch (error) {
      return res.status(409).json({
        ok: false,
        error: error instanceof Error ? error.message : 'saved_specialist_authority_unavailable',
      });
    }

    const childRunId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const abortController = new AbortController();
    let client: HermesGatewayClient | null = null;
    let binding: SessionBinding | null = null;
    let run: PreparedRun | null = null;
    let runAccepted = false;
    let settlementAttempted = false;
    let submissionIssued = false;
    let interruptPromise: Promise<void> | null = null;
    let responseFinished = false;
    const interruptTarget = (): Promise<void> => {
      if (!client || !binding || !submissionIssued) return Promise.resolve();
      if (!interruptPromise) {
        interruptPromise = interruptSubmission(client, binding, childRunId);
      }
      return interruptPromise;
    };
    const abortRequest = () => {
      if (!responseFinished && !res.writableEnded) {
        abortController.abort();
      }
    };
    req.once('aborted', abortRequest);
    res.once('close', abortRequest);

    const settle = async (
      result?: { text: string; event: HermesGatewayEvent; toolCalls: number },
      error?: unknown,
    ): Promise<void> => {
      if (!runAccepted || settlementAttempted) return;
      settlementAttempted = true;
      if (run && binding) {
        await finishRun({ run, binding, result, error });
      } else {
        await failAcceptedRun(childRunId, error || new Error('saved_specialist_preparation_failed'), binding);
      }
    };

    try {
      run = await prepareRun({
        projectId,
        deckId,
        conversationId,
        message: request,
        target,
        main: authority.main,
        priorMessages: [],
        dataAnchors,
        images: [],
        runId: childRunId,
        originatingRunId: sourceRunId,
        onAccepted: () => { runAccepted = true; },
      });
      if (abortController.signal.aborted) throw new Error('saved_specialist_cancelled');
      const requiredTargetTool = operation === 'thinkgraph.reason'
        ? 'engraphis_recall_context'
        : 'graphiti.add_memory';
      if (!exactStrings(run.request.enabledTools).includes(requiredTargetTool)) {
        throw new Error('saved_specialist_required_tool_unavailable');
      }
      client = await hermesGateway();
      binding = await cardSession(client, authority, target, {
        userId: ownerUserId,
        projectId,
        deckId,
        conversationId,
      });
      if (abortController.signal.aborted) throw new Error('saved_specialist_cancelled');
      const dynamicTools = dynamicToolDefinitions(run.request.toolDefinitions);
      const runtime = record(run.request.runtime);
      if (runtime.kind !== 'hermes' || runtime.mode !== 'delegate') {
        throw new Error('saved_specialist_runtime_identity_mismatch');
      }
      const toolAuthorization = internalMcpAuthorization({
        kind: 'card-runtime',
        projectId,
        deckId,
        conversationId,
        parentRunId: childRunId,
        callerCardId: target.card.id,
        callerRuntimeKind: 'hermes',
        callerRuntimeMode: 'delegate',
        grantedTools: exactStrings(run.request.enabledTools),
        presentedTools: dynamicTools.map((tool) => tool.canonical_name),
      });
      const result = await submitTurn({
        client,
        binding,
        profile: target.profile,
        text: String(run.request.message),
        submissionId: childRunId,
        dynamicTools,
        toolEndpoint: resolveInternalMcpUrl(),
        toolAuthorization,
        signal: abortController.signal,
        interrupt: interruptTarget,
        onSubmissionIssued: () => { submissionIssued = true; },
        onEvent: () => undefined,
      });
      if (!result.text.trim()) throw new Error('hermes_empty_response');
      await settle(result);
      responseFinished = true;
      return res.json({
        ok: true,
        status: 'completed',
        operation,
        targetCardId: target.card.id,
        targetRunId: childRunId,
        targetCardRevisionId: target.cardRevisionId,
        result: result.text,
      });
    } catch (caught) {
      let error: unknown = caught;
      try {
        await settle(undefined, caught);
      } catch (settlementError) {
        error = new Error(
          `saved_specialist_run_settlement_failed:${settlementError instanceof Error
            ? settlementError.message
            : String(settlementError)}`,
        );
      }
      if (!res.destroyed && !res.writableEnded) {
        responseFinished = true;
        return res.status(502).json({
          ok: false,
          status: 'failed',
          operation,
          targetCardId: target.card.id,
          targetRunId: childRunId,
          error: error instanceof Error ? error.message : 'saved_specialist_execution_failed',
        });
      }
      return undefined;
    } finally {
      responseFinished = true;
      req.off('aborted', abortRequest);
      res.off('close', abortRequest);
    }
  });
  return router;
}

export const mainSessionInternalRoutes = createMainSessionInternalRouter();

mainSessionRoutes.post('/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'main').trim();
  const message = String(req.body?.message || '');
  const clientMessageId = String(req.body?.clientMessageId || '').trim();
  const clientReplyMessageId = String(req.body?.clientReplyMessageId || '').trim();
  const targetCardId = typeof req.body?.targetCardId === 'string'
    ? req.body.targetCardId.trim()
    : '';
  if (!projectId || !conversationId || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'project_conversation_message_required' });
  }
  if (
    !MESSAGE_ID_PATTERN.test(clientMessageId)
    || !MESSAGE_ID_PATTERN.test(clientReplyMessageId)
    || clientMessageId === clientReplyMessageId
  ) {
    return res.status(400).json({ ok: false, error: 'shared_chat_message_identity_invalid' });
  }
  let userId: string | null;
  try {
    userId = await authorizeProject(req, res, projectId);
  } catch {
    return res.status(503).json({ ok: false, error: 'main_project_authority_unavailable' });
  }
  if (!userId) return undefined;

  let authority: SharedChatAuthority;
  let target: AddressableCard;
  let priorMessages: ConversationMessage[];
  try {
    authority = await sharedChatAuthority(projectId, deckId);
    target = selectTarget(authority, message, targetCardId);
    priorMessages = await getConversationMessages(projectId, conversationId);
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'shared_chat_authority_unavailable',
    });
  }

  let run: PreparedRun;
  try {
    run = await prepareRun({
      projectId,
      deckId,
      conversationId,
      message,
      target,
      main: authority.main,
      priorMessages,
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
  const directAddressed = target.card.id !== authority.main.card.id;
  const identity = {
    projectId,
    deckId,
    conversationId,
    cardId: target.card.id,
    runId: run.runId,
    participant: participant(target),
    directAddressed,
    userMessageId: clientMessageId,
    assistantMessageId: clientReplyMessageId,
  };
  writeSse(res, 'run', { ...identity, state: 'preparing' });

  let binding: SessionBinding | null = null;
  try {
    const client = await hermesGateway();
    binding = await cardSession(client, authority, target, {
      userId,
      projectId,
      deckId,
      conversationId,
    });
    await attachImages(client, binding, target.profile, run.request.images);
    const dynamicTools = dynamicToolDefinitions(run.request.toolDefinitions);
    const runtime = record(run.request.runtime);
    const runtimeMode = String(runtime.mode || '').trim();
    if (!['main', 'delegate', 'magentic_one'].includes(runtimeMode)) {
      throw new Error('dynamic_tool_runtime_mode_invalid');
    }
    const toolAuthorization = internalMcpAuthorization({
      kind: 'card-runtime',
      projectId,
      deckId,
      conversationId,
      parentRunId: run.runId,
      callerCardId: target.card.id,
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: runtimeMode as 'main' | 'delegate' | 'magentic_one',
      grantedTools: exactStrings(run.request.enabledTools),
      presentedTools: dynamicTools.map((tool) => tool.canonical_name),
    });
    await appendSharedConversationTurn({
      projectId,
      conversationId,
      messages: [{
        messageId: clientMessageId,
        role: 'user',
        content: message,
        speaker: USER_PARTICIPANT,
        target: participant(target),
      }],
    });
    writeSse(res, 'session', {
      ...identity,
      runtimeSessionId: binding.sessionId,
      hermesSessionId: binding.sessionId,
      storedSessionId: binding.storedSessionId,
      configuration: {
        profile: target.profile,
        unavailableTools: exactStrings(run.request.unavailableTools),
      },
    });
    writeSse(res, 'run', { ...identity, state: 'running' });
    const result = await submitTurn({
      client,
      binding,
      profile: target.profile,
      text: String(run.request.message),
      submissionId: run.runId,
      dynamicTools,
      toolEndpoint: resolveInternalMcpUrl(),
      toolAuthorization,
      onEvent: (event) => {
        if (event.type === 'message.delta') {
          writeSse(res, 'text', { ...identity, text: String(event.payload?.text || '') });
        } else if (event.type.includes('reasoning')) {
          writeSse(res, 'reasoning', { ...identity, event });
        } else if (event.type === 'tool.start') {
          writeSse(res, 'tool_start', { ...identity, event });
        } else if (event.type === 'tool.complete') {
          writeSse(res, 'tool_result', { ...identity, event });
        }
      },
    });
    if (!result.text.trim()) throw new Error('hermes_empty_response');
    await finishRun({ run, binding, result });
    await appendSharedConversationReplyOnce({
      projectId,
      conversationId,
      message: {
        messageId: clientReplyMessageId,
        role: 'assistant',
        content: result.text,
        speaker: participant(target),
        target: USER_PARTICIPANT,
        providerContinuationRef: binding.storedSessionId,
        providerMessageId: `run:${run.runId}`,
      },
    });
    writeSse(res, 'done', { ...identity, fullText: result.text });
  } catch (error) {
    if (binding) await finishRun({ run, binding, error }).catch(() => undefined);
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

mainSessionRoutes.get('/history', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || 'main').trim();
  if (!projectId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'project_conversation_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const messages = (await getConversationMessages(projectId, conversationId))
      .map(sharedMessage)
      .filter((message): message is NonNullable<ReturnType<typeof sharedMessage>> => message !== null);
    return res.json({
      ok: true,
      runtimeSessionId: '',
      sessionId: '',
      mainCardId: authority.main.card.id,
      addressableAgents: authority.cards
        .filter((card) => card.card.id !== authority.main.card.id)
        .map((card) => ({
          cardId: card.card.id,
          cardRevisionId: card.cardRevisionId,
          profile: card.profile,
          title: card.title,
          address: card.address || '',
          aliases: card.aliases,
        })),
      messages,
      runtimeEvents: [],
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_history_read_failed',
    });
  }
});

mainSessionRoutes.get('/conversations', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'project_id_required' });
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  return res.json({ ok: true, conversations: await listConversations(projectId) });
});

mainSessionRoutes.get('/events', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || 'main').trim();
  const runtimeSessionId = String(req.query.runtimeSessionId || '').trim();
  const hermesSessionId = String(req.query.hermesSessionId || '').trim();
  if (!projectId || !conversationId || !runtimeSessionId || runtimeSessionId !== hermesSessionId) {
    return res.status(400).json({ ok: false, error: 'main_hermes_event_scope_invalid' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  const authority = await sharedChatAuthority(projectId, deckId);
  const client = await hermesGateway();
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const detach = client.onEvent((event) => {
    if (event.session_id !== hermesSessionId || !Number.isSafeInteger(event.seq)) return;
    res.write(`event: gateway\ndata: ${JSON.stringify({
      projectId,
      deckId,
      conversationId,
      cardId: authority.main.card.id,
      runtimeSessionId,
      hermesSessionId,
      event,
    })}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    detach();
  });
  return undefined;
});

mainSessionRoutes.post('/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  const expectedCardId = String(req.body?.expectedCardId || '').trim();
  if (!projectId || !deckId || !conversationId || !expectedRunId) {
    return res.status(400).json({ ok: false, error: 'project_conversation_and_expected_run_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const matches = expectedCardId
      ? authority.cards.filter((item) => item.card.id === expectedCardId)
      : [authority.main];
    if (matches.length !== 1) {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    const target = matches[0];
    const client = await hermesGateway();
    const title = sessionTitle({ userId, projectId, deckId, cardId: target.card.id, conversationId });
    const storedRows = sessionRows(await client.request('session.list', {
      profile: target.profile,
      title,
      include_hidden: true,
      limit: 200,
    }));
    if (storedRows.length !== 1) {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    const storedSessionId = String(storedRows[0].resolved_id || storedRows[0].id || '').trim();
    const active = record(await client.request('session.active_list', { profile: target.profile })).sessions;
    const sessions = Array.isArray(active) ? active.map(record) : [];
    const activeMatches = sessions.filter((item) => (
      String(item.session_key || '').trim() === storedSessionId
    ));
    if (activeMatches.length !== 1) {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    const sessionId = String(activeMatches[0].id || '').trim();
    if (!sessionId) return res.status(409).json({ ok: false, error: 'no_active_turn' });
    const interrupted = record(await client.request('session.interrupt', {
      session_id: sessionId,
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
