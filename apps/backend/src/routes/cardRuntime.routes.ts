import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  agentTerminalManager,
  agentTerminalPresentationOptions,
  requireAgentTerminalCard,
  resolveHermesBotRosterProjections,
  type AgentTerminalGatewayEvent,
  type AgentTerminalOwner,
  type HermesBotRosterProjection,
} from '../hermes/agentTerminal';
import { agentTerminalExecution } from '../hermes/agentTerminalExecution';
import { buildCardTerminal, projectKanbanTerminal, terminalText } from '../hermes/cardTerminal';
import {
  appendSharedConversationTurn,
  getConversationMessages,
  listConversations,
  type ConversationMessage,
  type SharedChatMessageWrite,
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
import { listConfiguredModelOptions } from '../llm/models.config';
import {
  HERMES_KANBAN_TASK_STATUSES,
  readHermesKanbanCardSnapshots,
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
    if (!project?.ownerUserId?.trim()) {
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

type AddressableAgent = {
  cardId: string;
  cardRevisionId: string;
  profile: string;
  title: string;
  address: string;
  aliases: string[];
};

type SharedChatAuthority = {
  main: AddressableAgent;
  agents: AddressableAgent[];
};

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
    address: agent.address,
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
): Array<Record<string, string>> {
  const projected = messages
    .filter((message) => (
      (message.role === 'user' || message.role === 'assistant')
      && message.status === 'complete'
      && message.content.length > 0
    ))
    .map((message) => ({ message, view: sharedHistoryMessage(message, main) }));
  let lastMainReply = -1;
  for (let index = 0; index < projected.length; index += 1) {
    const entry = projected[index];
    if (entry.view.role === 'assistant' && entry.view.speaker.cardId === main.cardId) {
      lastMainReply = index;
    }
  }
  const candidates = projected.slice(lastMainReply + 1).slice(-SHARED_CONTEXT_MESSAGE_LIMIT);
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

async function nativeMainHistorySeed(
  projectId: string,
  deckId: string,
  main: AddressableAgent,
): Promise<SharedChatMessageWrite[]> {
  try {
    const runtime = agentTerminalManager.findCard(projectId, deckId, main.cardId);
    if (!runtime) return [];
    const history = await agentTerminalManager.history(runtime.owner, runtime.state.sessionId);
    return history.messages
      .filter((message) => (
        (message.role === 'user' || message.role === 'assistant')
        && String(message.text || '').length > 0
      ))
      .map((message) => ({
        role: message.role === 'user' ? 'user' as const : 'assistant' as const,
        content: String(message.text || ''),
        speaker: message.role === 'user' ? SHARED_CHAT_USER : cardParticipant(main),
        ...(message.role === 'user' ? { target: cardParticipant(main) } : {}),
        providerContinuationRef: runtime.state.nativeSessionId,
      }));
  } catch {
    return [];
  }
}

export function materializerReadPrincipalForSavedCard(args: {
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId?: string;
}, card: {
  runtimeOptions?: { tools?: unknown; mcpConnectionIds?: unknown } | null;
} | undefined): InternalMcpPrincipal {
  const savedTools = Array.isArray(card?.runtimeOptions?.tools)
    ? card.runtimeOptions.tools
    : [];
  const grantedTools = [...new Set(savedTools
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const savedConnections = Array.isArray(card?.runtimeOptions?.mcpConnectionIds)
    ? card.runtimeOptions.mcpConnectionIds
    : [];
  const grantedConnections = [...new Set(savedConnections
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return {
    kind: 'materializer-read',
    projectId: args.projectId,
    deckId: args.deckId,
    callerCardId: args.cardId,
    ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    grantedTools,
    grantedConnections,
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
  dataAnchors?: unknown[];
  images?: unknown[];
}): Promise<any> {
  const saved = await readSavedCardRunCatalog(args);
  const snapshotRevisionId = String(saved.card?._cardRevisionId || '').trim();
  if (!saved.card || !snapshotRevisionId) throw new Error('card_revision_changed');
  if (args.cardRevisionId && args.cardRevisionId !== snapshotRevisionId) {
    throw new Error('card_revision_changed');
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
      cardRevisionId: snapshotRevisionId,
      runId: args.correlationId,
      correlationId: args.correlationId,
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

async function resolveCardRuntimeOwner(
  req: Request,
  projectId: string,
  deckId: string,
  cardId: string,
): Promise<AgentTerminalOwner> {
  const authenticated = (req as any).internalMcpBridgeAuthenticated === true || (
    typeof (req as any).userId === 'string'
    && String((req as any).userId).trim().length > 0
  );
  if (!authenticated) throw new Error('agent_terminal_owner_authentication_required');
  const runtime = agentTerminalManager.findCard(projectId, deckId, cardId);
  if (runtime) return runtime.owner;
  const project = await getProjectCard(projectId);
  const savedOwnerUserId = String(project?.ownerUserId || '').trim();
  if (!savedOwnerUserId) throw new Error('agent_terminal_project_owner_missing');
  return { userId: savedOwnerUserId, projectId, deckId, cardId };
}

async function prepareMainCliRun(args: {
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId: string;
  message: string;
  driverSource: RemoteMainDriverSource;
  runId?: string;
  dataAnchors?: unknown[];
  sharedConversation?: Array<Record<string, string>>;
}): Promise<PreparedMainCliRun> {
  const runId = String(args.runId || `req_${randomUUID().slice(0, 8)}`);
  const saved = await readSavedCardRunCatalog(args);
  const snapshotRevisionId = String(saved.card?._cardRevisionId || '').trim();
  if (!saved.card || !snapshotRevisionId) throw new Error('card_revision_changed');
  const discoveredToolCatalog = saved.catalog;
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
      dataAnchors: Array.isArray(args.dataAnchors) ? args.dataAnchors : [],
      sharedConversation: Array.isArray(args.sharedConversation) ? args.sharedConversation : [],
      cardRevisionId: snapshotRevisionId,
      discoveredTools: discoveredToolCatalog.tools,
      discoveredToolCatalogState: discoveredToolCatalog.state,
      unavailableToolCatalogFamilies: discoveredToolCatalog.unavailableFamilies,
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
    const runtime = agentTerminalManager.findCard(projectId, deckId, mainCardId);
    if (!runtime) throw new Error('agent_card_runtime_not_started');
    const result = await executePreparedGatewayCardRun({
      owner: runtime.owner,
      conversationId,
      runId: run.runId,
      prepared: run.prepared,
      savedDeck: run.savedDeck,
      savedCard: run.savedCard,
    });
    return res.json({
      ok: true,
      runId: run.runId,
      cardId: run.cardId,
      driverSource: run.driverSource,
      contextAuthorityMode: contextAuthorityModeForDriver('external_plugin'),
      finalText: result.text,
      nativeSessionId: result.nativeSessionId,
      nativeTurnId: result.nativeCompletion.nativeRunId,
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
  startedAt: string | null;
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
  effectiveProvider: string | null;
  providerApiMode: string | null;
  tasksCompleted: number;
  tasksTotal: number;
  activeWorkers: number;
  elapsedMs: number;
  toolCallCount: number | null;
  graphReads: number;
  graphWrites: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
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
    const workerSessionId = task.workerSessionId === null
      ? null
      : typeof task.workerSessionId === 'string'
        && task.workerSessionId === task.workerSessionId.trim()
        && task.workerSessionId.length > 0
        && task.workerSessionId.length <= 512
        ? task.workerSessionId
        : undefined;
    const handoffSummary = task.handoffSummary === null
      ? null
      : typeof task.handoffSummary === 'string'
        && task.handoffSummary.trim().length > 0
        && task.handoffSummary.length <= 2_000
        ? task.handoffSummary
        : undefined;
    const rawReceipts = Array.isArray(task.toolReceipts) && task.toolReceipts.length <= 64
      ? task.toolReceipts
      : null;
    const receiptIds = new Set<string>();
    const toolReceipts = rawReceipts?.map((candidateReceipt) => {
      if (!candidateReceipt || typeof candidateReceipt !== 'object'
        || Array.isArray(candidateReceipt)) {
        throw new Error('magentic_execution_tasks_invalid');
      }
      const receipt = candidateReceipt as Record<string, unknown>;
      const toolCallId = typeof receipt.toolCallId === 'string' ? receipt.toolCallId : '';
      const toolName = typeof receipt.toolName === 'string' ? receipt.toolName : '';
      const state = receipt.state;
      const resultPreview = receipt.resultPreview;
      const rawExecutionReceipt = receipt.executionReceipt;
      let executionReceipt: {
        schema: 'agent-runtime.execution-receipt.v1';
        tool: string;
        correlationId: string;
        state: 'completed' | 'failed';
      } | null = null;
      if (rawExecutionReceipt !== null) {
        if (!rawExecutionReceipt || typeof rawExecutionReceipt !== 'object'
          || Array.isArray(rawExecutionReceipt)) {
          throw new Error('magentic_execution_tasks_invalid');
        }
        const exactReceipt = rawExecutionReceipt as Record<string, unknown>;
        const executionTool = typeof exactReceipt.tool === 'string' ? exactReceipt.tool : '';
        const correlationId = typeof exactReceipt.correlationId === 'string'
          ? exactReceipt.correlationId : '';
        if (
          Object.keys(exactReceipt).sort().join('\0')
            !== 'correlationId\0schema\0state\0tool'
          || exactReceipt.schema !== 'agent-runtime.execution-receipt.v1'
          || !executionTool || executionTool !== executionTool.trim()
          || executionTool.length > 128
          || !correlationId || correlationId !== correlationId.trim()
          || correlationId.length > 512
          || (exactReceipt.state !== 'completed' && exactReceipt.state !== 'failed')
        ) throw new Error('magentic_execution_tasks_invalid');
        executionReceipt = {
          schema: 'agent-runtime.execution-receipt.v1',
          tool: executionTool,
          correlationId,
          state: exactReceipt.state,
        };
      }
      if (
        !toolCallId || toolCallId !== toolCallId.trim() || toolCallId.length > 512
        || !toolName || toolName !== toolName.trim() || toolName.length > 512
        || receiptIds.has(toolCallId)
        || (state !== null && state !== 'returned' && state !== 'failed')
        || typeof resultPreview !== 'string' || resultPreview.length > 1_000
      ) throw new Error('magentic_execution_tasks_invalid');
      receiptIds.add(toolCallId);
      return {
        toolCallId,
        toolName,
        state: state as 'returned' | 'failed' | null,
        resultPreview,
        executionReceipt,
      };
    });
    const toolReceiptsComplete = typeof task.toolReceiptsComplete === 'boolean'
      ? task.toolReceiptsComplete
      : undefined;
    if (
      workerSessionId === undefined
      || handoffSummary === undefined
      || !toolReceipts
      || toolReceiptsComplete === undefined
      || (workerSessionId === null && (toolReceipts.length > 0 || toolReceiptsComplete))
    ) throw new Error('magentic_execution_tasks_invalid');
    return {
      taskId,
      title,
      assignee,
      status: status as HermesKanbanTaskStatus,
      dependencyIds: dependencyIds as string[],
      latestAttempt,
      resultAvailable: task.resultAvailable,
      workerSessionId,
      handoffSummary,
      toolReceipts,
      toolReceiptsComplete,
    };
  });
  if (!taskIds.has(nativeRootId)) throw new Error('magentic_execution_tasks_invalid');
  return tasks;
}

async function ensureMagenticAgents(
  req: Request,
  projectId: string,
  deckId: string,
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
      req, projectId, deckId, orchestratorCardId,
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
    const owner = await resolveCardRuntimeOwner(req, projectId, deckId, cardId);
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
  runId: string;
  senderCardId: string;
  prepared: any;
  savedDeck?: any;
  savedCard?: any;
  onAccepted: (status: MagenticExecutionStatus) => void;
  onSubmitted: () => void;
}): Promise<MagenticExecutionStatus> {
  assertPreparedSavedCardSnapshot(args.prepared, args.savedCard);
  const workerAuthorities = await ensureMagenticAgents(
    args.req, args.projectId, args.deckId, args.prepared, args.savedDeck,
  );
  const sender = args.senderCardId
    ? agentTerminalManager.findCard(args.projectId, args.deckId, args.senderCardId)
    : null;
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
  const nativeKanbanRoot = run.runtimeMode === 'kanban'
    && /^t_[A-Za-z0-9_-]+$/.test(nativeRootId);
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
  const attention = Array.isArray(telemetryRun?.attentionEvents)
    ? telemetryRun.attentionEvents
    : Array.isArray(inspection?.attentionEvents) ? inspection.attentionEvents : [];
  const graphReads = Number.isSafeInteger(telemetryRun?.graphReads)
    ? telemetryRun.graphReads
    : attention.filter((event: any) => String(event?.operation || '') === 'read').length;
  const graphWrites = Number.isSafeInteger(telemetryRun?.graphWrites)
    ? telemetryRun.graphWrites
    : attention.filter((event: any) => String(event?.operation || '') === 'write').length;
  const startedAt = Date.parse(String(run.startedAt || ''));
  const finishedAt = Date.parse(String(run.finishedAt || ''));
  const elapsedMs = Number.isFinite(startedAt)
    ? Math.max(0, (Number.isFinite(finishedAt) ? finishedAt : Date.now()) - startedAt)
    : 0;
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
    if (run.runtimeKind === 'hermes' && nativeKanbanRoot) {
      try {
        const snapshots = await readHermesKanbanCardSnapshots({
          nativeRootId, projectId: String(run.projectId), cardId: String(run.cardId),
          runtimeProfile: String(run.runtimeProfile || ''),
        });
        terminal = projectKanbanTerminal(run, snapshots);
      } catch (error) {
        terminal = { ...terminal, observation: 'unavailable',
          unavailableReason: terminalText(error instanceof Error ? error.message : 'kanban_observation_failed') };
      }
    }
  }
  return {
    runId,
    conversationId: String(telemetryRun?.conversationId || '').trim() || null,
    startedAt: String(run.startedAt || '').trim() || null,
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
    effectiveProvider: String(run.effectiveProvider || '').trim() || null,
    providerApiMode: String(run.providerApiMode || '').trim() || null,
    tasksCompleted: nonNegativeNumber(run.tasksCompleted),
    tasksTotal: nonNegativeNumber(run.tasksTotal),
    activeWorkers: nonNegativeNumber(run.activeWorkers),
    elapsedMs,
    toolCallCount: nullableNonNegativeNumber(run.toolCallCount),
    graphReads,
    graphWrites,
    inputTokens: nonNegativeNumber(run.inputTokens),
    outputTokens: nonNegativeNumber(run.outputTokens),
    cachedTokens: nonNegativeNumber(run.cachedTokens),
    reasoningTokens: nonNegativeNumber(run.reasoningTokens),
    costUsd: nullableNonNegativeNumber(run.costUsd),
    resultReady: output !== null,
    output,
    errorCode: String(run.errorCode || '').trim() || null,
    errorSummary: String(run.errorSummary || '').trim() || null,
    ...(terminal ? { terminal } : {}),
  };
}

type GatewayCardExecution = {
  owner: AgentTerminalOwner;
  terminalSessionId: string;
  nativeSessionId: string;
  storedSessionId: string;
  profile: string;
  nativeCompletion: Awaited<ReturnType<typeof agentTerminalExecution.completeStaged>>;
  text: string;
};

async function executePreparedGatewayCardRun(args: {
  owner: AgentTerminalOwner;
  conversationId: string;
  runId: string;
  prepared: any;
  savedDeck?: any;
  savedCard?: any;
  onEvent?: (event: AgentTerminalGatewayEvent) => void;
  onBound?: (terminal: { sessionId: string; nativeSessionId: string; profile: string }) => void;
  onSubmitted?: () => void;
  attachTui?: boolean;
  surface?: 'card-shared-chat';
}): Promise<GatewayCardExecution> {
  let terminalSessionId = '';
  let staged = false;
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
    args.onBound?.(terminal);

    let stagedPrepared = args.prepared;
    const transientTask = String(args.prepared.hermesTransport?.request?.task || '').trim();
    if (transientTask === '/learn' || transientTask.startsWith('/learn ')) {
      if (args.prepared.hermesTransport?.request?.runtime?.mode === 'kanban') {
        throw new Error('hermes_learn_unavailable_for_kanban');
      }
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
    if (stagedPrepared.hermesTransport?.request?.runtime?.mode === 'kanban') {
      throw new Error('hermes_kanban_card_mode_retired');
    }
    const preparedTurn = agentTerminalExecution.stage(
      args.owner,
      terminal.sessionId,
      profile,
      stagedPrepared,
      args.conversationId,
    );
    staged = true;
    const pending = agentTerminalManager.submit(
      args.owner,
      terminal.sessionId,
      preparedTurn.message,
      { onEvent: args.onEvent, ...(args.surface ? { surface: args.surface } : {}) },
    );
    args.onSubmitted?.();
    const result = await pending;
    const nativeCompletion = await agentTerminalExecution.completeStaged(
      terminal.sessionId,
      terminal.nativeSessionId,
      result,
    );
    staged = false;
    return {
      owner: args.owner,
      terminalSessionId: terminal.sessionId,
      nativeSessionId: terminal.nativeSessionId,
      storedSessionId: terminal.storedSessionId,
      profile: terminal.profile,
      nativeCompletion,
      text: result.text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'agent_terminal_turn_failed';
    if (staged && terminalSessionId) {
      const cancelledBeforeBegin = await agentTerminalExecution
        .cancelStaged(
          terminalSessionId,
          message,
          message === 'hermes_turn_cancelled' ? 'cancelled' : 'failed',
        )
        .catch(() => false);
      if (!cancelledBeforeBegin) {
        await agentTerminalExecution.abort(terminalSessionId, message).catch(() => undefined);
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
    throw error;
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
      if (status.runtimeKind === 'hermes' && status.runtimeMode === 'kanban') {
        return res.status(409).json({ ok: false, error: 'hermes_kanban_stop_requires_native_task_control' });
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
      const owner = await resolveCardRuntimeOwner(req, projectId, deckId, cardId);
      const terminal = agentTerminalManager.find(owner);
      if (!terminal || !agentTerminalExecution.ownsRun(terminal.sessionId, runId)) {
        return res.status(409).json({ ok: false, error: 'agent_terminal_run_not_active' });
      }
      agentTerminalManager.verifyConfiguration(owner, terminal.sessionId, card, deck);
      agentTerminalExecution.requestCancellation(terminal.sessionId, runId);
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
          runId, cardId, state: 'running', acceptedAt: new Date().toISOString(),
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
    let magenticStatus: MagenticExecutionStatus | null = null;
    const magenticAcceptance: { status: MagenticExecutionStatus | null } = { status: null };
    let magenticProgressBound = false;
    try {
      if (prepared.runtimeOwner === 'hermes') {
        const owner = await resolveCardRuntimeOwner(req, projectId, deckId, cardId);
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
        transport = {
          threadId: execution.nativeCompletion.nativeRootId,
          turnId: execution.nativeCompletion.nativeRunId,
          hermesSessionId: execution.nativeCompletion.hermesSessionId,
          effectiveProvider: execution.nativeCompletion.effectiveProvider,
          providerApiMode: execution.nativeCompletion.providerApiMode,
          terminalSessionId: execution.terminalSessionId,
          runtimeSource: 'repository_hermes_gateway',
        };
        providerInputTokens = execution.nativeCompletion.inputTokens;
        providerOutputTokens = execution.nativeCompletion.outputTokens;
        totalCostUsd = execution.nativeCompletion.costUsd;
      } else if (prepared.runtimeOwner === 'mag_one' && prepared.magenticExecution) {
        magenticStatus = await executePreparedMagenticRun({
          req,
          projectId,
          deckId,
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
            resolvedNativeReads: prepared.resolvedNativeReads,
            resolvedGraphProjection: prepared.resolvedGraphProjection,
            idf: prepared.idf,
            inputSummary: prepared.inputSummary,
            inputFile: prepared.inputFile,
            cardIdentity: prepared.cardIdentity,
          },
          output,
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

type NativeAttentionEvent = {
  eventId: string;
  timestamp: string;
  projectId: string | null;
  deckId: string | null;
  conversationId: string | null;
  runId: string | null;
  cardId: string | null;
  authority: 'codegraph' | 'knowgraph' | 'thinkgraph' | 'agentgraph';
  operation: 'read' | 'write';
  toolName: string;
  nativeNodeIds: string[];
  nativeEdgeIds: string[];
  nativeEdges: Array<{
    id: string;
    source: string;
    target: string;
    predicate: string | null;
    provenance?: Record<string, unknown>;
  }>;
  resultHash: string;
  truncated: boolean;
  phase?: 'pending' | 'completed' | 'failed';
  change?: 'read' | 'write' | 'create' | 'delete' | 'clear';
  nativeChildId?: string | null;
  nativeRunId?: string | null;
  rootRunId?: string | null;
  runState?: string;
  scopeGroupIds?: string[];
};

function nativeAttentionEvents(value: unknown): NativeAttentionEvent[] {
  if (!value || typeof value !== 'object') return [];
  const runs = Array.isArray((value as any).runs) ? (value as any).runs : [];
  return runs.flatMap((run: any) => Array.isArray(run?.attentionEvents)
    ? run.attentionEvents.map((event: any) => ({ ...event, runState: run.state,
      rootRunId: run.rootRunId || run.runId })) : [])
    .filter((event: any) => (
      event
      && typeof event === 'object'
      && String(event.eventId || '').trim()
      && ['codegraph', 'knowgraph', 'thinkgraph', 'agentgraph'].includes(event.authority)
      && ['read', 'write'].includes(event.operation)
    ))
    .map((event: any) => ({
      eventId: String(event.eventId),
      timestamp: String(event.timestamp || ''),
      projectId: event.projectId ? String(event.projectId) : null,
      deckId: event.deckId ? String(event.deckId) : null,
      conversationId: event.conversationId ? String(event.conversationId) : null,
      runId: event.runId ? String(event.runId) : null,
      cardId: event.cardId ? String(event.cardId) : null,
      authority: event.authority,
      operation: event.operation,
      toolName: String(event.toolName || ''),
      nativeNodeIds: Array.isArray(event.nativeNodeIds) ? event.nativeNodeIds.map(String).slice(0, 128) : [],
      nativeEdgeIds: Array.isArray(event.nativeEdgeIds) ? event.nativeEdgeIds.map(String).slice(0, 256) : [],
      nativeEdges: Array.isArray(event.nativeEdges) ? event.nativeEdges
        .filter((edge: any) => edge && typeof edge === 'object')
        .map((edge: any) => ({
          id: String(edge.id || ''),
          source: String(edge.source || ''),
          target: String(edge.target || ''),
          predicate: String(edge.predicate || '').trim() || null,
          ...(edge.provenance && typeof edge.provenance === 'object'
            ? { provenance: edge.provenance as Record<string, unknown> }
            : {}),
        }))
        .filter((edge: any) => edge.id && edge.source && edge.target)
        .slice(0, 256) : [],
      resultHash: String(event.resultHash || ''),
      truncated: event.truncated === true,
      ...(event.phase ? { phase: event.phase } : {}),
      ...(event.change ? { change: event.change } : {}),
      ...(event.nativeChildId ? { nativeChildId: String(event.nativeChildId) } : {}),
      ...(event.nativeRunId ? { nativeRunId: String(event.nativeRunId) } : {}),
      ...(event.rootRunId ? { rootRunId: String(event.rootRunId) } : {}),
      ...(event.runState ? { runState: String(event.runState) } : {}),
      ...(Array.isArray(event.scopeGroupIds) ? { scopeGroupIds: event.scopeGroupIds.map(String).slice(0, 128) } : {}),
    }));
}

function latestScopedNativeAttentionEvents(
  value: unknown,
  scope: { projectId: string; deckId: string; conversationId?: string; cardId?: string; runId?: string },
): NativeAttentionEvent[] {
  const scoped = nativeAttentionEvents(value)
    .filter((event) => event.projectId === scope.projectId && event.deckId === scope.deckId)
    .filter((event) => !scope.conversationId || event.conversationId === scope.conversationId)
    .filter((event) => !scope.cardId || event.cardId === scope.cardId)
    .filter((event) => !scope.runId || event.runId === scope.runId)
    .filter((event) => event.authority !== 'agentgraph')
    .filter((event) => event.runId && Number.isFinite(Date.parse(event.timestamp)))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const latestRunId = scoped.at(-1)?.runId;
  if (!latestRunId) return [];
  const seen = new Set<string>();
  return scoped.filter((event) => {
    if (event.runId !== latestRunId || seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  });
}

mainRoutes.get('/session/attention', async (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query?.conversationId || '').trim();
  const cardId = String(req.query?.cardId || '').trim();
  const runId = String(req.query?.runId || '').trim();
  const stream = req.query?.stream === 'true';
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  try {
    const readInspection = () => requestPythonRailsJson('/domain/agentgraph/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, limit: cardId ? 1 : 50,
        ...(conversationId ? { conversationId } : {}),
        ...(cardId ? { cardId, directOnly: true } : {}),
        ...(runId ? { runId } : {}),
      }),
    });
    const inspection = await readInspection();
    if (stream) {
      // Follow the existing AGE observation store using the same session and
      // native_attention SSE contracts as Main. No runtime or event bus is
      // started by this read-only subscription.
      res.writeHead(200, { 'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
        'X-Accel-Buffering': 'no' });
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let previous = new Map<string, string>();
      const emit = (kind: string, value: Record<string, unknown>, key: string,
        next: Map<string, string>) => {
        const body = JSON.stringify({ ...value, kind });
        next.set(key, body);
        if (body !== previous.get(key) && !closed) res.write(`event: ${kind}\ndata: ${body}\n\n`);
      };
      const deliver = (value: any) => {
        const next = new Map<string, string>();
        const runs = Array.isArray(value?.runs) ? value.runs : [];
        for (const run of runs) {
          emit('session', { projectId, deckId: run.deckId || deckId,
            conversationId: run.conversationId || null, cardId: run.cardId,
            runId: run.runId, rootRunId: run.rootRunId || run.runId,
            state: run.state, nativeChildId: run.nativeChildId || null,
            materializedNativeReferences: run.materializedNativeReferences || [] },
          `run:${run.runId}`, next);
        }
        if (cardId && !runs.length) emit('session', { projectId, deckId, cardId,
          runId: null, state: null, materializedNativeReferences: [] }, `card:${cardId}`, next);
        // AGE returns newest-first for bounded selection. Replay oldest-first
        // so a retained read cannot resurrect an acknowledged later deletion.
        for (const event of nativeAttentionEvents(value)
          .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))) {
          if (event.authority === 'agentgraph' || event.projectId !== projectId
            || event.deckId !== deckId || (cardId && event.cardId !== cardId)) continue;
          emit('native_attention', event, event.eventId, next);
        }
        previous = next;
      };
      const poll = async () => {
        try { deliver(await readInspection()); }
        catch (error) {
          if (!closed) {
            res.write(`event: error\ndata: ${JSON.stringify({ kind: 'error',
              error: error instanceof Error ? error.message : 'native_attention_read_failed' })}\n\n`);
            res.end();
          }
          return;
        }
        if (!closed) timer = setTimeout(poll, 2000);
      };
      res.on('close', () => { closed = true; if (timer) clearTimeout(timer); });
      deliver(inspection);
      res.write(': AGE attention connected\n\n');
      timer = setTimeout(poll, 2000);
      return;
    }
    return res.json({
      ok: true,
      events: latestScopedNativeAttentionEvents(inspection, {
        projectId,
        deckId,
        ...(conversationId ? { conversationId } : {}),
        ...(cardId ? { cardId } : {}),
        ...(runId ? { runId } : {}),
      }),
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'native_attention_read_failed',
    });
  }
});

async function resolveMainGatewayRuntime(
  req: Request,
  projectId: string,
  deckId: string,
) {
  const { deck } = await getDeckDocument(projectId, deckId);
  const cards = deck?.nodes.filter((card) => (
    card.runtime.kind === 'hermes' && card.runtime.mode === 'main'
  )) || [];
  if (!deck || cards.length !== 1) throw new Error('persisted_main_chat_mismatch');
  const card = cards[0];
  let resolved = agentTerminalManager.findCard(projectId, deckId, card.id);
  if (!resolved) {
    const owner = await resolveCardRuntimeOwner(req, projectId, deckId, card.id);
    const state = await agentTerminalManager.open(
      owner,
      card,
      deck,
      120,
      36,
      agentTerminalPresentationOptions(card, false),
    );
    resolved = { owner, state };
  }
  agentTerminalManager.verifyConfiguration(resolved.owner, resolved.state.sessionId, card, deck);
  return { ...resolved, card, deck };
}

mainRoutes.get('/session/driver', async (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  if (!await authorizeMainProject(req, res, projectId)) return undefined;
  try {
    const runtime = await resolveMainGatewayRuntime(req, projectId, deckId);
    const runId = agentTerminalExecution.activeRunId(runtime.state.sessionId);
    return res.json({
      ok: true,
      ready: true,
      activeDriver: runId ? 'internal_chat' : null,
      activeContextAuthorityMode: runId ? contextAuthorityModeForDriver('internal_chat') : null,
      runId,
      busy: runId !== null,
    });
  } catch (error) {
    return res.status(503).json({ ok: false,
      error: error instanceof Error ? error.message : 'main_gateway_runtime_unavailable' });
  }
});

mainRoutes.get('/session/events', async (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query?.conversationId || '').trim();
  const runtimeSessionId = String(req.query?.runtimeSessionId || '').trim();
  const nativeSessionId = String(req.query?.nativeSessionId || '').trim();
  if (!projectId || !conversationId || !runtimeSessionId || !nativeSessionId) {
    return res.status(400).json({ ok: false, error: 'main_native_event_scope_required' });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;

  let runtime: Awaited<ReturnType<typeof resolveMainGatewayRuntime>>;
  let detach = () => {};
  try {
    runtime = await resolveMainGatewayRuntime(req, projectId, deckId);
    if (runtime.state.sessionId !== runtimeSessionId) {
      return res.status(409).json({ ok: false, error: 'main_gateway_runtime_identity_mismatch' });
    }
    if (runtime.state.nativeSessionId !== nativeSessionId) {
      return res.status(409).json({ ok: false, error: 'main_gateway_native_session_identity_mismatch' });
    }
    detach = agentTerminalManager.subscribeGatewayEvents(
      runtime.owner,
      runtime.state.sessionId,
      (event) => {
        // Application-submitted Main turns already own their request SSE. This
        // stream projects only exact native turns initiated inside the canonical
        // Hermes session, such as Bot completion notifications.
        if (agentTerminalExecution.activeRunId(runtime.state.sessionId)) return;
        if (!['message.start', 'message.complete', 'status.update', 'error'].includes(event.type)) return;
        if (!Number.isSafeInteger(event.seq) || Number(event.seq) < 1) return;
        if (res.destroyed || res.writableEnded) return;
        res.write(`event: gateway\ndata: ${JSON.stringify({
          projectId,
          deckId,
          conversationId,
          cardId: runtime.card.id,
          runtimeSessionId: runtime.state.sessionId,
          nativeSessionId: runtime.state.nativeSessionId,
          event,
        })}\n\n`);
      },
    );
  } catch (error) {
    return res.status(503).json({ ok: false,
      error: error instanceof Error ? error.message : 'main_gateway_runtime_unavailable' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': native Main Gateway events\n\n');
  res.once('close', detach);
  return undefined;
});

mainRoutes.post('/session/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'default').trim();
  const message = String(req.body?.message || '');
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;

  const parsedAddress = leadingAddress(message);
  let authority: SharedChatAuthority;
  let existingMessages: ConversationMessage[];
  try {
    authority = await resolveSharedChatAuthority(projectId, deckId);
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
  try {
    existingMessages = await getConversationMessages(projectId, conversationId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'shared_conversation_unavailable';
    logHarnessTrace(`[shared-chat] history rejected reason=${redactTrace(reason)}`);
    return res.status(503).json({ ok: false, error: 'shared_conversation_unavailable' });
  }

  let target = authority.main;
  let directAddressed = false;
  if (parsedAddress.attempted) {
    if (!parsedAddress.address) {
      return res.status(400).json({ ok: false, error: 'addressed_card_name_required' });
    }
    const matches = authority.agents.filter((agent) => agent.aliases.includes(parsedAddress.address!));
    if (matches.length !== 1) {
      return res.status(409).json({
        ok: false,
        error: matches.length > 1 ? 'addressed_card_ambiguous' : 'addressed_card_unavailable',
        address: parsedAddress.address,
      });
    }
    target = matches[0];
    directAddressed = true;
  }

  const requestedRunId = `req_${randomUUID().slice(0, 8)}`;
  let run: PreparedMainCliRun;
  try {
    if (directAddressed) {
      const savedPreparation = await prepareSavedCardRun({
        projectId,
        deckId,
        cardId: target.cardId,
        cardRevisionId: target.cardRevisionId || undefined,
        assignment: message,
        senderCardId: authority.main.cardId,
        conversationId,
        correlationId: requestedRunId,
        dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
        images: Array.isArray(req.body?.images) ? req.body.images : [],
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
      run = await prepareMainCliRun({
        projectId,
        deckId,
        cardId: authority.main.cardId,
        conversationId,
        message,
        driverSource: 'internal_chat',
        runId: requestedRunId,
        dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
        sharedConversation: boundedSharedContext(existingMessages, authority.main),
      });
      if (run.cardId !== authority.main.cardId) {
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
      ...(directAddressed ? { address: parsedAddress.address } : {}),
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
  try {
    let resultText = '';
    let continuationRef = '';
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
        runId: run.runId,
        senderCardId: authority.main.cardId,
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
      const owner = await resolveCardRuntimeOwner(req, projectId, deckId, run.cardId);
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
            sessionId: terminal.nativeSessionId,
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
      continuationRef = result.nativeSessionId;
      usage = {
        providerInputTokens: result.nativeCompletion.inputTokens,
        providerOutputTokens: result.nativeCompletion.outputTokens,
        providerCachedTokens: result.nativeCompletion.cachedTokens,
        providerReasoningTokens: result.nativeCompletion.reasoningTokens,
        totalCostUsd: result.nativeCompletion.costUsd,
        usageAvailable: (result.nativeCompletion.inputTokens || 0) > 0
          || (result.nativeCompletion.outputTokens || 0) > 0,
        usageSource: 'native_gateway',
      };
    }
    if (!resultText.trim()) {
      throw new Error(directAddressed ? 'addressed_card_empty_response' : 'main_empty_response');
    }
    const seedMessages = existingMessages.length === 0
      ? await nativeMainHistorySeed(projectId, deckId, authority.main)
      : [];
    try {
      await appendSharedConversationTurn({
        projectId,
        conversationId,
        seedMessages,
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
  }
  return undefined;
});
mainRoutes.post('/session/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  const expectedCardId = String(req.body?.expectedCardId || '').trim();
  if (!projectId || !expectedRunId) {
    return res.status(400).json({ ok: false, error: 'projectId_and_expected_run_id_required' });
  }
  if (!await authorizeMainProject(req, res, projectId)) return undefined;
  try {
    const authority = await resolveSharedChatAuthority(projectId, deckId);
    const cardId = expectedCardId || authority.main.cardId;
    if (cardId !== authority.main.cardId && !authority.agents.some((agent) => agent.cardId === cardId)) {
      return res.status(403).json({ ok: false, error: 'shared_chat_card_not_authorized' });
    }
    const { deck } = await getDeckDocument(projectId, deckId);
    const configuredCard = deck?.nodes.find((candidate) => candidate.id === cardId);
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
    if (!agentTerminalExecution.ownsRun(runtime.state.sessionId, expectedRunId)) {
      return res.status(404).json({ ok: false, error: 'no_active_turn' });
    }
    agentTerminalExecution.requestCancellation(runtime.state.sessionId, expectedRunId);
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
  let history;
  let authority: SharedChatAuthority;
  let sharedMessages: ConversationMessage[];
  let nativeSessionId = '';
  let runtimeSessionId = '';
  try {
    authority = await resolveSharedChatAuthority(projectId, deckId);
    const runtime = await resolveMainGatewayRuntime(req, projectId, deckId);
    history = await agentTerminalManager.history(runtime.owner, runtime.state.sessionId);
    sharedMessages = await getConversationMessages(projectId, conversationId);
    nativeSessionId = runtime.state.nativeSessionId;
    runtimeSessionId = runtime.state.sessionId;
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
  return res.json({
    ok: true,
    sessionId: nativeSessionId,
    runtimeSessionId,
    mainCardId: authority.main.cardId,
    addressableAgents: authority.agents,
    messages: sharedMessages.length > 0
      ? sharedMessages
        .filter((message) => (
          (message.role === 'user' || message.role === 'assistant')
          && message.status === 'complete'
        ))
        .map((message) => sharedHistoryMessage(message, authority.main))
      : history.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role,
          text: String(message.text || ''),
          speaker: message.role === 'user' ? SHARED_CHAT_USER : cardParticipant(authority.main),
          ...(message.role === 'user' ? { target: cardParticipant(authority.main) } : {}),
        })),
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
