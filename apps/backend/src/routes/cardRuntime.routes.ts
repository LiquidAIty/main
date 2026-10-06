import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  agentTerminalManager,
  agentTerminalPresentationOptions,
  requireAgentTerminalCard,
  resolveHermesBotRosterProjections,
  type AgentTerminalCompactionIdentity,
  type AgentTerminalGatewayEvent,
  type AgentTerminalOwner,
  type HermesBotRosterProjection,
} from '../hermes/agentTerminal';
import { cardTurnBridge } from '../hermes/runtime/cardTurn';
import { buildCardTerminal } from '../hermes/cardTerminal';
import {
  appendSharedConversationTurn,
  getConversationMessages,
  listConversations,
  type ConversationMessage,
  type SharedChatParticipant,
} from '../conversations/store';
import { getProjectCard } from '../services/agentBuilderStore';
import { logHarnessTrace, redactTrace } from '../services/harnessTrace';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveExternalIdentityMainGrant } from '../auth/externalIdentityGrantStore';
import {
  describeConnectedAgents,
  requestPythonRailsJson,
} from '../services/pythonRailsClient';
import { readPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import {
  internalMcpBridgeSecretAuthorized,
  type InternalMcpPrincipal,
} from '../services/mcp/internalMcpAuth';
import type { AgentCardInstance, DeckDocument } from '../types';
import { listConfiguredModelOptions } from '../llm/models.config';
import {
  HERMES_KANBAN_TASK_STATUSES,
  type HermesKanbanTaskProjection,
  type HermesKanbanTaskStatus,
} from './hermesKanban.routes';

const router = Router();
export const mainRoutes = Router();
export const internalMainMcpRoutes = Router();

async function authorizeMainProject(req: Request, res: Response, projectId: string): Promise<boolean> {
  const userId = typeof (req as any).userId === 'string' ? (req as any).userId.trim() : '';
  if (!userId) {
    res.status(401).json({ ok: false, error: 'main_owner_authentication_required' });
    return false;
  }
  try {
    const project = await getProjectCard(projectId);
    if (!project?.ownerUserId?.trim() || project.ownerUserId.trim() !== userId) {
      res.status(403).json({ ok: false, error: 'main_project_access_denied' });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ ok: false, error: 'main_project_authority_unavailable' });
    return false;
  }
}

type RemoteMainDriverSource = 'internal_chat' | 'external_plugin';

function contextAuthorityModeForDriver(
  driverSource: RemoteMainDriverSource,
): 'main_native_honcho' | 'plugin_context_only' {
  return driverSource === 'external_plugin' ? 'plugin_context_only' : 'main_native_honcho';
}

type PreparedMainCliRun = {
  projectId: string;
  deckId: string;
  conversationId: string;
  runId: string;
  cardId: string;
  driverSource: RemoteMainDriverSource;
  prepared: any;
  savedDeck: any;
  savedCard: any;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRoundedDecisionDistribution(values: number[]): boolean {
  if (values.length === 0 || values.every((value) => value === 0)) return false;
  const halfStep = 0.005;
  const lower = values.reduce((sum, value) => sum + Math.max(0, value - halfStep), 0);
  const upper = values.reduce((sum, value) => sum + Math.min(1, value + halfStep), 0);
  const arithmeticTolerance = 1e-12;
  return lower <= 1 + arithmeticTolerance && upper >= 1 - arithmeticTolerance;
}


function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function preparedRequestFulfillmentAssessment(
  value: unknown,
  expectedRunId: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('request_fulfillment_receipt_invalid');
  const allowed = new Set([
    'schemaVersion', 'metric', 'rubricVersion', 'status', 'runId',
    'cardRevisionId', 'idfSha256', 'outputSha256', 'executionEvidenceSha256',
    'exposedToolsSha256', 'executionEvidenceComplete', 'executionEvidenceError',
    'actualProvider', 'actualModel', 'requestedModel', 'scale', 'evaluatedAt',
    'failureReason', 'requestCount', 'questionCount', 'timingMs', 'rawScore',
    'normalizedScore100', 'probabilities', 'confidence', 'provider',
    'resolvedModel', 'decisionId', 'usage',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || value.schemaVersion !== 'request-fulfillment-assessment.v1'
    || value.metric !== 'request_fulfillment'
    || value.rubricVersion !== 'request-fulfillment.v1'
    || !['scored', 'unavailable'].includes(String(value.status || ''))
    || String(value.runId || '') !== expectedRunId
    || typeof value.executionEvidenceComplete !== 'boolean'
    || typeof value.requestCount !== 'number' || !Number.isInteger(value.requestCount)
    || value.requestCount < 0
    || typeof value.questionCount !== 'number' || !Number.isInteger(value.questionCount)
    || value.questionCount < 0
    || (value.timingMs !== undefined && (
      typeof value.timingMs !== 'number' || !Number.isFinite(value.timingMs) || value.timingMs < 0
    ))) {
    throw new Error('request_fulfillment_receipt_invalid');
  }
  for (const field of ['idfSha256', 'outputSha256', 'executionEvidenceSha256', 'exposedToolsSha256']) {
    if (value[field] !== undefined && !isSha256(value[field])) {
      throw new Error('request_fulfillment_receipt_invalid');
    }
  }
  if (value.status === 'scored') {
    const requiredText = [
      'cardRevisionId', 'idfSha256', 'outputSha256', 'executionEvidenceSha256',
      'exposedToolsSha256', 'actualProvider', 'actualModel', 'requestedModel',
      'evaluatedAt', 'provider', 'resolvedModel', 'decisionId',
    ];
    const probabilities = value.probabilities;
    const keys = ['0', '1', '2', '3', '4'];
    const probabilityValues = isRecord(probabilities)
      ? keys.map((key) => probabilities[key])
      : [];
    if (requiredText.some((field) => typeof value[field] !== 'string' || !String(value[field]).trim())
      || value.executionEvidenceComplete !== true
      || value.executionEvidenceError !== null
      || value.failureReason !== undefined
      || value.requestCount !== 1
      || value.questionCount !== 1
      || !isRecord(probabilities)
      || Object.keys(probabilities).length !== keys.length
      || Object.keys(probabilities).some((key) => !keys.includes(key))
      || probabilityValues.some((item) => (
        typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1
      ))
      || !isRoundedDecisionDistribution(probabilityValues as number[])
      || typeof value.rawScore !== 'number' || !Number.isFinite(value.rawScore)
      || value.rawScore < 0 || value.rawScore > 4
      || typeof value.normalizedScore100 !== 'number'
      || !Number.isFinite(value.normalizedScore100)
      || Math.abs(value.normalizedScore100 - (value.rawScore * 25)) > 1e-6
      || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
      || value.confidence < 0 || value.confidence > 1
      || !isRecord(value.usage)
      || !isRecord(value.scale)
      || value.scale.minimum !== 0 || value.scale.maximum !== 4) {
      throw new Error('request_fulfillment_receipt_invalid');
    }
  } else if (typeof value.failureReason !== 'string' || !value.failureReason.trim()
    || ['rawScore', 'normalizedScore100', 'probabilities', 'confidence']
      .some((field) => value[field] !== undefined)) {
    throw new Error('request_fulfillment_receipt_invalid');
  }
  return value;
}

type AddressableAgent = {
  cardId: string;
  cardRevisionId: string;
  profile: string;
  title: string;
  address?: string;
  aliases: string[];
};

type SharedChatAuthority = {
  main: AddressableAgent;
  agents: AddressableAgent[];
};

// Direct user selection is Project/deck authority. It deliberately does not
// consult or mutate Main's saved orange agent-to-agent roster.
type ProjectSharedChatAuthority = {
  main: AddressableAgent;
  cards: AddressableAgent[];
  addressableAgents: AddressableAgent[];
  deck: DeckDocument;
};

type ThinkGraphRevisionStage = 'settled';

type ThinkGraphRevisionEvent = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: ThinkGraphRevisionStage;
  revision: string;
  changedNodeIds: string[];
  changedEdgeIds: string[];
  affectedNodeIds: string[];
};

const thinkGraphRevisionSubscribers = new Map<string, Map<Response, string>>();

type CompletedPairThinkGraphLifecycleArgs = {
  req: Request;
  projectId: string;
  deckId: string;
  conversationId: string;
  authority: SharedChatAuthority;
  originatingRunId: string;
  completedPair: Record<string, unknown>;
};

// A saved ThinkGraph Card/profile has one native terminal session. Keep completed
// pairs ordered inside that authority rather than staging overlapping Card turns.
// Main has already ended its response before this path is enqueued.
const completedPairThinkGraphLifecycleTails = new Map<string, Promise<void>>();
const requestFulfillmentAssessmentTails = new Set<Promise<void>>();

function thinkGraphRevisionScope(
  projectId: string,
  deckId: string,
): string {
  return `${projectId}\u0000${deckId}`;
}

function publishThinkGraphStreamEvent(
  projectId: string,
  deckId: string,
  conversationId: string,
  eventName: 'thinkgraph_revision' | 'thinkgraph_error',
  payload: Record<string, unknown>,
): void {
  const key = thinkGraphRevisionScope(projectId, deckId);
  const subscribers = thinkGraphRevisionSubscribers.get(key);
  if (!subscribers?.size) return;
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const [response, subscriberConversationId] of [...subscribers]) {
    if (eventName === 'thinkgraph_error'
      && subscriberConversationId !== conversationId) continue;
    if (response.destroyed || response.writableEnded) {
      subscribers.delete(response);
      continue;
    }
    try {
      response.write(frame);
    } catch {
      subscribers.delete(response);
    }
  }
  if (!subscribers.size) thinkGraphRevisionSubscribers.delete(key);
}

function publishThinkGraphRevision(event: ThinkGraphRevisionEvent): void {
  publishThinkGraphStreamEvent(
    event.projectId,
    event.deckId,
    event.conversationId,
    'thinkgraph_revision',
    event,
  );
}

const SHARED_CONTEXT_MESSAGE_LIMIT = 24;
const SHARED_CONTEXT_CHARACTER_LIMIT = 12_000;
const SHARED_CHAT_ADDRESS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function addressableAgent(projection: HermesBotRosterProjection): AddressableAgent {
  const address = projection.title;
  if (!SHARED_CHAT_ADDRESS_PATTERN.test(address)) {
    throw new Error('shared_chat_agent_address_invalid');
  }
  return {
    cardId: projection.cardId,
    cardRevisionId: projection.cardRevisionId,
    profile: projection.profile,
    title: projection.title,
    address,
    aliases: [address.toLowerCase()],
  };
}

function projectSharedChatCard(
  card: AgentCardInstance,
  deck: DeckDocument,
): AddressableAgent {
  const profile = requireAgentTerminalCard(card, deck);
  const cardRevisionId = String(card._cardRevisionId || '').trim();
  if (!cardRevisionId) throw new Error('shared_chat_card_revision_missing');
  const title = String(card.title || '').trim();
  if (!title) throw new Error('shared_chat_card_title_missing');
  const address = SHARED_CHAT_ADDRESS_PATTERN.test(title) ? title : undefined;
  return {
    cardId: card.id,
    cardRevisionId,
    profile,
    title,
    ...(address ? { address } : {}),
    aliases: address ? [address.toLowerCase()] : [],
  };
}

async function resolveProjectSharedChatAuthority(
  projectId: string,
  deckId: string,
): Promise<ProjectSharedChatAuthority> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const mainCards = deck?.nodes.filter((card) => (
    card.runtime.kind === 'hermes' && card.runtime.mode === 'main'
  )) || [];
  if (!deck || mainCards.length !== 1) throw new Error('persisted_main_chat_mismatch');
  const cards = deck.nodes.flatMap((card) => {
    try {
      return [projectSharedChatCard(card, deck)];
    } catch {
      return [];
    }
  });
  const main = cards.find((card) => card.cardId === mainCards[0].id);
  if (!main) throw new Error('shared_chat_main_authority_unavailable');
  if (!main.address) throw new Error('shared_chat_agent_address_invalid');
  return {
    main,
    cards,
    addressableAgents: cards.filter((card) => card.cardId !== main.cardId && card.address),
    deck,
  };
}

async function resolveSharedChatAuthority(
  projectId: string,
  deckId: string,
): Promise<SharedChatAuthority> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const mainCards = deck?.nodes.filter((card) => (
    card.runtime.kind === 'hermes' && card.runtime.mode === 'main'
  )) || [];
  if (!deck || mainCards.length !== 1) throw new Error('persisted_main_chat_mismatch');
  const projections = await resolveHermesBotRosterProjections(projectId, deckId);
  const mainProjection = projections.find((entry) => entry.cardId === mainCards[0].id);
  if (!mainProjection?.botEnabled) throw new Error('shared_chat_main_authority_unavailable');
  const byProfile = new Map(projections.map((entry) => [entry.profile, entry]));
  const agents = mainProjection.roster.map((profile) => byProfile.get(profile))
    .filter((entry): entry is HermesBotRosterProjection => entry?.botEnabled === true)
    .map(addressableAgent);
  return { main: addressableAgent(mainProjection), agents };
}

function leadingAddress(message: string): { attempted: boolean; address: string | null } {
  if (!/^\s*@/.test(message)) return { attempted: false, address: null };
  const match = /^\s*@([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/i.exec(message);
  return { attempted: true, address: match ? match[1].toLowerCase() : null };
}

function cardParticipant(agent: AddressableAgent): SharedChatParticipant {
  return {
    kind: 'card',
    label: agent.title,
    cardId: agent.cardId,
    profile: agent.profile,
    ...(agent.address ? { address: agent.address } : {}),
  };
}

const SHARED_CHAT_USER: SharedChatParticipant = { kind: 'user', label: 'You' };

function activityParticipant(
  message: ConversationMessage,
  kind: 'shared_chat_speaker' | 'shared_chat_target',
  main: AddressableAgent,
): SharedChatParticipant | undefined {
  const activity = message.visibleActivities?.find((entry) => entry.kind === kind);
  if (!activity) {
    if (kind === 'shared_chat_target') return undefined;
    return message.role === 'user' ? SHARED_CHAT_USER : cardParticipant(main);
  }
  return {
    kind: activity.status === 'user' ? 'user' : 'card',
    label: activity.label || (message.role === 'user' ? 'You' : main.title),
    ...(activity.cardId || activity.ref ? { cardId: activity.cardId || activity.ref } : {}),
    ...(activity.profile ? { profile: activity.profile } : {}),
    ...(activity.address ? { address: activity.address } : {}),
  };
}

function sharedHistoryMessage(message: ConversationMessage, main: AddressableAgent) {
  return {
    role: message.role === 'user' ? 'user' as const : 'assistant' as const,
    text: message.content,
    speaker: activityParticipant(message, 'shared_chat_speaker', main) || SHARED_CHAT_USER,
    ...(activityParticipant(message, 'shared_chat_target', main)
      ? { target: activityParticipant(message, 'shared_chat_target', main) }
      : {}),
  };
}

function boundedSharedContext(
  messages: ConversationMessage[],
  main: AddressableAgent,
  participant: AddressableAgent,
): Array<Record<string, string>> {
  const projected = messages
    .filter((message) => (
      (message.role === 'user' || message.role === 'assistant')
      && message.status === 'complete'
      && message.content.length > 0
    ))
    .map((message) => ({ view: sharedHistoryMessage(message, main) }));
  let lastParticipantReply = -1;
  for (let index = 0; index < projected.length; index += 1) {
    const entry = projected[index];
    if (entry.view.role === 'assistant' && entry.view.speaker.cardId === participant.cardId) {
      lastParticipantReply = index;
    }
  }
  // Every saved Hermes Card resumes one exact stored conversation session. Only
  // project-chat messages after that Card's last completed reply are unseen by
  // the native session and need to cross the canonical IDF boundary again.
  // This keeps direct-Card exchanges visible to Main without replaying Main's
  // already-retained transcript on every persistent turn.
  const contextStart = lastParticipantReply + 1;
  const candidates = projected.slice(contextStart).slice(-SHARED_CONTEXT_MESSAGE_LIMIT);
  const selected: typeof candidates = [];
  let characters = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (characters + candidate.view.text.length > SHARED_CONTEXT_CHARACTER_LIMIT) continue;
    selected.unshift(candidate);
    characters += candidate.view.text.length;
  }
  return selected.map(({ view }) => ({
    role: view.role,
    speakerCardId: view.speaker.cardId || '',
    speakerLabel: view.speaker.label,
    targetCardId: view.target?.cardId || '',
    targetLabel: view.target?.label || '',
    content: view.text,
  }));
}

export function materializerReadPrincipalForSavedCard(
  args: {
    projectId: string;
    deckId: string;
    cardId: string;
    conversationId?: string;
  },
  card: Pick<AgentCardInstance, 'runtimeOptions'> | null | undefined,
): InternalMcpPrincipal {
  const options = card?.runtimeOptions && typeof card.runtimeOptions === 'object'
    ? card.runtimeOptions
    : {};
  const unique = (values: unknown): string[] => Array.isArray(values)
    ? values.map(String).map((value) => value.trim())
      .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    : [];
  return {
    kind: 'materializer-read',
    projectId: args.projectId,
    deckId: args.deckId,
    callerCardId: args.cardId,
    ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    grantedTools: unique(options.tools),
    grantedConnections: unique(options.mcpConnectionIds),
  };
}

async function readSavedCardRunCatalog(args: {
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId?: string;
}) {
  const { deck } = await getDeckDocument(args.projectId, args.deckId);
  const card = deck?.nodes.find((node) => node.id === args.cardId);
  const catalog = await readPythonAgentMcpCatalog(
    materializerReadPrincipalForSavedCard(args, card),
  );
  return { catalog, deck, card };
}

async function settleCatalogPreparationFailure(args: {
  projectId: string;
  deckId: string;
  cardId: string;
  correlationId: string;
  conversationId: string;
  acceptedAt?: string;
}, error: unknown): Promise<void> {
  if (!args.acceptedAt) return;
  const errorSummary = error instanceof Error
    ? error.message
    : 'configured_card_preparation_failed';
  await requestPythonRailsJson('/domain/runs/preparation/fail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      cardId: args.cardId,
      runId: args.correlationId,
      correlationId: args.correlationId,
      conversationId: args.conversationId,
      acceptedAt: args.acceptedAt,
      errorCode: 'configured_card_preparation_failed',
      errorSummary,
    }),
  }).catch(() => undefined);
}

function assertPreparedSavedCardSnapshot(prepared: any, savedCard: any): void {
  const savedRevisionId = String(savedCard?._cardRevisionId || '').trim();
  const preparedRevisionId = String(prepared?.cardRevisionId || '').trim();
  if (!savedCard || !savedRevisionId || preparedRevisionId !== savedRevisionId) {
    throw new Error('card_revision_changed');
  }
  const savedRevisionSha256 = String(savedCard?._cardRevisionSha256 || '').trim();
  const preparedRevisionSha256 = String(prepared?.cardRevisionSha256 || '').trim();
  if (savedRevisionSha256 && preparedRevisionSha256 !== savedRevisionSha256) {
    throw new Error('card_revision_changed');
  }
}

async function assertPreparedSavedCardSnapshotOrSettle(
  prepared: any,
  savedCard: any,
): Promise<void> {
  try {
    assertPreparedSavedCardSnapshot(prepared, savedCard);
  } catch (error) {
    const runId = String(prepared?.runId || '').trim();
    if (runId && prepared?.rejoined !== true) {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          state: 'failed',
          errorCode: 'card_revision_changed',
          errorSummary: 'card_revision_changed',
        }),
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function prepareSavedCardRun(args: {
  projectId: string;
  deckId: string;
  cardId: string;
  cardRevisionId?: string;
  assignment: string;
  senderCardId?: string;
  originatingRunId?: string;
  conversationId: string;
  correlationId: string;
  acceptedAt?: string;
  dataAnchors?: unknown[];
  images?: unknown[];
  sharedConversation?: Array<Record<string, string>>;
  sharedConversationTargetLabel?: string;
}): Promise<any> {
  let saved: Awaited<ReturnType<typeof readSavedCardRunCatalog>>;
  try {
    saved = await readSavedCardRunCatalog(args);
  } catch (error) {
    await settleCatalogPreparationFailure(args, error);
    throw error;
  }
  const snapshotRevisionId = String(saved.card?._cardRevisionId || '').trim();
  if (!saved.card || !snapshotRevisionId) {
    const error = new Error('card_revision_changed');
    await settleCatalogPreparationFailure(args, error);
    throw error;
  }
  if (args.cardRevisionId && args.cardRevisionId !== snapshotRevisionId) {
    const error = new Error('card_revision_changed');
    await settleCatalogPreparationFailure(args, error);
    throw error;
  }
  const discoveredToolCatalog = saved.catalog;
  const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
  const prepared = await requestPythonRailsJson('/domain/runs/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      cardId: args.cardId,
      assignment: args.assignment,
      senderCardId: args.senderCardId || undefined,
      originatingRunId: args.originatingRunId || undefined,
      conversationId: args.conversationId,
      dataAnchors: Array.isArray(args.dataAnchors) ? args.dataAnchors : [],
      images: Array.isArray(args.images) ? args.images : [],
      ...(Array.isArray(args.sharedConversation) ? {
        sharedConversation: args.sharedConversation,
        sharedConversationTargetLabel: args.sharedConversationTargetLabel,
      } : {}),
      cardRevisionId: snapshotRevisionId,
      runId: args.correlationId,
      correlationId: args.correlationId,
      acceptedAt: args.acceptedAt,
      discoveredTools: discoveredToolCatalog.tools,
      discoveredToolCatalogState: discoveredToolCatalog.state,
      unavailableToolCatalogFamilies: discoveredToolCatalog.unavailableFamilies,
      configuredModels: listConfiguredModelOptions(openaiDefault),
    }),
  });
  await assertPreparedSavedCardSnapshotOrSettle(prepared, saved.card);
  return { prepared, savedDeck: saved.deck, savedCard: saved.card };
}

function internalMcpBridgeAuthorized(value: unknown): boolean {
  return internalMcpBridgeSecretAuthorized(value);
}

type InternalMainBridgeScope = {
  projectId: string;
  deckId: string;
  conversationId: string;
};

function internalMainBridgeScope(req: Request): InternalMainBridgeScope | null {
  const scope = (req as any).internalMainBridgeScope;
  if (!scope || typeof scope !== 'object') return null;
  return {
    projectId: String(scope.projectId || '').trim(),
    deckId: String(scope.deckId || '').trim(),
    conversationId: String(scope.conversationId || '').trim(),
  };
}

async function resolveCardRuntimeOwner(
  req: Request,
  projectId: string,
  deckId: string,
  cardId: string,
  conversationId: string,
): Promise<AgentTerminalOwner> {
  const project = await getProjectCard(projectId);
  const savedOwnerUserId = String(project?.ownerUserId || '').trim();
  if (!savedOwnerUserId) throw new Error('agent_terminal_project_owner_missing');

  const bridgeScope = internalMainBridgeScope(req);
  if (bridgeScope) {
    if (
      bridgeScope.projectId !== projectId
      || bridgeScope.deckId !== deckId
      || bridgeScope.conversationId !== conversationId
    ) throw new Error('agent_terminal_internal_scope_mismatch');
  } else {
    const authenticatedUserId = typeof (req as any).userId === 'string'
      ? String((req as any).userId).trim()
      : '';
    if (!authenticatedUserId) throw new Error('agent_terminal_owner_authentication_required');
    if (authenticatedUserId !== savedOwnerUserId) {
      throw new Error('agent_terminal_project_access_denied');
    }
  }

  const runtime = agentTerminalManager.findCard(projectId, deckId, cardId);
  if (runtime) {
    if (runtime.owner.userId !== savedOwnerUserId) {
      throw new Error('agent_terminal_runtime_owner_mismatch');
    }
    return { ...runtime.owner, conversationId };
  }
  return { userId: savedOwnerUserId, projectId, deckId, cardId, conversationId };
}

async function prepareMainCliRun(args: {
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId: string;
  message: string;
  driverSource: RemoteMainDriverSource;
  runId?: string;
  acceptedAt?: string;
  dataAnchors?: unknown[];
  images?: unknown[];
  sharedConversation?: Array<Record<string, string>>;
}): Promise<PreparedMainCliRun> {
  const runId = String(args.runId || `req_${randomUUID().slice(0, 8)}`);
  let saved: Awaited<ReturnType<typeof readSavedCardRunCatalog>>;
  try {
    saved = await readSavedCardRunCatalog(args);
  } catch (error) {
    await settleCatalogPreparationFailure({
      ...args,
      correlationId: runId,
    }, error);
    throw error;
  }
  const snapshotRevisionId = String(saved.card?._cardRevisionId || '').trim();
  if (!saved.card || !snapshotRevisionId) {
    const error = new Error('card_revision_changed');
    await settleCatalogPreparationFailure({
      ...args,
      correlationId: runId,
    }, error);
    throw error;
  }
  const discoveredToolCatalog = saved.catalog;
  const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
  const prepared: any = await requestPythonRailsJson('/domain/main/runs/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      message: args.message,
      conversationId: args.conversationId,
      driverSource: args.driverSource,
      runId,
      correlationId: runId,
      acceptedAt: args.acceptedAt,
      dataAnchors: Array.isArray(args.dataAnchors) ? args.dataAnchors : [],
      images: Array.isArray(args.images) ? args.images : [],
      sharedConversation: Array.isArray(args.sharedConversation) ? args.sharedConversation : [],
      cardRevisionId: snapshotRevisionId,
      discoveredTools: discoveredToolCatalog.tools,
      discoveredToolCatalogState: discoveredToolCatalog.state,
      unavailableToolCatalogFamilies: discoveredToolCatalog.unavailableFamilies,
      configuredModels: listConfiguredModelOptions(openaiDefault),
    }),
  });
  if (
    prepared.runtimeOwner !== 'hermes'
    || !prepared.hermesTransport?.cardIdentity
    || !prepared.hermesTransport?.request
  ) {
    throw new Error('main_hermes_card_not_runnable');
  }
  await assertPreparedSavedCardSnapshotOrSettle(prepared, saved.card);
  const boundPrepared = { ...prepared, runId };
  return {
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    runId,
    cardId: String(boundPrepared.hermesTransport.cardIdentity.cardId || ''),
    driverSource: args.driverSource,
    prepared: boundPrepared,
    savedDeck: saved.deck,
    savedCard: saved.card,
  };
}

// ── Main MCP bridge (SDK-free) ─────────────────────────────────────────────
// Internal JSON endpoints that run the proven MCP handlers server-side, where
// the backend already owns deck state + the Python transport. These import NO
// MCP SDK, so they are safe in the Nx serve graph. The separate MCP host
// process bridges MCP tool/resource calls to these endpoints without owning
// another domain store.
function authorizeInternalMainMcp(req: Request, res: Response, next: NextFunction) {
  if (!internalMcpBridgeAuthorized(req.headers['x-liquidaity-internal-mcp-secret'])) {
    return res.status(401).json({
      ok: false,
      error: 'internal_mcp_bridge_authorization_required',
    });
  }
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  if (projectId || deckId || conversationId) {
    (req as any).internalMainBridgeScope = { projectId, deckId, conversationId };
  }
  return next();
}

internalMainMcpRoutes.post('/context', authorizeInternalMainMcp, async (req, res) => {
  const issuer = String(req.body?.issuer || '').trim();
  const subject = String(req.body?.subject || '').trim();
  if (!issuer || !subject) {
    return res.status(400).json({ ok: false, error: 'verified_issuer_and_subject_required' });
  }
  try {
    const grant = await resolveExternalIdentityMainGrant(issuer, subject);
    if (!grant) return res.status(403).json({ ok: false, error: 'external_identity_grant_required' });

    const conversationId = `external-mcp:${grant.grantId}`;
    const parentRunId = `external-main:${grant.grantId}`;
    const mainIdentity = await resolveMainChatHermesIdentity(grant.projectId, BUILDER_DECK_ID);
    if (!mainIdentity) {
      return res.status(409).json({ ok: false, error: 'persisted_main_chat_unavailable' });
    }
    return res.json({
      ok: true,
      context: {
        projectId: grant.projectId,
        projectName: grant.projectName,
        deckId: BUILDER_DECK_ID,
        conversationId,
        parentRunId,
        mainCardId: mainIdentity.cardId,
      },
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'external_main_context_failed',
    });
  }
});


internalMainMcpRoutes.post('/chat', authorizeInternalMainMcp, async (req, res) => {
  const acceptedAt = new Date().toISOString();
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  const mainCardId = String(req.body?.mainCardId || '').trim();
  const message = String(req.body?.message || '');
  if (!projectId || !deckId || !conversationId || !mainCardId || !message) {
    return res.status(400).json({ ok: false, error: 'external_main_chat_context_required' });
  }
  try {
    const run = await prepareMainCliRun({
      projectId,
      deckId,
      cardId: mainCardId,
      conversationId,
      message,
      driverSource: 'external_plugin',
      acceptedAt,
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
    });
    if (run.cardId !== mainCardId) {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: run.runId,
          state: 'failed',
          errorSummary: 'external_main_card_identity_mismatch',
        }),
      }).catch(() => undefined);
      return res.status(409).json({ ok: false, error: 'external_main_card_identity_mismatch' });
    }
    const owner = await resolveCardRuntimeOwner(
      req, projectId, deckId, mainCardId, conversationId,
    );
    let runtime = agentTerminalManager.findCard(projectId, deckId, mainCardId);
    if (!runtime) {
      const state = await agentTerminalManager.open(
        owner,
        run.savedCard,
        run.savedDeck,
        120,
        36,
        agentTerminalPresentationOptions(run.savedCard, false),
      );
      runtime = { owner, state };
    }
    const result = await executePreparedGatewayCardRun({
      owner,
      conversationId,
      runId: run.runId,
      prepared: run.prepared,
      savedDeck: run.savedDeck,
      savedCard: run.savedCard,
    });
    let requestFulfillmentDeferred = false;
    try {
      const authority = await resolveSharedChatAuthority(projectId, deckId);
      requestFulfillmentDeferred = true;
      void enqueueRequestFulfillmentAssessment(run.runId, result.hermesCompletion);
      void enqueueCompletedPairThinkGraphLifecycle({
        req,
        projectId,
        deckId,
        conversationId,
        authority,
        originatingRunId: run.runId,
        completedPair: {
          projectId,
          deckId,
          conversationId,
          runId: run.runId,
          cardId: mainCardId,
          nativeSessionRef: result.hermesSessionId,
          completedAt: new Date().toISOString(),
          userMessage: message,
          mainResponse: result.text,
        },
      });
    } catch (error) {
      logHarnessTrace(
        `[thinkgraph] external Main intake unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return res.json({
      ok: true,
      runId: run.runId,
      cardId: run.cardId,
      driverSource: run.driverSource,
      contextAuthorityMode: contextAuthorityModeForDriver('external_plugin'),
      finalText: result.text,
      hermesSessionId: result.hermesSessionId,
      providerTurnId: result.hermesCompletion.providerTurnId,
      requestFulfillmentDeferred,
      configuration: {
        subagentModel: run.prepared.hermesTransport.request.runtimeOptions?.subagentModel || null,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'external_main_chat_failed';
    return res.status(reason === 'main_driver_turn_already_running' ? 409 : 502).json({
      ok: false,
      error: reason,
    });
  }
});

router.post('/connected', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const discoveredToolCatalog = await readPythonAgentMcpCatalog();
    const result = await describeConnectedAgents({
      projectId,
      deckId,
      discoveredToolNames: discoveredToolCatalog.tools.map((tool) => tool.name),
      discoveredToolCatalogState: discoveredToolCatalog.state,
      unavailableToolCatalogFamilies: discoveredToolCatalog.unavailableFamilies,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'describe_connected_agents_failed' });
  }
});

type ConfiguredCardRunStatus = {
  runId: string;
  conversationId: string | null;
  acceptedAt: string | null;
  preparationStartedAt: string | null;
  preparationEndedAt: string | null;
  preparationState: string | null;
  preparationError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  correlationId: string;
  cardId: string;
  runtimeKind: string;
  runtimeMode: string;
  runtimeProfile: string;
  state: string;
  status: string;
  nativeStatus: HermesKanbanTaskStatus | null;
  nativeTasks: HermesKanbanTaskProjection[];
  nativeRootId: string | null;
  nativeRunId: string | number | null;
  hermesSessionId: string | null;
  provider: string | null;
  model: string | null;
  accessMode: string | null;
  openaiRuntime: string | null;
  effectiveProvider: string | null;
  providerApiMode: string | null;
  tasksCompleted: number;
  tasksTotal: number;
  activeWorkers: number;
  preparationMs: number | null;
  totalElapsedMs: number | null;
  elapsedMs: number | null;
  toolCallCount: number | null;
  graphReads: number;
  graphWrites: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  modelFallbackOccurred: boolean;
  modelFallbackReason: string | null;
  requestFulfillment: Record<string, unknown> | null;
  idf: { sha256: string | null; bytes: number | null };
  jevDecisions: Record<string, unknown>[];
  attemptEvents: Record<string, unknown>[];
  toolEvents: Record<string, unknown>[];
  graphRecords: Record<string, unknown>[];
  materializedGraphRecords: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  observationGap: number;
  resultReady: boolean;
  output: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  terminal?: ReturnType<typeof buildCardTerminal>;
};

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : nonNegativeNumber(value);
}

type MagenticExecutionStatus = {
  ok: boolean;
  state: 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';
  nativeStatus: HermesKanbanTaskStatus;
  nativeRootId: string;
  nativeRunId?: number | string | null;
  nativeIdentity?: string | null;
  effectiveProvider?: string | null;
  providerApiMode?: string | null;
  model?: string | null;
  outerRunBound?: boolean;
  finalResult?: string;
  error?: string;
  nativeTasks?: unknown;
};

function requireMagenticTaskProjections(
  value: unknown,
  nativeRootId: string,
): HermesKanbanTaskProjection[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('magentic_execution_tasks_invalid');
  }
  const taskIds = new Set<string>();
  const tasks = value.map((candidate): HermesKanbanTaskProjection => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('magentic_execution_tasks_invalid');
    }
    const task = candidate as Record<string, unknown>;
    const taskId = typeof task.taskId === 'string' ? task.taskId : '';
    const title = typeof task.title === 'string' ? task.title : '';
    const assignee = task.assignee === null || typeof task.assignee === 'string'
      ? task.assignee as string | null
      : undefined;
    const status = typeof task.status === 'string' ? task.status : '';
    const dependencyIds = Array.isArray(task.dependencyIds)
      ? task.dependencyIds : null;
    if (
      !/^t_[A-Za-z0-9_-]+$/.test(taskId)
      || !title.trim()
      || assignee === undefined
      || !(HERMES_KANBAN_TASK_STATUSES as readonly string[]).includes(status)
      || !dependencyIds
      || dependencyIds.some((dependencyId) => (
        typeof dependencyId !== 'string'
        || !/^t_[A-Za-z0-9_-]+$/.test(dependencyId)
      ))
      || new Set(dependencyIds).size !== dependencyIds.length
      || typeof task.resultAvailable !== 'boolean'
      || taskIds.has(taskId)
    ) {
      throw new Error('magentic_execution_tasks_invalid');
    }
    taskIds.add(taskId);
    let latestAttempt: HermesKanbanTaskProjection['latestAttempt'] = null;
    if (task.latestAttempt !== null) {
      if (!task.latestAttempt || typeof task.latestAttempt !== 'object'
        || Array.isArray(task.latestAttempt)) {
        throw new Error('magentic_execution_tasks_invalid');
      }
      const attempt = task.latestAttempt as Record<string, unknown>;
      const runId = attempt.runId;
      const startedAt = attempt.startedAt;
      const endedAt = attempt.endedAt;
      if (
        (typeof runId !== 'string' && typeof runId !== 'number')
        || typeof attempt.status !== 'string'
        || !attempt.status.trim()
        || (startedAt !== null && typeof startedAt !== 'string' && typeof startedAt !== 'number')
        || (endedAt !== null && typeof endedAt !== 'string' && typeof endedAt !== 'number')
      ) {
        throw new Error('magentic_execution_tasks_invalid');
      }
      latestAttempt = {
        runId,
        status: attempt.status,
        startedAt: startedAt as string | number | null,
        endedAt: endedAt as string | number | null,
      };
    }
    const handoffSummary = task.handoffSummary === null
      ? null
      : typeof task.handoffSummary === 'string'
        && task.handoffSummary.trim().length > 0
        && task.handoffSummary.length <= 2_000
        ? task.handoffSummary
        : undefined;
    if (handoffSummary === undefined) throw new Error('magentic_execution_tasks_invalid');
    return {
      taskId,
      title,
      assignee,
      status: status as HermesKanbanTaskStatus,
      dependencyIds: dependencyIds as string[],
      latestAttempt,
      resultAvailable: task.resultAvailable,
      handoffSummary,
    };
  });
  if (!taskIds.has(nativeRootId)) throw new Error('magentic_execution_tasks_invalid');
  return tasks;
}

async function ensureMagenticAgents(
  req: Request,
  projectId: string,
  deckId: string,
  conversationId: string,
  prepared: any,
  savedDeck?: any,
): Promise<Array<{
  cardId: string;
  cardRevisionId: string;
  profile: string;
  configurationFingerprint: string;
}>> {
  const execution = prepared?.magenticExecution;
  const workers = Array.isArray(execution?.workers) ? execution.workers : [];
  if (!execution || workers.length === 0) throw new Error('magentic_execution_workers_missing');
  const loaded = savedDeck ? { deck: savedDeck } : await getDeckDocument(projectId, deckId);
  const deck = loaded.deck;
  if (!deck) throw new Error('magentic_execution_deck_missing');

  const orchestrator = execution.orchestrator;
  const orchestratorCardId = String(orchestrator?.cardId || '').trim();
  const orchestratorRevisionId = String(orchestrator?.cardRevisionId || '').trim();
  const orchestratorIdentity = String(orchestrator?.nativeIdentity || '').trim();
  const orchestratorCard = deck.nodes.find((candidate: any) => candidate.id === orchestratorCardId);
  if (!orchestratorCardId || !orchestratorRevisionId || !orchestratorIdentity
    || !orchestratorCard || orchestratorCard.runtime.kind !== 'hermes'
    || orchestratorCard.runtime.mode !== 'magentic_one') {
    throw new Error('magentic_execution_orchestrator_identity_invalid');
  }
  const currentOrchestratorIdentity = requireAgentTerminalCard(orchestratorCard, deck);
  if (currentOrchestratorIdentity !== orchestratorIdentity
    || String(orchestratorCard._cardRevisionId || '') !== orchestratorRevisionId) {
    throw new Error('magentic_execution_orchestrator_saved_identity_changed');
  }
  const directTeamRoot = workers.length === 1
    && String(workers[0]?.cardId || '') === 'card_team'
    && workers[0]?.teamTaskMode === true;
  if (!directTeamRoot) {
    const orchestratorOwner = await resolveCardRuntimeOwner(
      req, projectId, deckId, orchestratorCardId, conversationId,
    );
    await agentTerminalManager.open(
      orchestratorOwner,
      orchestratorCard,
      deck,
      120,
      36,
      {
        ...agentTerminalPresentationOptions(orchestratorCard, false),
        materializeTaskProfile: true,
      },
    );
  }

  const seen = new Set<string>();
  const authorities: Array<{
    cardId: string;
    cardRevisionId: string;
    profile: string;
    configurationFingerprint: string;
  }> = [];
  for (const worker of workers) {
    const cardId = String(worker?.cardId || '').trim();
    const revisionId = String(worker?.cardRevisionId || '').trim();
    const nativeIdentity = String(worker?.profile || '').trim();
    if (!cardId || !revisionId || !nativeIdentity || seen.has(nativeIdentity)) {
      throw new Error('magentic_execution_worker_identity_invalid');
    }
    if (worker?.teamTaskMode === true && cardId !== 'card_team') {
      throw new Error('magentic_execution_team_identity_invalid');
    }
    seen.add(nativeIdentity);
    const card = deck.nodes.find((candidate: any) => candidate.id === cardId);
    if (!card || card.runtime.kind !== 'hermes') {
      throw new Error(`magentic_execution_worker_card_invalid:${cardId}`);
    }
    const currentIdentity = requireAgentTerminalCard(card, deck);
    if (currentIdentity !== nativeIdentity || String(card._cardRevisionId || '') !== revisionId) {
      throw new Error(`magentic_execution_worker_saved_identity_changed:${cardId}`);
    }
    const owner = await resolveCardRuntimeOwner(req, projectId, deckId, cardId, conversationId);
    await agentTerminalManager.open(
      owner,
      card,
      deck,
      120,
      36,
      {
        ...agentTerminalPresentationOptions(card, false),
        materializeTaskProfile: true,
      },
    );
    const authority = agentTerminalManager.magenticCardToolAuthority(owner);
    if (
      authority.cardId !== cardId
      || authority.cardRevisionId !== revisionId
      || authority.profile !== nativeIdentity
      || !/^[a-f0-9]{64}$/.test(authority.configurationFingerprint)
    ) throw new Error(`magentic_execution_worker_authority_changed:${cardId}`);
    authorities.push(authority);
  }
  return authorities;
}

async function writeMagenticProgress(runId: string, status: MagenticExecutionStatus): Promise<void> {
  if (!(HERMES_KANBAN_TASK_STATUSES as readonly string[]).includes(status.nativeStatus)) return;
  const result = await requestPythonRailsJson('/domain/runs/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      nativeRootId: status.nativeRootId,
      nativeStatus: status.nativeStatus,
    }),
  }) as Record<string, unknown>;
  if (result?.ok !== true || result.runId !== runId || result.updated !== true) {
    throw new Error('magentic_outer_run_progress_not_bound');
  }
}

async function readMagenticExecution(nativeRootId: string): Promise<MagenticExecutionStatus> {
  const result = await requestPythonRailsJson('/magentic/execution/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nativeRootId }),
  }) as MagenticExecutionStatus;
  if (!result?.ok || result.nativeRootId !== nativeRootId) {
    throw new Error('magentic_execution_status_invalid');
  }
  return result;
}

async function executePreparedMagenticRun(args: {
  req: Request;
  projectId: string;
  deckId: string;
  conversationId: string;
  runId: string;
  senderCardId?: string;
  prepared: any;
  savedDeck?: any;
  savedCard?: any;
  onAccepted: (status: MagenticExecutionStatus) => void;
  onSubmitted: () => void;
}): Promise<MagenticExecutionStatus> {
  assertPreparedSavedCardSnapshot(args.prepared, args.savedCard);
  const workerAuthorities = await ensureMagenticAgents(
    args.req, args.projectId, args.deckId, args.conversationId, args.prepared, args.savedDeck,
  );
  const sender = args.senderCardId
    ? agentTerminalManager.findCard(args.projectId, args.deckId, args.senderCardId)
    : null;
  await requestPythonRailsJson('/domain/runs/magentic-mission-readiness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: args.runId,
      mission: args.prepared.magenticExecution?.mission,
      workers: args.prepared.magenticExecution?.workers,
    }),
  }).catch((error) => {
    logHarnessTrace(
      `[magentic] advisory mission readiness unavailable run=${args.runId} reason=${redactTrace(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
    return undefined;
  });
  const submitted = await requestPythonRailsJson('/magentic/execution/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...args.prepared.magenticExecution,
      workerAuthorities,
      ...(sender ? {
        notifySession: {
          sessionKey: sender.state.storedSessionId,
          profile: sender.state.profile,
        },
      } : {}),
    }),
  }) as MagenticExecutionStatus;
  const nativeRootId = String(submitted?.nativeRootId || '').trim();
  if (!submitted?.ok || !nativeRootId || submitted.outerRunBound !== true) {
    throw new Error('magentic_execution_submit_invalid');
  }
  const normalizedStatus: MagenticExecutionStatus = {
    ...submitted,
    nativeRootId,
    state: submitted.state || 'running',
    nativeStatus: submitted.nativeStatus,
  };
  if (!(HERMES_KANBAN_TASK_STATUSES as readonly string[]).includes(normalizedStatus.nativeStatus)) {
    throw new Error('magentic_execution_native_status_invalid');
  }
  // Python stages the native root until the first outer-Run binding succeeds.
  // This second exact write is a readback/continuity check; expose the root
  // first so the caller can stop it if that check fails.
  args.onAccepted(normalizedStatus);
  await writeMagenticProgress(args.runId, normalizedStatus);
  args.onSubmitted();
  return normalizedStatus;
}

async function finishMagenticOuterRun(
  runId: string,
  status: MagenticExecutionStatus,
): Promise<any> {
  const finalResult = String(status.finalResult || '').trim();
  const finalResultMissing = status.state === 'completed' && !finalResult;
  const state = status.state === 'completed' && !finalResultMissing
    ? 'completed'
    : status.state === 'cancelled'
      ? 'cancelled'
      : status.state === 'blocked'
        ? 'blocked'
        : 'failed';
  return requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      state,
      // Mag One is one native task root across every claimed Magnetic attempt.
      hermesSessionRef: null,
      providerThreadRef: status.nativeRootId,
      providerTurnRef: status.nativeRunId ?? null,
      effectiveProvider: status.effectiveProvider || null,
      providerApiMode: status.providerApiMode || null,
      nativeStatus: status.nativeStatus,
      finalResult: state === 'completed' ? finalResult : null,
      errorCode: state === 'completed'
        ? null
        : finalResultMissing ? 'magentic_final_result_missing' : `magentic_execution_${state}`,
      errorSummary: state === 'completed'
        ? null
        : finalResultMissing
          ? 'magentic_final_result_missing'
          : status.error || `magentic_execution_${state}`,
    }),
  });
}

async function settleUnboundMagenticSubmission(
  runId: string,
  accepted: MagenticExecutionStatus,
  reason: string,
): Promise<void> {
  try {
    const stopped = await requestPythonRailsJson('/magentic/execution/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nativeRootId: accepted.nativeRootId }),
    }) as MagenticExecutionStatus;
    if (!stopped?.ok || stopped.state !== 'cancelled'
      || stopped.nativeRootId !== accepted.nativeRootId) {
      throw new Error('magentic_execution_stop_invalid');
    }
    await finishMagenticOuterRun(runId, stopped);
    return;
  } catch (stopError) {
    const stopReason = stopError instanceof Error
      ? stopError.message
      : 'magentic_execution_stop_failed';
    await requestPythonRailsJson('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        state: 'blocked',
        hermesSessionRef: null,
        providerThreadRef: accepted.nativeRootId,
        providerTurnRef: accepted.nativeRunId ?? null,
        effectiveProvider: accepted.effectiveProvider || null,
        providerApiMode: accepted.providerApiMode || null,
        nativeStatus: accepted.nativeStatus,
        finalResult: null,
        errorCode: 'magentic_progress_bind_failed',
        errorSummary: `${reason}; ${stopReason}`,
      }),
    });
  }
}

async function readConfiguredCardRunStatus(args: {
  projectId: string;
  deckId: string;
  runId?: string;
  correlationId?: string;
  nativeRootId?: string;
  cardId?: string;
  conversationId?: string;
  includeTerminal?: boolean;
  inspectOnly?: boolean;
}): Promise<ConfiguredCardRunStatus | null> {
  const scopedInspection = args.cardId && args.conversationId
    ? await requestPythonRailsJson('/domain/agentgraph/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: args.projectId, deckId: args.deckId,
          cardId: args.cardId, conversationId: args.conversationId, directOnly: true, limit: 1 }),
      }) as any
    : null;
  const scopedRun = scopedInspection?.runs?.find((candidate: any) => (
    candidate.cardId === args.cardId && candidate.conversationId === args.conversationId
    && !candidate.nativeChildId
  ));
  if (args.cardId && args.conversationId && !scopedRun?.runId) return null;
  let response = await requestPythonRailsJson('/domain/runs/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scopedRun ? {
      projectId: args.projectId, deckId: args.deckId, runId: scopedRun.runId,
      includeTerminal: args.includeTerminal,
    } : args),
  }) as any;
  let run = (response as any)?.run;
  if (!run || typeof run !== 'object') return null;
  let liveMagenticStatus: MagenticExecutionStatus | null = null;
  if (
    !args.inspectOnly
    && run.runtimeKind === 'hermes'
    && run.runtimeMode === 'magentic_one'
    && ['pending', 'running'].includes(String(run.state || ''))
    && /^t_[A-Za-z0-9_-]+$/.test(String(run.nativeRootId || ''))
  ) {
    liveMagenticStatus = await readMagenticExecution(String(run.nativeRootId));
    if (['completed', 'blocked', 'failed', 'cancelled'].includes(liveMagenticStatus.state)) {
      await finishMagenticOuterRun(String(run.runId), liveMagenticStatus);
    } else {
      await writeMagenticProgress(String(run.runId), liveMagenticStatus);
    }
    response = await requestPythonRailsJson('/domain/runs/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: args.projectId,
        deckId: args.deckId,
        runId: String(run.runId),
        includeTerminal: args.includeTerminal,
      }),
    });
    run = (response as any)?.run;
    if (!run || typeof run !== 'object') return null;
  }
  const runId = String(run.runId || '').trim();
  const state = String(run.state || 'running');
  const nativeRootId = String(run.nativeRootId || '').trim();
  const inspection = scopedInspection || await requestPythonRailsJson('/domain/agentgraph/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      runId,
      limit: 50,
    }),
  }) as any;
  const telemetryRun = Array.isArray(inspection?.runs)
    ? inspection.runs.find((candidate: any) => String(candidate?.runId || '') === runId)
    : null;
  const graphReads = Number.isSafeInteger(telemetryRun?.graphReads)
    ? telemetryRun.graphReads
    : 0;
  const graphWrites = Number.isSafeInteger(telemetryRun?.graphWrites)
    ? telemetryRun.graphWrites
    : 0;
  const startedAt = Date.parse(String(run.startedAt || ''));
  const finishedAt = Date.parse(String(run.finishedAt || ''));
  const acceptedAtText = String(telemetryRun?.acceptedAt || run.createdAt || '').trim();
  const acceptedAt = Date.parse(acceptedAtText);
  const preparationFailure = String(telemetryRun?.preparationState || '') === 'failed'
    || ['configured_card_preparation_failed', 'input_files_materialization_failed']
      .includes(String(run.errorCode || ''));
  const observedPreparationMs = nullableNonNegativeNumber(
    telemetryRun?.preparationElapsedMs,
  );
  const elapsedMs = Number.isFinite(startedAt)
    ? Math.max(0, (Number.isFinite(finishedAt) ? finishedAt : Date.now()) - startedAt)
    : null;
  const preparationMs = observedPreparationMs ?? (
    Number.isFinite(acceptedAt)
      && Number.isFinite(preparationFailure ? finishedAt : startedAt)
      ? Math.max(0, (preparationFailure ? finishedAt : startedAt) - acceptedAt)
      : null
  );
  const totalElapsedMs = Number.isFinite(acceptedAt)
    ? Math.max(0, (Number.isFinite(finishedAt) ? finishedAt : Date.now()) - acceptedAt)
    : null;
  const persistedNativeStatus = String(run.nativeStatus || '').trim().toLowerCase();
  let nativeStatus = (HERMES_KANBAN_TASK_STATUSES as readonly string[])
    .includes(persistedNativeStatus)
    ? persistedNativeStatus as HermesKanbanTaskStatus
    : null;
  let nativeTasks: HermesKanbanTaskProjection[] = [];
  if (
    args.inspectOnly
    && run.runtimeKind === 'hermes'
    && run.cardId === 'card_magentic'
    && run.runtimeMode === 'magentic_one'
    && /^t_[A-Za-z0-9_-]+$/.test(nativeRootId)
  ) {
    const status = await readMagenticExecution(nativeRootId);
    if (!(HERMES_KANBAN_TASK_STATUSES as readonly string[]).includes(status.nativeStatus)) {
      throw new Error('magentic_execution_native_status_invalid');
    }
    nativeStatus = status.nativeStatus;
    nativeTasks = requireMagenticTaskProjections(status.nativeTasks, nativeRootId);
  } else if (liveMagenticStatus) {
    nativeStatus = liveMagenticStatus.nativeStatus;
  }
  const output = typeof run.result === 'string' && run.result.length > 0
    ? run.result
    : null;
  let terminal: ReturnType<typeof buildCardTerminal> | undefined;
  if (args.includeTerminal) {
    terminal = buildCardTerminal(run);
  }
  const attemptEvents = Array.isArray(telemetryRun?.attemptEvents)
    ? telemetryRun.attemptEvents.filter((value: unknown) => value && typeof value === 'object')
    : [];
  const reportedObservationGap = attemptEvents.reduce((maximum: number, event: any) => {
    const candidate = Number(event?.observationGap);
    return Number.isFinite(candidate) && candidate > maximum ? candidate : maximum;
  }, 0);
  const toolAttemptEvents = attemptEvents.filter((event: any) => event?.kind === 'tool');
  // Generic Hermes receipts are the complete metadata-only tool-attempt surface.
  const observedToolEvents = toolAttemptEvents;
  const nativeToolCallCount = nullableNonNegativeNumber(run.toolCallCount);
  const receiptObservationGap = nativeToolCallCount === null
    ? 0
    : Math.max(0, nativeToolCallCount - observedToolEvents.length);
  const observationGap = Math.max(reportedObservationGap, receiptObservationGap);
  const lastLlmAttempt = [...attemptEvents].reverse().find((event: any) => (
    event?.kind === 'llm' && String(event?.model || '').trim()
  )) as any;
  const actualProvider = String(
    lastLlmAttempt?.provider || run.effectiveProvider || run.provider || '',
  ).trim() || null;
  const actualModel = String(lastLlmAttempt?.model || run.model || '').trim() || null;
  return {
    runId,
    conversationId: String(telemetryRun?.conversationId || '').trim() || null,
    acceptedAt: acceptedAtText || null,
    preparationStartedAt: String(
      telemetryRun?.preparationStartedAt || (preparationFailure ? acceptedAtText : ''),
    ).trim() || null,
    preparationEndedAt: String(
      telemetryRun?.preparationEndedAt || (preparationFailure ? run.finishedAt : ''),
    ).trim() || null,
    preparationState: String(
      telemetryRun?.preparationState || (preparationFailure ? 'failed' : ''),
    ).trim() || null,
    preparationError: String(
      telemetryRun?.preparationError || (preparationFailure ? run.errorSummary : ''),
    ).trim() || null,
    startedAt: String(run.startedAt || '').trim() || null,
    finishedAt: String(run.finishedAt || '').trim() || null,
    correlationId: String(run.correlationId || ''),
    cardId: String(run.cardId || ''),
    runtimeKind: String(run.runtimeKind || ''),
    runtimeMode: String(run.runtimeMode || ''),
    runtimeProfile: String(run.runtimeProfile || ''),
    state,
    status: nativeStatus || state,
    nativeStatus,
    nativeTasks,
    nativeRootId: nativeRootId || null,
    nativeRunId: typeof run.nativeRunId === 'number' || typeof run.nativeRunId === 'string'
      ? run.nativeRunId
      : null,
    hermesSessionId: String(run.hermesSessionId || '').trim() || null,
    provider: preparationFailure ? null : actualProvider,
    model: preparationFailure ? null : actualModel,
    accessMode: preparationFailure ? null : String(run.accessMode || '').trim() || null,
    openaiRuntime: preparationFailure ? null : String(run.openaiRuntime || '').trim() || null,
    effectiveProvider: preparationFailure ? null : String(run.effectiveProvider || '').trim() || null,
    providerApiMode: preparationFailure ? null : String(run.providerApiMode || '').trim() || null,
    tasksCompleted: nonNegativeNumber(run.tasksCompleted),
    tasksTotal: nonNegativeNumber(run.tasksTotal),
    activeWorkers: nonNegativeNumber(run.activeWorkers),
    preparationMs,
    totalElapsedMs,
    elapsedMs,
    toolCallCount: nativeToolCallCount,
    graphReads,
    graphWrites,
    inputTokens: nullableNonNegativeNumber(run.inputTokens),
    outputTokens: nullableNonNegativeNumber(run.outputTokens),
    cachedTokens: nullableNonNegativeNumber(run.cachedTokens),
    reasoningTokens: nullableNonNegativeNumber(run.reasoningTokens),
    costUsd: nullableNonNegativeNumber(run.costUsd),
    modelFallbackOccurred: run.modelFallbackOccurred === true,
    modelFallbackReason: String(run.modelFallbackReason || '').trim() || null,
    requestFulfillment: run.requestFulfillment && typeof run.requestFulfillment === 'object'
      ? run.requestFulfillment as Record<string, unknown>
      : null,
    idf: telemetryRun?.idf && typeof telemetryRun.idf === 'object'
      ? {
          sha256: String(telemetryRun.idf.sha256 || '').trim() || null,
          bytes: nullableNonNegativeNumber(telemetryRun.idf.bytes),
        }
      : { sha256: null, bytes: null },
    jevDecisions: Array.isArray(telemetryRun?.jevDecisions)
      ? telemetryRun.jevDecisions.filter((value: unknown) => value && typeof value === 'object')
      : [],
    attemptEvents,
    toolEvents: observedToolEvents,
    graphRecords: Array.isArray(telemetryRun?.graphRecords)
      ? telemetryRun.graphRecords : [],
    materializedGraphRecords: Array.isArray(telemetryRun?.materializedGraphRecords)
      ? telemetryRun.materializedGraphRecords : [],
    artifacts: Array.isArray(telemetryRun?.artifacts) ? telemetryRun.artifacts : [],
    observationGap,
    resultReady: output !== null,
    output,
    errorCode: String(run.errorCode || '').trim() || null,
    errorSummary: String(run.errorSummary || '').trim() || null,
    ...(terminal ? { terminal } : {}),
  };
}

async function readConfiguredCardRunHistory(args: {
  projectId: string;
  deckId: string;
  cardId: string;
  limit: number;
}): Promise<{
  cardId: string;
  latest: {
    state: string;
    acceptedAt: string | null;
    model: string | null;
    elapsedMs: number | null;
    totalTokens: number | null;
    costUsd: number | null;
    costStatus: 'estimated' | 'unavailable';
    toolCallCount: number | null;
  } | null;
}> {
  const history = await requestPythonRailsJson('/domain/runs/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }) as any;
  const runs = Array.isArray(history?.runs) ? history.runs : [];
  const latestRunId = String(runs[0]?.runId || '').trim();
  const latestRun = latestRunId
    ? await readConfiguredCardRunStatus({
        projectId: args.projectId,
        deckId: args.deckId,
        runId: latestRunId,
        includeTerminal: false,
        inspectOnly: true,
      })
    : null;
  const inputTokens = latestRun?.inputTokens;
  const outputTokens = latestRun?.outputTokens;
  const totalTokens = inputTokens !== null && inputTokens !== undefined
    && outputTokens !== null && outputTokens !== undefined
    ? inputTokens + outputTokens
    : null;
  const costUsd = latestRun?.costUsd ?? null;
  return {
    cardId: args.cardId,
    latest: latestRun ? {
      state: latestRun.state,
      acceptedAt: latestRun.acceptedAt,
      model: latestRun.model,
      elapsedMs: latestRun.totalElapsedMs,
      totalTokens,
      costUsd,
      costStatus: costUsd === null ? 'unavailable' : 'estimated',
      toolCallCount: latestRun.toolCallCount,
    } : null,
  };
}

type GatewayCardExecution = {
  owner: AgentTerminalOwner;
  terminalSessionId: string;
  hermesSessionId: string;
  storedSessionId: string;
  profile: string;
  completedTurnGeneration: number | null;
  completedHermesRunId: string | null;
  hermesCompletion: Awaited<ReturnType<typeof cardTurnBridge.completeStaged>>;
  text: string;
};

type PassiveContextCompaction = {
  owner: AgentTerminalOwner;
  identity: AgentTerminalCompactionIdentity;
  projectId: string;
  deckId: string;
  cardId: string;
  runId: string;
  hermesTurnId?: string;
};

function queuePassiveContextCompaction(args: PassiveContextCompaction): void {
  const persistReceipt = (receipt: {
    status: 'compressed' | 'aborted' | 'unavailable' | 'failed';
    errorCode: string | null;
  }) => {
    const phase = receipt.status === 'compressed'
      ? 'completed'
      : receipt.status === 'aborted' ? 'cancelled' : 'failed';
    void requestPythonRailsJson('/domain/runs/attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: args.projectId,
        deckId: args.deckId,
        cardId: args.cardId,
        runId: args.runId,
        attempt: {
          eventId: `session.compress:${args.runId}`,
          attemptId: `session.compress:${args.runId}`,
          kind: 'tool',
          phase,
          observedAt: new Date().toISOString(),
          toolName: 'session.compress',
          toolCallId: `session.compress:${args.runId}`,
          turnId: args.hermesTurnId || undefined,
          status: receipt.status,
          errorType: receipt.errorCode || undefined,
          errorMessage: receipt.errorCode || undefined,
          retryable: false,
          redaction: 'metadata_only_no_summary',
        },
      }),
    }).catch((error) => {
      logHarnessTrace(
        `[context-compaction] receipt persistence failed reason=${redactTrace(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    });
  };
  try {
    void agentTerminalManager.queueHermesContextCompaction(
      args.owner,
      args.identity,
      persistReceipt,
    ).catch((error) => {
      logHarnessTrace(
        `[context-compaction] queue failed open reason=${redactTrace(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    });
  } catch (error) {
    logHarnessTrace(
      `[context-compaction] queue failed open reason=${redactTrace(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  }
}

async function assessGatewayRunCompletion(
  runId: string,
  completion: GatewayCardExecution['hermesCompletion'],
): Promise<Record<string, unknown>> {
  try {
    const result: any = await requestPythonRailsJson('/domain/runs/request-fulfillment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        actualProvider: completion.effectiveProvider,
        actualModel: completion.actualModel,
        exposedTools: completion.exposedTools,
        executionEvidence: completion.executionEvidence,
        executionEvidenceComplete: completion.executionEvidenceComplete,
        executionEvidenceError: completion.executionEvidenceError,
      }),
    });
    return preparedRequestFulfillmentAssessment(result?.assessment, runId);
  } catch (error) {
    const executionEvidenceComplete = completion.executionEvidenceComplete === true;
    const executionEvidenceError = String(completion.executionEvidenceError || '').trim() || null;
    return {
      schemaVersion: 'request-fulfillment-assessment.v1',
      metric: 'request_fulfillment',
      rubricVersion: 'request-fulfillment.v1',
      status: 'unavailable',
      runId,
      executionEvidenceComplete,
      executionEvidenceError,
      actualProvider: String(completion.effectiveProvider || '').trim() || null,
      actualModel: String(completion.actualModel || '').trim() || null,
      failureReason: error instanceof Error
        ? error.message
        : 'request_fulfillment_unavailable',
      requestCount: 0,
      questionCount: 0,
    };
  }
}

function enqueueRequestFulfillmentAssessment(
  runId: string,
  completion: GatewayCardExecution['hermesCompletion'],
): Promise<void> {
  const assessment = assessGatewayRunCompletion(runId, completion)
    .then(() => undefined)
    .catch((error) => {
      logHarnessTrace(
        `[request-fulfillment] background settlement failed run=${runId} reason=${redactTrace(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    });
  requestFulfillmentAssessmentTails.add(assessment);
  void assessment.finally(() => requestFulfillmentAssessmentTails.delete(assessment));
  return assessment;
}

// Tests and controlled shutdown callers may drain post-response Score work.
// Answer-returning JSON routes deliberately never await this set.
export async function waitForRequestFulfillmentAssessments(): Promise<void> {
  while (requestFulfillmentAssessmentTails.size) {
    await Promise.all([...requestFulfillmentAssessmentTails]);
  }
}

async function executePreparedGatewayCardRun(args: {
  owner: AgentTerminalOwner;
  conversationId: string;
  runId: string;
  prepared: any;
  savedDeck?: any;
  savedCard?: any;
  onEvent?: (event: AgentTerminalGatewayEvent) => void;
  onBound?: (terminal: { sessionId: string; hermesSessionId: string; profile: string }) => void;
  onSubmitted?: () => void;
  attachTui?: boolean;
  surface?: 'card-shared-chat';
}): Promise<GatewayCardExecution> {
  let terminalSessionId = '';
  let staged = false;
  let hermesTurnQueued = false;
  let compactionQueued = false;
  let compactionIdentity: AgentTerminalCompactionIdentity | null = null;
  const passiveCompactionEnabled = (
    args.prepared?.runtimeOwner === 'hermes'
    && args.prepared?.hermesTransport?.request?.runtime?.mode === 'delegate'
  );
  const refreshCompactionIdentity = () => {
    if (!terminalSessionId) return;
    try {
      const state = agentTerminalManager.state(args.owner, terminalSessionId);
      compactionIdentity = {
        sessionId: state.sessionId,
        hermesSessionId: state.hermesSessionId,
        storedSessionId: state.storedSessionId,
        profile: state.profile,
        completedTurnGeneration: state.completedTurnGeneration,
        completedHermesRunId: state.completedHermesRunId,
      };
    } catch {
      // The queued manager call returns an honest unavailable receipt if the
      // exact session disappeared after settlement.
    }
  };
  const queueDelegateCompaction = (hermesTurnId?: string) => {
    if (!passiveCompactionEnabled || !hermesTurnQueued || compactionQueued || !compactionIdentity) {
      return;
    }
    compactionQueued = true;
    queuePassiveContextCompaction({
      owner: args.owner,
      identity: compactionIdentity,
      projectId: args.owner.projectId,
      deckId: args.owner.deckId,
      cardId: args.owner.cardId,
      runId: args.runId,
      hermesTurnId,
    });
  };
  try {
    const loaded = args.savedDeck
      ? { deck: args.savedDeck }
      : await getDeckDocument(args.owner.projectId, args.owner.deckId);
    const deck = loaded.deck;
    const card = args.savedCard
      || deck?.nodes.find((candidate: any) => candidate.id === args.owner.cardId);
    if (!deck || !card) throw new Error('agent_terminal_card_not_found');
    assertPreparedSavedCardSnapshot(args.prepared, card);
    const profile = requireAgentTerminalCard(card, deck);
    const existing = agentTerminalManager.find(args.owner);
    const terminal = args.attachTui
      ? await agentTerminalManager.open(
        args.owner,
        card,
        deck,
        120,
        36,
        agentTerminalPresentationOptions(card, true),
      )
      : existing || await agentTerminalManager.open(
        args.owner,
        card,
        deck,
        120,
        36,
        agentTerminalPresentationOptions(card, false),
      );
    agentTerminalManager.verifyConfiguration(args.owner, terminal.sessionId, card, deck);
    terminalSessionId = terminal.sessionId;
    compactionIdentity = {
      sessionId: terminal.sessionId,
      hermesSessionId: terminal.hermesSessionId,
      storedSessionId: terminal.storedSessionId,
      profile: terminal.profile,
      completedTurnGeneration: terminal.completedTurnGeneration,
      completedHermesRunId: terminal.completedHermesRunId,
    };
    args.onBound?.(terminal);

    let stagedPrepared = args.prepared;
    const transientTask = String(args.prepared.hermesTransport?.request?.task || '').trim();
    if (transientTask === '/learn' || transientTask.startsWith('/learn ')) {
      const learnedPrompt = await agentTerminalManager.dispatchLearn(
        profile,
        transientTask.slice('/learn'.length).trim(),
      );
      stagedPrepared = {
        ...args.prepared,
        hermesTransport: {
          ...args.prepared.hermesTransport,
          request: {
            ...args.prepared.hermesTransport.request,
            message: [
              String(args.prepared.hermesTransport.request.graphContext || '').trim(),
              learnedPrompt,
            ].filter(Boolean).join('\n\n'),
          },
        },
      };
    }
    const preparedTurn = cardTurnBridge.stage(
      args.owner,
      terminal.sessionId,
      profile,
      stagedPrepared,
      args.conversationId,
    );
    staged = true;
    hermesTurnQueued = true;
    const pending = agentTerminalManager.submit(
      args.owner,
      terminal.sessionId,
      preparedTurn.message,
      {
        onEvent: args.onEvent,
        routing: preparedTurn.routing,
        images: preparedTurn.images,
        ...(args.surface ? { surface: args.surface } : {}),
      },
    );
    args.onSubmitted?.();
    const result = await pending;
    if (
      Number.isSafeInteger(result.completedTurnGeneration)
      && Number(result.completedTurnGeneration) >= 0
    ) {
      compactionIdentity = {
        ...compactionIdentity,
        completedTurnGeneration: Number(result.completedTurnGeneration),
        completedHermesRunId: result.completedHermesRunId ?? null,
      };
    }
    const hermesCompletion = await cardTurnBridge.completeStaged(
      terminal.sessionId,
      terminal.hermesSessionId,
      result,
    );
    staged = false;
    refreshCompactionIdentity();
    queueDelegateCompaction(String(hermesCompletion.providerTurnId || '').trim() || undefined);
    return {
      owner: args.owner,
      terminalSessionId: terminal.sessionId,
      hermesSessionId: terminal.hermesSessionId,
      storedSessionId: compactionIdentity?.storedSessionId || terminal.storedSessionId,
      profile: terminal.profile,
      completedTurnGeneration: Number.isSafeInteger(result.completedTurnGeneration)
        ? Number(result.completedTurnGeneration)
        : null,
      completedHermesRunId: typeof result.completedHermesRunId === 'string'
        ? result.completedHermesRunId
        : null,
      hermesCompletion,
      text: result.text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'agent_terminal_turn_failed';
    if (staged && terminalSessionId) {
      const cancelledBeforeBegin = await cardTurnBridge
        .cancelStaged(
          terminalSessionId,
          message,
          message === 'hermes_turn_cancelled' ? 'cancelled' : 'failed',
        )
        .catch(() => false);
      if (!cancelledBeforeBegin) {
        await cardTurnBridge.abort(terminalSessionId, message).catch(() => undefined);
      }
    } else {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: args.runId,
          state: message === 'hermes_turn_cancelled' ? 'cancelled' : 'failed',
          errorSummary: message,
        }),
      }).catch(() => undefined);
    }
    refreshCompactionIdentity();
    queueDelegateCompaction();
    throw error;
  }
}

function thinkGraphCardAssignment(preparation: any): string {
  return [
    'Run one official Engraphis llm_structured extraction pass using the prompt and schema below.',
    'Use your saved ThinkGraph Card instructions and configured model. Do not call tools.',
    'Return only one JSON object that validates against OUTPUT_SCHEMA. Do not wrap it in prose.',
    'Each facts[] item is one native Engraphis fact and one displayed Think.',
    'Preserve each fact\'s content, title, memory type, importance, keywords, entities, and relations.',
    'Extract the fewest independently reusable facts supported by the completed exchange.',
    'Preserve necessary context and uncertainty without repeating conversational setup or turning',
    'every reasoning clause into a relationship.',
    '',
    'OUTPUT_SCHEMA',
    JSON.stringify(preparation.enrichmentSchema),
    '',
    'ENGRAPHIS_LLM_STRUCTURED_PROMPT',
    String(preparation.enrichmentPrompt || ''),
  ].join('\n');
}

const COMPLETED_PAIR_EXTRACTOR_FIELDS = [
  'projectId', 'deckId', 'conversationId', 'runId', 'cardId',
  'nativeSessionRef', 'completedAt', 'userMessage', 'mainResponse',
] as const;

function completedPairExtractorPayload(
  completedPair: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(COMPLETED_PAIR_EXTRACTOR_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(completedPair, field))
    .map((field) => [field, completedPair[field]]));
}


async function runCompletedPairThinkGraphLifecycle(
  args: CompletedPairThinkGraphLifecycleArgs,
): Promise<void> {
  let stage: 'prepare' | 'thinkgraph_card' | 'settle' = 'prepare';
  try {
    const extractorPair = completedPairExtractorPayload(args.completedPair);
    const preparation: any = await requestPythonRailsJson('/thinkgraph/completed-pair/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(extractorPair),
    });
    const intakeOperation = String(preparation?.intakeOperation || '');
    if (
      preparation?.revisionChanged !== false
      || preparation?.preparation?.status === undefined
    ) {
      throw new Error('thinkgraph_prepare_mutated_graph');
    }
    if (
      preparation?.structuredExtractionRequired === false
      && intakeOperation === 'noop'
    ) return;
    if (
      preparation?.structuredExtractionRequired !== true
      || intakeOperation !== 'pending'
    ) {
      throw new Error('thinkgraph_prepare_intake_contract_invalid');
    }

    stage = 'thinkgraph_card';
    const matches = args.authority.agents.filter((agent) => agent.title === 'ThinkGraph');
    if (matches.length !== 1) throw new Error(
      matches.length > 1
        ? 'thinkgraph_saved_card_ambiguous'
        : 'thinkgraph_saved_card_unavailable',
    );
    const thinkGraphCard = matches[0];
    const cardRunId = `req_${randomUUID().slice(0, 8)}`;
    const savedPreparation = await prepareSavedCardRun({
      projectId: args.projectId,
      deckId: args.deckId,
      cardId: thinkGraphCard.cardId,
      cardRevisionId: thinkGraphCard.cardRevisionId,
      assignment: thinkGraphCardAssignment(preparation),
      senderCardId: args.authority.main.cardId,
      originatingRunId: args.originatingRunId,
      conversationId: args.conversationId,
      correlationId: cardRunId,
    });
    const prepared = savedPreparation.prepared;
    const exactIdentity = prepared.runtimeOwner === 'hermes'
      && String(prepared.runId || '') === cardRunId
      && String(prepared.cardRevisionId || '') === thinkGraphCard.cardRevisionId
      && String(prepared.hermesTransport?.cardIdentity?.cardId || '') === thinkGraphCard.cardId
      && String(prepared.hermesTransport?.request?.runtime?.profile || '') === thinkGraphCard.profile
      && Boolean(prepared.hermesTransport?.request);
    if (!exactIdentity) throw new Error('thinkgraph_saved_card_runtime_identity_mismatch');
    const owner = await resolveCardRuntimeOwner(
      args.req,
      args.projectId,
      args.deckId,
      thinkGraphCard.cardId,
      args.conversationId,
    );
    const cardResult = await executePreparedGatewayCardRun({
      owner,
      conversationId: args.conversationId,
      runId: cardRunId,
      prepared,
      savedDeck: savedPreparation.savedDeck,
      savedCard: savedPreparation.savedCard,
      attachTui: false,
    });

    stage = 'settle';
    const settled: any = await requestPythonRailsJson('/thinkgraph/completed-pair/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...extractorPair,
        pairReference: String(preparation.pairReference || ''),
        structuredOutput: cardResult.text,
        cardRun: {
          runId: cardRunId,
          cardId: thinkGraphCard.cardId,
          revisionId: thinkGraphCard.cardRevisionId,
          profile: cardResult.profile,
          nativeSessionRef: cardResult.hermesSessionId,
          resolvedModel: String(
            prepared.hermesTransport?.request?.provider?.providerModelId || '',
          ),
        },
      }),
    });
    const settleFailures = Array.isArray(settled?.failures) ? settled.failures : [];
    if (settleFailures.length) {
      logHarnessTrace(
        `[thinkgraph] settled pair failures count=${settleFailures.length}`,
      );
      publishThinkGraphStreamEvent(
        args.projectId,
        args.deckId,
        args.conversationId,
        'thinkgraph_error',
        {
          projectId: args.projectId,
          deckId: args.deckId,
          conversationId: args.conversationId,
          originatingRunId: args.originatingRunId,
          stage: 'settle',
          error: 'thinkgraph_settle_pair_failures',
          failureCount: settleFailures.length,
        },
      );
    }
    if (settled?.revisionChanged === true) {
      publishThinkGraphRevision({
        projectId: args.projectId,
        deckId: args.deckId,
        conversationId: args.conversationId,
        originatingRunId: args.originatingRunId,
        stage: 'settled',
        revision: String(settled.revision ?? ''),
        changedNodeIds: Array.isArray(settled.changedNodeIds)
          ? settled.changedNodeIds.map(String) : [],
        changedEdgeIds: Array.isArray(settled.changedEdgeIds)
          ? settled.changedEdgeIds.map(String) : [],
        affectedNodeIds: Array.isArray(settled.affectedNodeIds)
          ? settled.affectedNodeIds.map(String) : [],
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'thinkgraph_lifecycle_failed';
    logHarnessTrace(
      `[thinkgraph] lifecycle failed stage=${stage} reason=${redactTrace(reason)}`,
    );
    publishThinkGraphStreamEvent(
      args.projectId,
      args.deckId,
      args.conversationId,
      'thinkgraph_error',
      {
        projectId: args.projectId,
        deckId: args.deckId,
        conversationId: args.conversationId,
        originatingRunId: args.originatingRunId,
        stage,
        error: reason,
      },
    );
  }
}

function enqueueCompletedPairThinkGraphLifecycle(
  args: CompletedPairThinkGraphLifecycleArgs,
): Promise<void> {
  const scope = `${args.projectId}\u0000${args.deckId}`;
  const prior = completedPairThinkGraphLifecycleTails.get(scope) || Promise.resolve();
  const current = prior
    .catch(() => undefined)
    .then(() => runCompletedPairThinkGraphLifecycle(args));
  completedPairThinkGraphLifecycleTails.set(scope, current);
  void current.then(() => {
    if (completedPairThinkGraphLifecycleTails.get(scope) === current) {
      completedPairThinkGraphLifecycleTails.delete(scope);
    }
  });
  return current;
}


// Tests and controlled shutdown callers may drain already-authorized background
// work. The chat route never waits here before ending Main's SSE response.
export async function waitForCompletedPairThinkGraphLifecycles(): Promise<void> {
  while (completedPairThinkGraphLifecycleTails.size) {
    await Promise.all([...completedPairThinkGraphLifecycleTails.values()]);
  }
}

// Thin configured-Card transport. Python owns saved Card authorization, the one
// canonical IDF materializer, runtime-owner selection, and separate Run
// persistence. This route never rebuilds the model call.
router.post('/run', async (req, res) => {
  const body = req.body || {};
  const retiredFields = ['builderOperation', 'agentBuilderOperation', 'buildTarget',
    'selectedCardTarget', 'effectTarget', 'effectTargetCardId',
    'effectTargetCardRevisionId', 'effectTargetDeckRevision']
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (retiredFields.length) {
    return res.status(400).json({ ok: false,
      error: `card_run_fields_retired:${retiredFields.join(',')}` });
  }
  const action = body.action;
  if (
    action !== 'execute'
    && action !== 'status'
    && action !== 'history'
    && action !== 'inputs'
    && action !== 'stop'
  ) {
    return res.status(400).json({ ok: false, error: 'configured_card_action_invalid' });
  }
  const projectId = String(body.projectId || '').trim();
  const deckId = String(body.deckId || BUILDER_DECK_ID).trim();
  const cardId = String(body.cardId || '').trim();
  const correlationId = String(body.correlationId || '').trim();
  const conversationId = String(body.conversationId || '').trim() || 'main';
  const originatingRunId = String(body.originatingRunId || body.parentRunId || '').trim();
  const senderCardId = String(body.senderCardId || '').trim();
  const input = String(body.input || '').trim();
  if (!projectId || !deckId) {
    return res.status(400).json({ ok: false, error: 'card_run_args_incomplete' });
  }

  if (action === 'history') {
    const rawLimit = body.limit ?? 8;
    if (!cardId || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 20) {
      return res.status(400).json({ ok: false, error: 'card_run_history_args_invalid' });
    }
    try {
      const history = await readConfiguredCardRunHistory({
        projectId,
        deckId,
        cardId,
        limit: rawLimit,
      });
      return res.json({ ok: true, result: history });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_history_failed',
      });
    }
  }

  if (action === 'status') {
    const runId = String(body.runId || '').trim();
    const nativeRootId = String(body.nativeRootId || '').trim();
    const selectors = [runId, correlationId, nativeRootId, cardId].filter(Boolean);
    if (selectors.length !== 1) {
      return res.status(400).json({ ok: false, error: 'card_run_status_selector_invalid' });
    }
    try {
      const status = await readConfiguredCardRunStatus({
        projectId,
        deckId,
        ...(runId ? { runId } : {}),
        ...(correlationId ? { correlationId } : {}),
        ...(nativeRootId ? { nativeRootId } : {}),
        ...(cardId ? { cardId } : {}),
        ...(cardId && String(body.conversationId || '').trim()
          ? { conversationId: String(body.conversationId).trim() } : {}),
        includeTerminal: body.includeTerminal === true,
        inspectOnly: body.inspectOnly === true,
      });
      return res.json({ ok: true, result: status });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_status_failed',
      });
    }
  }

  if (action === 'inputs') {
    const runId = String(body.runId || '').trim();
    if (!runId) {
      return res.status(400).json({ ok: false, error: 'card_run_input_files_run_required' });
    }
    try {
      const result = await requestPythonRailsJson('/domain/runs/input-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, runId }),
      });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_input_files_failed',
      });
    }
  }

  if (action === 'stop') {
    const runId = String(body.runId || '').trim();
    if (!runId || !cardId) {
      return res.status(400).json({ ok: false, error: 'card_run_stop_args_incomplete' });
    }
    try {
      const status = await readConfiguredCardRunStatus({ projectId, deckId, runId });
      if (!status) return res.status(404).json({ ok: false, error: 'card_run_not_found' });
      if (status.cardId !== cardId) {
        return res.status(409).json({ ok: false, error: 'card_run_stop_identity_mismatch' });
      }
      if (['completed', 'failed', 'cancelled', 'blocked'].includes(status.state)) {
        return res.json({ ok: true, result: status });
      }
      if (status.runtimeKind === 'hermes' && status.runtimeMode === 'magentic_one') {
        if (!status.nativeRootId) {
          return res.status(409).json({ ok: false, error: 'magentic_native_root_missing' });
        }
        const stopped = await requestPythonRailsJson('/magentic/execution/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nativeRootId: status.nativeRootId }),
        }) as MagenticExecutionStatus;
        if (!stopped?.ok || stopped.state !== 'cancelled') {
          throw new Error('magentic_execution_stop_invalid');
        }
        await finishMagenticOuterRun(runId, stopped);
        const cancelled = await readConfiguredCardRunStatus({ projectId, deckId, runId });
        return res.status(202).json({ ok: true, result: cancelled });
      }
      if (status.runtimeKind !== 'hermes') {
        return res.status(409).json({ ok: false, error: 'configured_card_stop_not_supported' });
      }
      const { deck } = await getDeckDocument(projectId, deckId);
      const card = deck?.nodes.find((candidate) => candidate.id === cardId);
      if (!deck || !card) {
        return res.status(404).json({ ok: false, error: 'agent_terminal_card_not_found' });
      }
      requireAgentTerminalCard(card, deck);
      const owner = await resolveCardRuntimeOwner(req, projectId, deckId, cardId, conversationId);
      const terminal = agentTerminalManager.find(owner);
      if (!terminal || !cardTurnBridge.ownsRun(terminal.sessionId, runId)) {
        return res.status(409).json({ ok: false, error: 'agent_terminal_run_not_active' });
      }
      agentTerminalManager.verifyConfiguration(owner, terminal.sessionId, card, deck);
      cardTurnBridge.requestCancellation(terminal.sessionId, runId);
      await agentTerminalManager.interrupt(owner, terminal.sessionId);
      return res.status(202).json({ ok: true, result: { ...status, status: 'stopping' } });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_stop_failed',
      });
    }
  }

  if (!cardId || !correlationId || !input) {
    return res.status(400).json({ ok: false, error: 'card_run_args_incomplete' });
  }
  if (body.background !== undefined && typeof body.background !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'card_run_background_must_be_boolean' });
  }
  if (body.background === true && (!senderCardId || !originatingRunId)) {
    return res.status(400).json({ ok: false, error: 'card_run_background_source_required' });
  }

  const acceptedAt = new Date().toISOString();
  const transientRequest = {
    projectId,
    deckId,
    cardId,
    assignment: input,
    senderCardId: senderCardId || undefined,
    originatingRunId: originatingRunId || undefined,
    conversationId,
    dataAnchors: Array.isArray(body.dataAnchors) ? body.dataAnchors : [],
    images: Array.isArray(body.images) ? body.images : [],
  };

  try {
    const cardRevisionId = String(body.cardRevisionId || '').trim();
    const savedPreparation = await prepareSavedCardRun({
      ...transientRequest,
      cardRevisionId: cardRevisionId || undefined,
      correlationId,
      acceptedAt,
    }) as any;
    const prepared = savedPreparation.prepared;

    const runId = String(prepared.runId || correlationId).trim();
    if (prepared.rejoined) {
      const status = await readConfiguredCardRunStatus({ projectId, deckId, runId });
      const canResumeUnboundMagentic = prepared.runtimeOwner === 'mag_one'
        && status
        && ['pending', 'running'].includes(status.state)
        && !status.nativeRootId;
      if (!canResumeUnboundMagentic) {
        return res.json({ ok: true, result: status });
      }
    }

    // A live native execution must own cancellation before acceptance is sent.
    // End only the HTTP wait; this handler still retains completion and failure.
    const acceptBackground = () => {
      if (body.background === true && !res.destroyed && !res.writableEnded) {
        res.status(202).json({ ok: true, result: {
          runId, cardId, state: 'running', acceptedAt,
        } });
      }
    };

    let runFinalized = false;
    const finishRun = async (
      state: 'completed' | 'failed' | 'cancelled',
      fields: Record<string, unknown> = {},
    ): Promise<any> => {
      if (runFinalized) return null;
      runFinalized = true;
      return requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, state, ...fields }),
      });
    };
    let output = '';
    let transport: Record<string, unknown> | null = null;
    let providerInputTokens: number | null = null;
    let providerOutputTokens: number | null = null;
    let totalCostUsd: number | null = null;
    let gatewayCompletion: GatewayCardExecution['hermesCompletion'] | null = null;
    let magenticStatus: MagenticExecutionStatus | null = null;
    const magenticAcceptance: { status: MagenticExecutionStatus | null } = { status: null };
    let magenticProgressBound = false;
    try {
      if (prepared.runtimeOwner === 'hermes') {
        const owner = await resolveCardRuntimeOwner(req, projectId, deckId, cardId, conversationId);
        const execution = await executePreparedGatewayCardRun({
          owner,
          conversationId,
          runId,
          prepared,
          savedDeck: savedPreparation.savedDeck,
          savedCard: savedPreparation.savedCard,
          onSubmitted: acceptBackground,
        });
        output = execution.text;
        gatewayCompletion = execution.hermesCompletion;
        transport = {
          threadId: execution.hermesCompletion.providerThreadId,
          turnId: execution.hermesCompletion.providerTurnId,
          hermesSessionId: execution.hermesCompletion.hermesSessionId,
          effectiveProvider: execution.hermesCompletion.effectiveProvider,
          providerApiMode: execution.hermesCompletion.providerApiMode,
          terminalSessionId: execution.terminalSessionId,
          runtimeSource: 'repository_hermes_gateway',
        };
        providerInputTokens = execution.hermesCompletion.inputTokens;
        providerOutputTokens = execution.hermesCompletion.outputTokens;
        totalCostUsd = execution.hermesCompletion.costUsd;
      } else if (prepared.runtimeOwner === 'mag_one' && prepared.magenticExecution) {
        magenticStatus = await executePreparedMagenticRun({
          req,
          projectId,
          deckId,
          conversationId,
          runId,
          senderCardId,
          prepared,
          savedDeck: savedPreparation.savedDeck,
          savedCard: savedPreparation.savedCard,
          onAccepted: (status) => {
            magenticAcceptance.status = status;
          },
          onSubmitted: () => {
            magenticProgressBound = true;
            acceptBackground();
          },
        });
        output = String(magenticStatus.finalResult || '');
        transport = {
          threadId: magenticStatus.nativeRootId,
          turnId: magenticStatus.nativeRunId ?? null,
          hermesSessionId: null,
          effectiveProvider: magenticStatus.effectiveProvider || null,
          providerApiMode: magenticStatus.providerApiMode || null,
          runtimeSource: 'repository_hermes_magentic',
        };
      } else if (prepared.runtimeOwner === 'mag_one') {
        throw new Error('magentic_execution_contract_missing');
      } else {
        throw new Error(`configured_card_runtime_owner_unsupported:${String(prepared.runtimeOwner || '')}`);
      }
      if (magenticStatus && !['completed', 'blocked', 'failed', 'cancelled'].includes(magenticStatus.state)) {
        if (res.destroyed || res.writableEnded) return undefined;
        return res.status(202).json({
          ok: true,
          result: {
            status: 'running',
            state: 'running',
            runId,
            correlationId: String(prepared.correlationId || correlationId),
            cardId,
            runtimeOwner: prepared.runtimeOwner,
            cardRevisionId: prepared.cardRevisionId,
            transport,
            receipt: null,
          },
        });
      }
      let finished: any = null;
      if (magenticStatus) {
        finished = await finishMagenticOuterRun(runId, magenticStatus);
        runFinalized = true;
        if (magenticStatus.state === 'completed'
          && !String(magenticStatus.finalResult || '').trim()) {
          throw new Error('magentic_final_result_missing');
        }
        if (magenticStatus.state !== 'completed') {
          throw new Error(magenticStatus.state === 'cancelled'
            ? 'hermes_turn_cancelled'
            : magenticStatus.error || `magentic_execution_${magenticStatus.state}`);
        }
      } else if (prepared.runtimeOwner !== 'hermes') {
        finished = await finishRun('completed', {
          hermesSessionRef: transport?.hermesSessionId || null,
          providerThreadRef: transport?.threadId || null,
          providerTurnRef: transport?.turnId || null,
          effectiveProvider: transport?.effectiveProvider || null,
          providerApiMode: transport?.providerApiMode || null,
          providerInputTokens,
          providerOutputTokens,
          totalCostUsd,
          finalResult: output,
        }) as any;
      }
      const requestFulfillmentDeferred = gatewayCompletion !== null;
      if (gatewayCompletion) {
        void enqueueRequestFulfillmentAssessment(runId, gatewayCompletion);
      }
      if (res.destroyed || res.writableEnded) return undefined;
      return res.json({
        ok: true,
        result: {
          status: 'completed',
          state: 'completed',
          runId,
          correlationId: String(prepared.correlationId || correlationId),
          cardId,
          runtimeOwner: prepared.runtimeOwner,
          cardRevisionId: prepared.cardRevisionId,
          invocation: {
            ephemeral: true,
            cardRevisionId: prepared.cardRevisionId,
            cardRevision: prepared.cardRevision,
            cardRevisionSha256: prepared.cardRevisionSha256,
            runtimeOwner: prepared.runtimeOwner,
            resolvedGraphReads: prepared.resolvedGraphReads,
            resolvedGraphProjection: prepared.resolvedGraphProjection,
            jevAutoTools: prepared.jevAutoTools,
            idf: prepared.idf,
            inputSummary: prepared.inputSummary,
            inputFile: prepared.inputFile,
            cardIdentity: prepared.cardIdentity,
          },
          output,
          requestFulfillmentDeferred,
          transport,
          receipt: finished?.receipt || null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
      const cancelled = message === 'hermes_turn_cancelled';
      const magenticAcceptedStatus = magenticAcceptance.status;
      if (prepared.runtimeOwner === 'mag_one'
        && magenticAcceptedStatus
        && !magenticProgressBound
        && !runFinalized) {
        await settleUnboundMagenticSubmission(
          runId,
          magenticAcceptedStatus,
          message,
        ).catch(() => undefined);
        runFinalized = true;
      } else if (prepared.runtimeOwner !== 'hermes') {
        await finishRun(cancelled ? 'cancelled' : 'failed', {
          ...(magenticAcceptedStatus ? {
            hermesSessionRef: null,
            providerThreadRef: magenticAcceptedStatus.nativeRootId,
            providerTurnRef: magenticAcceptedStatus.nativeRunId ?? null,
            effectiveProvider: magenticAcceptedStatus.effectiveProvider || null,
            providerApiMode: magenticAcceptedStatus.providerApiMode || null,
          } : {}),
          ...(magenticAcceptedStatus ? {
            nativeStatus: magenticAcceptedStatus.nativeStatus,
          } : {}),
          errorCode: cancelled ? 'configured_card_run_stopped' : 'configured_card_transport_failed',
          errorSummary: message,
        }).catch(() => undefined);
      }
      throw error;
    }
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
  }
});

// ── Persistent repo-owned Hermes Main bridge (BuilderChat -> Gateway) ───────
// One stable native Hermes conversation per saved Main card and product
// conversation. The saved Builder Agent remains a separate Hermes profile.

mainRoutes.get('/session/thinkgraph-revisions', async (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query?.conversationId || '').trim();
  if (!projectId || !conversationId) {
    return res.status(400).json({
      ok: false,
      error: 'projectId_and_conversationId_required',
    });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Engraphis is a Project authority. Every mounted surface for this Project
  // receives committed revisions, while the originating conversation remains
  // payload provenance and scopes lifecycle errors on publish.
  const key = thinkGraphRevisionScope(projectId, deckId);
  const subscribers = thinkGraphRevisionSubscribers.get(key) || new Map<Response, string>();
  subscribers.set(res, conversationId);
  thinkGraphRevisionSubscribers.set(key, subscribers);
  res.write(': ThinkGraph revisions connected\n\n');
  res.on('close', () => {
    subscribers.delete(res);
    if (!subscribers.size) thinkGraphRevisionSubscribers.delete(key);
  });
  return undefined;
});

mainRoutes.post('/session/chat', async (req, res) => {
  const acceptedAt = new Date().toISOString();
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'default').trim();
  const message = String(req.body?.message || '');
  const hasTargetCardId = Object.prototype.hasOwnProperty.call(req.body || {}, 'targetCardId');
  const targetCardId = hasTargetCardId && typeof req.body?.targetCardId === 'string'
    ? req.body.targetCardId.trim()
    : '';
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }
  if (hasTargetCardId && !targetCardId) {
    return res.status(400).json({ ok: false, error: 'target_card_id_invalid' });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;

  const parsedAddress = leadingAddress(message);
  let projectAuthority: ProjectSharedChatAuthority;
  let existingMessages: ConversationMessage[];
  try {
    projectAuthority = await resolveProjectSharedChatAuthority(projectId, deckId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'shared_chat_authority_unavailable';
    logHarnessTrace(`[shared-chat] request rejected reason=${redactTrace(reason)}`);
    return res.status(503).json({
      ok: false,
      error: reason === 'shared_chat_agent_address_invalid'
        ? reason
        : 'shared_chat_authority_unavailable',
    });
  }

  let addressedTarget: AddressableAgent | null = null;
  if (parsedAddress.attempted) {
    if (!parsedAddress.address) {
      return res.status(400).json({ ok: false, error: 'addressed_card_name_required' });
    }
    const matches = [projectAuthority.main, ...projectAuthority.addressableAgents]
      .filter((agent) => agent.aliases.includes(parsedAddress.address!));
    if (matches.length !== 1) {
      return res.status(409).json({
        ok: false,
        error: matches.length > 1 ? 'addressed_card_ambiguous' : 'addressed_card_unavailable',
        address: parsedAddress.address,
      });
    }
    addressedTarget = matches[0];
  }
  const selectedTargets = targetCardId
    ? projectAuthority.cards.filter((card) => card.cardId === targetCardId)
    : [];
  if (targetCardId && selectedTargets.length !== 1) {
    return res.status(409).json({
      ok: false,
      error: 'target_card_unavailable',
      targetCardId,
    });
  }
  const selectedTarget = selectedTargets[0] || null;
  if (addressedTarget && selectedTarget && addressedTarget.cardId !== selectedTarget.cardId) {
    return res.status(409).json({
      ok: false,
      error: 'shared_chat_target_mismatch',
      address: parsedAddress.address,
      targetCardId,
    });
  }
  const target = selectedTarget || addressedTarget || projectAuthority.main;
  const directAddressed = target.cardId !== projectAuthority.main.cardId;

  try {
    existingMessages = await getConversationMessages(projectId, conversationId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'shared_conversation_unavailable';
    logHarnessTrace(`[shared-chat] history rejected reason=${redactTrace(reason)}`);
    return res.status(503).json({ ok: false, error: 'shared_conversation_unavailable' });
  }

  const requestedRunId = `req_${randomUUID().slice(0, 8)}`;
  let run: PreparedMainCliRun;
  let completedPairAuthority: SharedChatAuthority | null = null;
  try {
    if (directAddressed) {
      const savedPreparation = await prepareSavedCardRun({
        projectId,
        deckId,
        cardId: target.cardId,
        cardRevisionId: target.cardRevisionId || undefined,
        assignment: message,
        conversationId,
        correlationId: requestedRunId,
        acceptedAt,
        dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
        images: Array.isArray(req.body?.images) ? req.body.images : [],
        sharedConversation: boundedSharedContext(
          existingMessages,
          projectAuthority.main,
          target,
        ),
        sharedConversationTargetLabel: target.title,
      });
      const prepared = savedPreparation.prepared;
      const exactHermesIdentity = prepared.runtimeOwner === 'hermes'
        && String(prepared.hermesTransport?.cardIdentity?.cardId || '') === target.cardId
        && String(prepared.hermesTransport?.request?.runtime?.profile || '') === target.profile
        && Boolean(prepared.hermesTransport?.request);
      const exactMagenticIdentity = prepared.runtimeOwner === 'mag_one'
        && String(prepared.magenticExecution?.orchestrator?.cardId || '') === target.cardId
        && String(prepared.magenticExecution?.orchestrator?.cardRevisionId || '') === target.cardRevisionId
        && String(prepared.magenticExecution?.orchestrator?.nativeIdentity || '') === target.profile
        && Boolean(prepared.magenticExecution);
      if (
        String(prepared.runId || '') !== requestedRunId
        || (!exactHermesIdentity && !exactMagenticIdentity)
      ) {
        throw new Error('addressed_card_runtime_identity_mismatch');
      }
      run = {
        projectId,
        deckId,
        conversationId,
        runId: requestedRunId,
        cardId: target.cardId,
        driverSource: 'internal_chat',
        prepared,
        savedDeck: savedPreparation.savedDeck,
        savedCard: savedPreparation.savedCard,
      };
    } else {
      completedPairAuthority = await resolveSharedChatAuthority(projectId, deckId);
      if (
        completedPairAuthority.main.cardId !== projectAuthority.main.cardId
        || completedPairAuthority.main.cardRevisionId !== projectAuthority.main.cardRevisionId
      ) {
        throw new Error('main_card_identity_mismatch');
      }
      run = await prepareMainCliRun({
        projectId,
        deckId,
        cardId: projectAuthority.main.cardId,
        conversationId,
        message,
        driverSource: 'internal_chat',
        runId: requestedRunId,
        acceptedAt,
        dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
        images: Array.isArray(req.body?.images) ? req.body.images : [],
        sharedConversation: boundedSharedContext(
          existingMessages,
          projectAuthority.main,
          projectAuthority.main,
        ),
      });
      if (run.cardId !== projectAuthority.main.cardId) {
        throw new Error('main_card_identity_mismatch');
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : (
      directAddressed ? 'addressed_card_preparation_failed' : 'main_domain_preparation_failed'
    );
    logHarnessTrace(`[shared-chat] preparation rejected reason=${redactTrace(reason)}`);
    return res.status(reason === 'main_hermes_card_not_runnable' ? 424 : 503).json({
      ok: false,
      error: directAddressed
        ? 'addressed_card_preparation_failed'
        : reason === 'main_hermes_card_not_runnable' ? reason : 'main_domain_preparation_failed',
      ...(directAddressed ? {
        address: target.address || null,
        targetCardId: target.cardId,
      } : {}),
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const eventIdentity = {
    projectId,
    deckId,
    conversationId,
    cardId: run.cardId,
    runId: run.runId,
    participant: cardParticipant(target),
    directAddressed,
  };
  const writeSse = (eventName: string, payload: Record<string, unknown>): boolean => {
    if (res.destroyed || res.writableEnded) return false;
    res.write(`event: ${eventName}\ndata: ${JSON.stringify({ ...payload, ...eventIdentity })}\n\n`);
    return true;
  };
  writeSse('run', {
    // Run preparation identifies the intended Card, but it is not proof that
    // the target runtime accepted or answered the message.
    state: 'preparing',
    turnOwner: directAddressed ? 'addressed_card' : 'main',
    ...(directAddressed ? {} : {
      driverSource: 'internal_chat',
      contextAuthorityMode: contextAuthorityModeForDriver('internal_chat'),
    }),
  });
  const magenticAcceptance: { status: MagenticExecutionStatus | null } = { status: null };
  let magenticProgressBound = false;
  let magenticOuterRunFinalized = false;
  let completedPairLifecycle: {
    completedPair: Record<string, unknown>;
    originatingRunId: string;
  } | null = null;
  try {
    let resultText = '';
    let continuationRef = '';
    let gatewayCompletion: GatewayCardExecution['hermesCompletion'] | null = null;
    let usage = {
      providerInputTokens: null as number | null,
      providerOutputTokens: null as number | null,
      providerCachedTokens: null as number | null,
      providerReasoningTokens: null as number | null,
      totalCostUsd: null as number | null,
      usageAvailable: false,
      usageSource: 'native_magnetic_submission',
    };
    if (directAddressed && run.prepared.runtimeOwner === 'mag_one') {
      const status = await executePreparedMagenticRun({
        req,
        projectId,
        deckId,
        conversationId,
        runId: run.runId,
        prepared: run.prepared,
        savedDeck: run.savedDeck,
        savedCard: run.savedCard,
        onAccepted: (accepted) => {
          magenticAcceptance.status = accepted;
        },
        onSubmitted: () => {
          magenticProgressBound = true;
          writeSse('run', {
            state: 'running',
            turnOwner: 'addressed_card',
            runtimeOwner: 'mag_one',
          });
        },
      });
      continuationRef = status.nativeRootId;
      if (['completed', 'blocked', 'failed', 'cancelled'].includes(status.state)) {
        await finishMagenticOuterRun(run.runId, status);
        magenticOuterRunFinalized = true;
        if (status.state === 'completed') {
          resultText = String(status.finalResult || '').trim();
          if (!resultText) throw new Error('magentic_final_result_missing');
        } else {
          throw new Error(status.state === 'cancelled'
            ? 'hermes_turn_cancelled'
            : status.error || `magentic_execution_${status.state}`);
        }
      } else {
        resultText = `Magnetic accepted this mission. Run ${run.runId} is active.`;
      }
    } else {
      const owner = await resolveCardRuntimeOwner(
        req, projectId, deckId, run.cardId, conversationId,
      );
      const result = await executePreparedGatewayCardRun({
        owner,
        conversationId,
        runId: run.runId,
        prepared: run.prepared,
        savedDeck: run.savedDeck,
        savedCard: run.savedCard,
        attachTui: directAddressed,
        surface: directAddressed ? 'card-shared-chat' : undefined,
        onBound: (terminal) => {
          writeSse('session', {
            sessionId: terminal.hermesSessionId,
            runtimeSessionId: terminal.sessionId,
            turnOwner: directAddressed ? 'addressed_card' : 'main',
            ...(directAddressed ? {} : {
              driverSource: 'internal_chat',
              contextAuthorityMode: contextAuthorityModeForDriver('internal_chat'),
            }),
            configuration: {
              provider: run.prepared.hermesTransport.request.provider?.provider || null,
              model: run.prepared.hermesTransport.request.provider?.providerModelId || null,
              profile: terminal.profile,
              grantedTools: run.prepared.hermesTransport.request.enabledTools || [],
              unavailableTools: run.prepared.hermesTransport.request.unavailableTools || [],
              loadedSkills: run.prepared.hermesTransport.request.skills || [],
            },
          });
        },
        onEvent: (event) => {
          if (!directAddressed && (event.type === 'message.delta' || event.type === 'message.interim')) {
            const text = String(event.payload?.text || '');
            if (text) writeSse('text', { text });
          }
        },
      });
      resultText = result.text;
      continuationRef = result.hermesSessionId;
      gatewayCompletion = result.hermesCompletion;
      usage = {
        providerInputTokens: result.hermesCompletion.inputTokens,
        providerOutputTokens: result.hermesCompletion.outputTokens,
        providerCachedTokens: result.hermesCompletion.cachedTokens,
        providerReasoningTokens: result.hermesCompletion.reasoningTokens,
        totalCostUsd: result.hermesCompletion.costUsd,
        usageAvailable: (result.hermesCompletion.inputTokens || 0) > 0
          || (result.hermesCompletion.outputTokens || 0) > 0,
        usageSource: 'native_gateway',
      };
    }
    if (!resultText.trim()) {
      throw new Error(directAddressed ? 'addressed_card_empty_response' : 'main_empty_response');
    }
    try {
      await appendSharedConversationTurn({
        projectId,
        conversationId,
        messages: [
          {
            role: 'user',
            content: message,
            speaker: SHARED_CHAT_USER,
            target: cardParticipant(target),
            providerMessageId: run.runId,
          },
          {
            role: 'assistant',
            content: resultText,
            speaker: cardParticipant(target),
            providerContinuationRef: continuationRef,
            providerMessageId: run.runId,
          },
        ],
      });
    } catch {
      throw new Error('shared_conversation_persistence_failed');
    }
    writeSse('done', {
      fullText: resultText,
      turnOwner: directAddressed ? 'addressed_card' : 'main',
      ...(directAddressed ? {} : {
        contextAuthorityMode: contextAuthorityModeForDriver('internal_chat'),
      }),
      usage,
    });
    const requestFulfillment = gatewayCompletion
      ? await assessGatewayRunCompletion(run.runId, gatewayCompletion)
      : {
        schemaVersion: 'request-fulfillment-assessment.v1',
        metric: 'request_fulfillment',
        rubricVersion: 'request-fulfillment.v1',
        status: 'unavailable',
        runId: run.runId,
        executionEvidenceComplete: false,
        executionEvidenceError: 'request_fulfillment_execution_evidence_unavailable',
        failureReason: 'request_fulfillment_execution_evidence_unavailable',
        requestCount: 0,
        questionCount: 0,
      };
    writeSse('request_fulfillment', {
      kind: 'request_fulfillment',
      assessment: requestFulfillment,
    });
    if (!directAddressed) completedPairLifecycle = {
      originatingRunId: run.runId,
      completedPair: {
        projectId,
        deckId,
        conversationId,
        runId: run.runId,
        cardId: run.cardId,
        nativeSessionRef: continuationRef,
        completedAt: new Date().toISOString(),
        userMessage: message,
        mainResponse: resultText,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : (
      directAddressed ? 'addressed_card_turn_failed' : 'main_gateway_turn_failed'
    );
    const magenticAcceptedStatus = magenticAcceptance.status;
    if (
      directAddressed
      && run.prepared.runtimeOwner === 'mag_one'
      && magenticAcceptedStatus
      && !magenticProgressBound
      && !magenticOuterRunFinalized
    ) {
      await settleUnboundMagenticSubmission(
        run.runId,
        magenticAcceptedStatus,
        reason,
      ).catch(() => undefined);
      magenticOuterRunFinalized = true;
    } else if (
      directAddressed
      && run.prepared.runtimeOwner === 'mag_one'
      && !magenticAcceptedStatus
      && !magenticOuterRunFinalized
    ) {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: run.runId, state: 'failed',
          errorCode: 'configured_card_transport_failed', errorSummary: reason }),
      }).catch(() => undefined);
      magenticOuterRunFinalized = true;
    }
    const busy = reason === 'agent_terminal_turn_already_running';
    const cancelled = reason === 'hermes_turn_cancelled';
    const persistence = reason === 'shared_conversation_persistence_failed';
    writeSse('error', {
      code: busy || cancelled || persistence
        ? reason
        : directAddressed ? 'addressed_card_turn_failed' : 'main_gateway_turn_failed',
      message: busy
        ? `Another ${target.title} input driver owns the active turn.`
        : cancelled
          ? `The ${target.title} turn was cancelled.`
          : persistence
            ? 'The native reply completed but the shared conversation could not be persisted.'
            : directAddressed
              ? `The native ${target.title} turn failed.`
              : 'The native Main CLI turn failed.',
      status: busy
        ? 409
        : 502,
    });
  } finally {
    writeSse('end', {});
    if (!res.destroyed && !res.writableEnded) res.end();
    if (completedPairLifecycle && completedPairAuthority) {
      const lifecycle = completedPairLifecycle;
      const authority = completedPairAuthority;
      setImmediate(() => {
        void enqueueCompletedPairThinkGraphLifecycle({
          req,
          projectId,
          deckId,
          conversationId,
          authority,
          originatingRunId: lifecycle.originatingRunId,
          completedPair: lifecycle.completedPair,
        });
      });
    }
  }
  return undefined;
});
mainRoutes.post('/session/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  const expectedCardId = String(req.body?.expectedCardId || '').trim();
  if (!projectId || !conversationId || !expectedRunId) {
    return res.status(400).json({
      ok: false,
      error: 'projectId_conversationId_and_expected_run_id_required',
    });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;
  try {
    const authority = await resolveProjectSharedChatAuthority(projectId, deckId);
    const cardId = expectedCardId || authority.main.cardId;
    if (!authority.cards.some((card) => card.cardId === cardId)) {
      return res.status(403).json({ ok: false, error: 'shared_chat_card_not_authorized' });
    }
    const configuredCard = authority.deck.nodes.find((candidate) => candidate.id === cardId);
    if (
      configuredCard?.runtime.kind === 'hermes'
      && configuredCard.runtime.mode === 'magentic_one'
    ) {
      const configuredRun = await readConfiguredCardRunStatus({
        projectId,
        deckId,
        runId: expectedRunId,
      });
      if (!configuredRun || configuredRun.cardId !== cardId
        || configuredRun.runtimeKind !== 'hermes'
        || configuredRun.runtimeMode !== 'magentic_one') {
        return res.status(404).json({ ok: false, error: 'no_active_turn' });
      }
      if (['completed', 'failed', 'cancelled', 'blocked'].includes(configuredRun.state)) {
        return res.status(404).json({ ok: false, error: 'no_active_turn' });
      }
      if (!configuredRun.nativeRootId) {
        return res.status(409).json({ ok: false, error: 'magentic_native_root_missing' });
      }
      const stopped = await requestPythonRailsJson('/magentic/execution/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nativeRootId: configuredRun.nativeRootId }),
      }) as MagenticExecutionStatus;
      if (!stopped?.ok || stopped.state !== 'cancelled'
        || stopped.nativeRootId !== configuredRun.nativeRootId) {
        throw new Error('magentic_execution_stop_invalid');
      }
      await finishMagenticOuterRun(expectedRunId, stopped);
      return res.status(202).json({ ok: true, runId: expectedRunId, state: 'cancelled' });
    }
    const runtime = agentTerminalManager.findCard(projectId, deckId, cardId);
    if (!runtime) return res.status(404).json({ ok: false, error: 'no_active_turn' });
    if (!cardTurnBridge.ownsRun(runtime.state.sessionId, expectedRunId)) {
      return res.status(404).json({ ok: false, error: 'no_active_turn' });
    }
    cardTurnBridge.requestCancellation(runtime.state.sessionId, expectedRunId);
    await agentTerminalManager.interrupt(runtime.owner, runtime.state.sessionId);
    return res.status(202).json({ ok: true, runId: expectedRunId, state: 'stopping' });
  } catch (error) {
    return res.status(503).json({ ok: false,
      error: error instanceof Error ? error.message : 'main_gateway_stop_unavailable' });
  }
});
mainRoutes.post('/session/answer', (_req, res) => {
  return res.status(409).json({
    ok: false,
    error: 'main_cli_structured_answer_unavailable',
  });
});
mainRoutes.get('/session/history', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const conversationId = String(req.query.conversationId || '').trim();
  const deckId = String(req.query.deckId || BUILDER_DECK_ID).trim();
  if (!projectId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'main_cli_history_scope_required', messages: [] });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;
  let authority: ProjectSharedChatAuthority;
  let sharedMessages: ConversationMessage[];
  let hermesSessionId = '';
  let runtimeSessionId = '';
  try {
    authority = await resolveProjectSharedChatAuthority(projectId, deckId);
    // The Project conversation is the one shared visible history authority for
    // Main, direct Card turns, typed input, and voice input. Hermes session
    // history remains execution-owned and must not gate or replace this read.
    sharedMessages = await getConversationMessages(projectId, conversationId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'main_cli_history_read_failed';
    return res.status(reason === 'agent_terminal_history_scope_mismatch' ? 409 : 503)
      .json({ ok: false, error: [
        'agent_terminal_history_scope_mismatch',
        'persisted_main_chat_mismatch',
        'shared_chat_agent_address_invalid',
      ].includes(reason)
        ? reason : 'main_cli_history_read_failed', messages: [] });
  }
  const runtime = agentTerminalManager.findCard(
    projectId,
    deckId,
    authority.main.cardId,
  );
  if (runtime) {
    hermesSessionId = runtime.state.hermesSessionId;
    runtimeSessionId = runtime.state.sessionId;
  }
  return res.json({
    ok: true,
    hermesSessionId,
    runtimeSessionId,
    mainCardId: authority.main.cardId,
    addressableAgents: authority.addressableAgents,
    messages: sharedMessages
      .filter((message) => (
        (message.role === 'user' || message.role === 'assistant')
        && message.status === 'complete'
      ))
      .map((message) => sharedHistoryMessage(message, authority.main)),
    terminalEvents: [],
  });
});
mainRoutes.delete('/session/history', (_req, res) => {
  return res.status(405).json({
    ok: false,
    error: 'main_cli_history_is_native_owned',
  });
});
mainRoutes.get('/session/conversations', async (req, res) => {
  const projectId = String(req.query?.projectId || '');
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId_required', conversations: [] });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;
  try {
    const conversations = (await listConversations(projectId))
      .filter((conversation) => !conversation.archivedAt)
      .map((conversation) => ({
        conversationId: conversation.conversationId,
        title: conversation.title || conversation.conversationId,
        updatedAt: conversation.updatedAt,
      }));
    return res.json({ ok: true, conversations });
  } catch {
    return res.json({ ok: true, conversations: [] });
  }
});

/** Resolve the saved Main Card's durable Hermes identity, never its title or grants. */
async function resolveMainChatHermesIdentity(
  projectId: string,
  deckId: string,
): Promise<{ cardId: string; profile: string } | null> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find(
    (node: any) =>
      node?.runtime?.kind === 'hermes' && node?.runtime?.mode === 'main',
  );
  const runtime = card?.runtime;
  if (!card || runtime?.kind !== 'hermes' || runtime.mode !== 'main') return null;
  const cardId = String(card?.id || '').trim();
  const profile = String(runtime.profile || '').trim();
  return cardId && profile ? { cardId, profile } : null;
}

export default router;
