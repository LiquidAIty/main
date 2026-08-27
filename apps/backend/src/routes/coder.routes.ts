import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  coderTerminalSessionManager,
} from '../hermes/coderTerminal';
import {
  answerHermesSession,
  cancelHermesRun,
  cancelHermesSession,
  deleteHermesHistory,
  deriveHermesSessionKey,
  dispatchHermesLearnCommand,
  readHermesHistory,
  readHermesRunSnapshot,
  startHermesTurn,
  type HermesHistoryArgs,
  type HermesSessionEvent,
  type HermesTurnArgs,
  type HermesTurnHandle,
} from '../hermes/mainAdapter';
import { buildCardTerminal, projectHermesEvent, projectKanbanTerminal, terminalHistoryEvents, terminalIdentity, terminalText } from '../hermes/cardTerminal';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import { listConversations } from '../conversations/store';
import { formatHarnessTrace, logHarnessTrace, redactTrace } from '../services/harnessTrace';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveExternalIdentityMainGrant } from '../auth/externalIdentityGrantStore';
import {
  describeConnectedAgents,
  dispatchConfiguredRuntime,
  requestPythonRailsJson,
} from '../services/autogen/pythonRailsClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import {
  indexToolCatalogReferences,
  searchToolCatalogReferences,
  type ToolCatalogReference,
} from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';
import { resolveHermesExecutionContext } from '../hermes/childExecutionContext';
import {
  reconcileTerminalKanbanRun,
  startKanbanRunMonitor,
} from '../hermes/kanbanRunRecovery';
import {
  readHermesKanbanSessionUsage,
  readHermesKanbanCardSnapshots,
  startNativeHermesKanbanTurn,
  type HermesKanbanProgress,
} from './hermesKanban.routes';

const router = Router();
const CODER_CARD_ID = 'card_local_coder';

router.get('/input-data-dictionary/card-editor', async (_req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const materialized = await requestPythonRailsJson('/idd/card-editor/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: listConfiguredModelOptions(openaiDefault) }),
    }) as Record<string, unknown>;
    if (
      !materialized?.dictionary
      || !Array.isArray(materialized.fields)
      || !materialized.catalogs
      || typeof materialized.catalogs !== 'object'
    ) {
      throw new Error('input_data_dictionary_card_editor_invalid');
    }
    return res.json({ ok: true, ...materialized });
  } catch {
    return res.status(503).json({
      ok: false,
      error: 'input_data_dictionary_card_editor_unavailable',
      fields: [],
      catalogs: { 'configured-models': [] },
    });
  }
});

router.get('/input-data-dictionary/tools', async (req, res) => {
  try {
    const canonicalMcpTools = await listPythonAgentMcpCatalog();
    const privateRuntimeManifest = await requestPythonRailsJson('/tools/manifest', {
      method: 'GET',
    }) as { tools?: unknown };
    if (!Array.isArray(privateRuntimeManifest?.tools)) {
      throw new Error('python_runtime_tool_manifest_invalid');
    }
    const materialized = await requestPythonRailsJson('/idd/tools/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [
          ...canonicalMcpTools,
          ...privateRuntimeManifest.tools,
        ],
      }),
    }) as { references?: unknown };
    if (!Array.isArray(materialized?.references)) {
      throw new Error('input_data_dictionary_tool_catalog_invalid');
    }
    const catalog = indexToolCatalogReferences(
      materialized.references as ToolCatalogReference[],
    );
    const selectedIds = Array.isArray(req.query.selectedIds)
      ? req.query.selectedIds.map(String)
      : typeof req.query.selectedIds === 'string'
        ? req.query.selectedIds.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    return res.json({
      ok: true,
      ...searchToolCatalogReferences(catalog, {
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        namespace: typeof req.query.namespace === 'string' ? req.query.namespace : undefined,
        access: req.query.access === 'read' || req.query.access === 'write'
          ? req.query.access
          : undefined,
        selectedIds,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      }),
    });
  } catch {
    return res.status(503).json({
      ok: false,
      error: 'input_data_dictionary_tool_catalog_unavailable',
      references: [],
      selectedKnownReferences: [],
      unresolvedSelectedIds: [],
      namespaces: [],
      total: 0,
      offset: 0,
      limit: 0,
      hasMore: false,
    });
  }
});

// ── Main MCP bridge (SDK-free) ─────────────────────────────────────────────
// Internal JSON endpoints that run the proven MCP handlers server-side, where
// the backend already owns deck state + the Python transport. These import NO
// MCP SDK, so they are safe in the Nx serve graph. The separate MCP host
// process bridges MCP tool/resource calls to these endpoints without owning
// another domain store.
router.post('/mcp-bridge/external_main_context', async (req, res) => {
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

router.post('/mcp-bridge/describe_connected_agents', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const result = await describeConnectedAgents({ projectId, deckId });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'describe_connected_agents_failed' });
  }
});

router.post('/mcp-bridge/internal_execution_context', (req, res) => {
  try {
    const context = resolveHermesExecutionContext({
      contextId: String(req.body?.contextId || ''),
      principal: req.body?.principal && typeof req.body.principal === 'object'
        ? req.body.principal
        : {},
    });
    return res.json({ ok: true, context });
  } catch (error) {
    return res.status(403).json({
      ok: false,
      error: error instanceof Error ? error.message : 'hermes_execution_context_rejected',
    });
  }
});

type PreparedHermesTransportArgs = {
  prepared: any;
  projectId: string;
  deckId: string;
  correlationId?: string;
  conversationId: string;
  parentRunId?: string;
  workingDirectory?: string;
  onEvent: (event: HermesSessionEvent) => void;
  onKanbanProgress?: (progress: HermesKanbanProgress) => Promise<void> | void;
};

function resolveHermesTurnArgs(
  args: PreparedHermesTransportArgs,
  transport: any,
): HermesTurnArgs {
  const identity = transport?.cardIdentity || {};
  const input = transport?.request;
  const runtime = input?.runtime;
  const provider = input?.provider;
  if (
    !input || typeof input !== 'object'
    || args.prepared?.runtimeOwner !== 'hermes'
    || runtime?.kind !== 'hermes'
    || !['main', 'delegate', 'kanban'].includes(runtime?.mode)
    || !String(runtime?.profile || '').trim()
  ) {
    throw new Error('prepared_hermes_transport_invalid');
  }
  return {
    cardId: String(identity.cardId || ''),
    title: String(identity.title || ''),
    runtime,
    prompt: String(input.systemPrompt || ''),
    provider: String(provider?.provider || ''),
    modelKey: String(provider?.modelKey || ''),
    providerModelId: String(provider?.providerModelId || ''),
    accessMode: provider?.accessMode,
    tools: Array.isArray(input.enabledTools) ? input.enabledTools : [],
    mcpConnectionIds: Array.isArray(input.mcpConnectionIds) ? input.mcpConnectionIds : [],
    sessionKey: deriveHermesSessionKey(
      args.projectId,
      args.conversationId,
      String(identity.cardId || ''),
    ),
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    parentRunId: args.parentRunId || args.conversationId,
    message: String(input.message || ''),
    ...(args.workingDirectory ? { workingDirectory: args.workingDirectory } : {}),
  };
}

function resolvePreparedHermesTurnArgs(
  args: PreparedHermesTransportArgs,
): HermesTurnArgs {
  return resolveHermesTurnArgs(args, args.prepared?.hermesTransport);
}

async function startPreparedHermesTransport(
  args: PreparedHermesTransportArgs,
): Promise<HermesTurnHandle> {
  const turnArgs = resolvePreparedHermesTurnArgs(args);
  const input = args.prepared?.hermesTransport?.request || {};
  const transientTask = String(input.task || '').trim();
  if (transientTask === '/learn' || transientTask.startsWith('/learn ')) {
    if (turnArgs.runtime.mode === 'kanban') throw new Error('hermes_learn_requires_acp_mode');
    const learnedPrompt = await dispatchHermesLearnCommand(
      turnArgs.runtime.profile,
      transientTask.slice('/learn'.length).trim(),
    );
    turnArgs.message = [String(input.graphContext || '').trim(), learnedPrompt]
      .filter(Boolean)
      .join('\n\n');
  }
  if (turnArgs.runtime.mode === 'kanban') {
    const mission = String(input.kanbanMission || '');
    if (!mission.trim()) throw new Error('prepared_hermes_kanban_mission_missing');
    return startNativeHermesKanbanTurn(
      { ...turnArgs, nativeMission: mission },
      args.onEvent,
      { onProgress: args.onKanbanProgress },
    );
  }
  return startHermesTurn(turnArgs, args.onEvent);
}

type ConfiguredCardRunStatus = {
  runId: string;
  correlationId: string;
  cardId: string;
  runtimeKind: string;
  runtimeMode: string;
  runtimeProfile: string;
  state: string;
  status: string;
  nativeRootId: string | null;
  nativeRunId: string | number | null;
  tasksCompleted: number;
  tasksTotal: number;
  activeWorkers: number;
  elapsedMs: number;
  toolCallCount: number;
  graphReads: number;
  graphWrites: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number;
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

async function readConfiguredCardRunStatus(args: {
  projectId: string;
  deckId: string;
  runId?: string;
  correlationId?: string;
  nativeRootId?: string;
  cardId?: string;
  reconcileTerminal?: boolean;
  includeTerminal?: boolean;
}): Promise<ConfiguredCardRunStatus | null> {
  const response = await requestPythonRailsJson('/domain/runs/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }) as any;
  const run = response?.run;
  if (!run || typeof run !== 'object') return null;
  const runId = String(run.runId || '').trim();
  const state = String(run.state || 'running');
  const nativeRootId = String(run.nativeRootId || '').trim();
  if (
    args.reconcileTerminal !== false
    && (state === 'failed' || state === 'cancelled')
    && nativeRootId
    && !String(run.result || '').trim()
    && String(run.runtimeKind || '') === 'hermes'
    && String(run.runtimeMode || '') === 'kanban'
  ) {
    reconcileTerminalKanbanRun({
      runId,
      projectId: String(run.projectId || ''),
      deckId: String(run.deckId || ''),
      cardId: String(run.cardId || ''),
      nativeRootId,
      runtimeProfile: String(run.runtimeProfile || ''),
    });
  }
  const inspection = await requestPythonRailsJson('/domain/agentgraph/inspect', {
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
  const nativeStatus = String(run.nativePhase || '').trim();
  const output = typeof run.result === 'string' && run.result.length > 0
    ? run.result
    : null;
  let terminal: ReturnType<typeof buildCardTerminal> | undefined;
  if (args.includeTerminal) {
    terminal = buildCardTerminal(run, run.runtimeKind === 'hermes'
      ? readHermesRunSnapshot(String(run.runtimeProfile || ''), runId) : null);
    if (run.runtimeKind === 'hermes' && run.runtimeMode === 'kanban' && nativeRootId) {
      try {
        terminal = projectKanbanTerminal(run, await readHermesKanbanCardSnapshots({
          nativeRootId, projectId: String(run.projectId), cardId: String(run.cardId),
        }));
      } catch (error) {
        terminal = { ...terminal, observation: 'unavailable',
          unavailableReason: terminalText(error instanceof Error ? error.message : 'kanban_observation_failed') };
      }
    }
  }
  return {
    runId,
    correlationId: String(run.correlationId || ''),
    cardId: String(run.cardId || ''),
    runtimeKind: String(run.runtimeKind || ''),
    runtimeMode: String(run.runtimeMode || ''),
    runtimeProfile: String(run.runtimeProfile || ''),
    state,
    status: nativeStatus || (state === 'completed'
      ? 'complete'
      : state === 'cancelled'
        ? 'cancelled'
        : state === 'failed'
          ? 'failed'
        : state === 'blocked'
          ? 'blocked'
          : state === 'pending'
            ? 'queued'
            : 'working'),
    nativeRootId: nativeRootId || null,
    nativeRunId: typeof run.nativeRunId === 'number' || typeof run.nativeRunId === 'string'
      ? run.nativeRunId
      : null,
    tasksCompleted: nonNegativeNumber(run.tasksCompleted),
    tasksTotal: nonNegativeNumber(run.tasksTotal),
    activeWorkers: nonNegativeNumber(run.activeWorkers),
    elapsedMs,
    toolCallCount: nonNegativeNumber(run.toolCallCount),
    graphReads,
    graphWrites,
    inputTokens: nonNegativeNumber(run.inputTokens),
    outputTokens: nonNegativeNumber(run.outputTokens),
    cachedTokens: nonNegativeNumber(run.cachedTokens),
    reasoningTokens: nonNegativeNumber(run.reasoningTokens),
    costUsd: nonNegativeNumber(run.costUsd),
    resultReady: output !== null,
    output,
    errorCode: String(run.errorCode || '').trim() || null,
    errorSummary: String(run.errorSummary || '').trim() || null,
    ...(terminal ? { terminal } : {}),
  };
}

// Thin configured-Card transport. Python owns Card/AGE/IDD validation, the one
// canonical IDF materializer, runtime-owner selection, and separate Run
// persistence. This route never rebuilds the model call.
router.post('/mcp-bridge/run_configured_card', async (req, res) => {
  const body = req.body || {};
  const action = body.action;
  if (
    action !== 'execute'
    && action !== 'status'
    && action !== 'inputs'
    && action !== 'stop'
    && action !== 'transcript'
    && action !== 'delete_transcript'
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
        reconcileTerminal: body.inspectOnly !== true,
        includeTerminal: body.includeTerminal === true,
      });
      return res.json({ ok: true, result: status });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : 'card_run_status_failed',
      });
    }
  }

  if (action === 'transcript' || action === 'delete_transcript') {
    const runId = String(body.runId || '').trim();
    if (!runId || !cardId) return res.status(400).json({ ok: false, error: 'card_transcript_identity_required' });
    try {
      const response = await requestPythonRailsJson('/domain/runs/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, runId, includeTerminal: true }),
      }) as any;
      const run = response?.run;
      if (!run) return res.status(404).json({ ok: false, error: 'card_run_not_found' });
      if (run.cardId !== cardId || run.runId !== runId || run.projectId !== projectId || run.deckId !== deckId) {
        return res.status(409).json({ ok: false, error: 'card_transcript_identity_mismatch' });
      }
      if (run.runtimeKind !== 'hermes' || !['main', 'delegate'].includes(run.runtimeMode)) {
        return res.status(409).json({ ok: false, error: 'card_transcript_specialized_or_unsupported_runtime' });
      }
      if (['pending', 'running'].includes(run.state)) {
        return res.status(409).json({ ok: false, error: 'card_transcript_run_active' });
      }
      const transcript = run.terminal?.transcript;
      if (!transcript?.sessionId || transcript.unavailableReason !== null) {
        return res.status(409).json({ ok: false, error: transcript?.unavailableReason || 'native_session_identity_unavailable' });
      }
      const args: HermesHistoryArgs = {
        sessionKey: '', profile: run.runtimeProfile, sessionId: transcript.sessionId, terminal: true,
      };
      if (action === 'delete_transcript') {
        // Native #2 deletes only this exclusive runtime transcript. No Run,
        // accepted result, saved Card, Deck or graph deletion is invoked.
        const deleted = await deleteHermesHistory(args);
        return res.json({ ok: true, result: { ...terminalIdentity(run), ...deleted } });
      }
      const history = await readHermesHistory(args);
      return res.json({ ok: true, result: { ...terminalIdentity(run), sessionId: history.sessionId,
        events: terminalHistoryEvents(run, history.events || []) } });
    } catch (error) {
      return res.status(502).json({ ok: false, error: 'card_transcript_failed',
        detail: terminalText(error instanceof Error ? error.message : String(error)) });
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
      if (status.runtimeKind === 'hermes' && status.runtimeMode === 'kanban') {
        return res.status(409).json({ ok: false, error: 'hermes_kanban_stop_requires_native_task_control' });
      }
      if (status.runtimeKind !== 'hermes') {
        return res.status(409).json({ ok: false, error: 'configured_card_stop_not_supported' });
      }
      cancelHermesRun(status.runtimeProfile, runId);
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
    const prepared = await requestPythonRailsJson('/domain/runs/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...transientRequest,
        cardRevisionId: cardRevisionId || undefined,
        runId: correlationId,
        correlationId,
      }),
    }) as any;

    const runId = String(prepared.runId || correlationId).trim();
    if (prepared.rejoined) {
      const status = await readConfiguredCardRunStatus({ projectId, deckId, runId });
      return res.json({ ok: true, result: status });
    }

    const runtimeMode = String(prepared?.hermesTransport?.request?.runtime?.mode || '').trim();
    if (prepared.runtimeOwner === 'hermes' && runtimeMode === 'kanban') {
      let latestProgress: HermesKanbanProgress | null = null;
      const persistProgress = async (progress: HermesKanbanProgress): Promise<void> => {
        latestProgress = progress;
        await requestPythonRailsJson('/domain/runs/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            nativeRootId: progress.nativeRootId,
            nativeRunId: progress.nativeRunId,
            nativePhase: progress.phase,
            tasksCompleted: progress.tasksCompleted,
            tasksTotal: progress.tasksTotal,
            activeWorkers: progress.activeWorkers,
          }),
        });
      };
      let hermesHandle: HermesTurnHandle;
      try {
        hermesHandle = await startPreparedHermesTransport({
          prepared,
          projectId,
          deckId,
          conversationId,
          parentRunId: runId,
          onEvent: () => undefined,
          onKanbanProgress: (progress) => persistProgress(progress).catch((error) => {
            logHarnessTrace(
              `[harness] configured-card progress persistence failed run=${runId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
            );
          }),
        });
        const nativeRootId = String(hermesHandle.runtime.sessionId || '').trim();
        if (!nativeRootId) throw new Error('hermes_kanban_card_task_id_missing');
        latestProgress = {
          nativeRootId,
          nativeRunId: null,
          phase: 'queued',
          tasksCompleted: 0,
          tasksTotal: 1,
          activeWorkers: 0,
          workerSessionIds: [],
        };
        await persistProgress(latestProgress);

        const monitor = async (): Promise<void> => {
          try {
            const response = await hermesHandle.done;
            const progress = latestProgress ?? {
              nativeRootId,
              nativeRunId: null,
              phase: 'complete' as const,
              tasksCompleted: 1,
              tasksTotal: 1,
              activeWorkers: 0,
              workerSessionIds: [],
            };
            let usage = {
              toolCallCount: 0,
              providerInputTokens: 0,
              providerOutputTokens: 0,
              providerCachedTokens: 0,
              providerReasoningTokens: 0,
              totalCostUsd: 0,
            };
            try {
              usage = await readHermesKanbanSessionUsage(
                String(prepared.hermesTransport.request.runtime.profile || ''),
                progress.workerSessionIds,
              );
            } catch (error) {
              logHarnessTrace(
                `[harness] configured-card usage read failed run=${runId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
              );
            }
            await requestPythonRailsJson('/domain/runs/finish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                runId,
                state: 'completed',
                providerThreadRef: nativeRootId,
                providerTurnRef: response.transport?.turnId || progress.nativeRunId,
                nativePhase: 'complete',
                tasksCompleted: Math.max(progress.tasksCompleted, progress.tasksTotal),
                tasksTotal: progress.tasksTotal,
                activeWorkers: 0,
                ...usage,
                finalResult: response.finalText,
              }),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
            const blocked = message === 'hermes_kanban_card_blocked';
            await requestPythonRailsJson('/domain/runs/finish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                runId,
                state: blocked ? 'blocked' : 'failed',
                providerThreadRef: nativeRootId,
                providerTurnRef: latestProgress?.nativeRunId || null,
                nativePhase: blocked ? 'blocked' : 'failed',
                tasksCompleted: latestProgress?.tasksCompleted || 0,
                tasksTotal: latestProgress?.tasksTotal || 1,
                activeWorkers: 0,
                errorCode: 'configured_card_transport_failed',
                errorSummary: message,
              }),
            }).catch(() => undefined);
          }
        };
        startKanbanRunMonitor(runId, monitor);
        return res.status(202).json({
          ok: true,
          result: {
            status: 'queued',
            state: 'running',
            runId,
            correlationId: String(prepared.correlationId || correlationId),
            cardId,
            runtimeOwner: prepared.runtimeOwner,
            cardRevisionId: prepared.cardRevisionId,
            nativeRootId,
            transport: {
              nativeTaskId: nativeRootId,
              planType: 'hermes-native-kanban',
            },
            resultReady: false,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
        await requestPythonRailsJson('/domain/runs/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            state: 'failed',
            nativePhase: 'failed',
            errorCode: 'configured_card_transport_failed',
            errorSummary: message,
          }),
        }).catch(() => undefined);
        throw error;
      }
    }

    let hermesHandle: HermesTurnHandle | null = null;
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
    const nativeEvents: HermesSessionEvent[] = [];
    let providerInputTokens: number | null = null;
    let providerOutputTokens: number | null = null;
    let totalCostUsd: number | null = null;
    try {
      if (prepared.runtimeOwner === 'hermes') {
        hermesHandle = await startPreparedHermesTransport({
          prepared,
          projectId,
          deckId,
          conversationId,
          parentRunId: runId,
          ...(cardId === CODER_CARD_ID ? { workingDirectory: resolveRepoRoot() } : {}),
          onEvent: (event) => {
            // Preserve real child tool effects for the parent/UI observer. Text,
            // reasoning, and memory remain inside the child Hermes session.
            if (event.kind === 'tool_start' || event.kind === 'tool_result') {
              nativeEvents.push(event);
            }
          },
        });
        const response = await hermesHandle.done;
        output = response.finalText;
        transport = response.transport;
        providerInputTokens = response.usage.providerInputTokens;
        providerOutputTokens = response.usage.providerOutputTokens;
        totalCostUsd = response.usage.totalCostUsd;
      } else if (prepared.nativeRuntimeRequest) {
        const response = await dispatchConfiguredRuntime(prepared.nativeRuntimeRequest);
        if (!response.ok) throw new Error(response.error || 'configured_runtime_failed');
        output = String(response.finalResponseText || '');
      } else {
        throw new Error(`configured_card_runtime_owner_unsupported:${String(prepared.runtimeOwner || '')}`);
      }
      const finished = await finishRun('completed', {
        providerThreadRef: hermesHandle?.runtime?.sessionId || transport?.threadId || null,
        providerTurnRef: transport?.turnId || null,
        providerInputTokens,
        providerOutputTokens,
        totalCostUsd,
        finalResult: output,
      }) as any;
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
          nativeEvents,
          receipt: finished.receipt || null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
      const cancelled = message === 'hermes_turn_cancelled';
      await finishRun(cancelled ? 'cancelled' : 'failed', {
        providerThreadRef: hermesHandle?.runtime?.sessionId || null,
        nativePhase: cancelled ? 'cancelled' : 'failed',
        errorCode: cancelled ? 'configured_card_run_stopped' : 'configured_card_transport_failed',
        errorSummary: message,
      }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
  }
});

// ── Persistent repo-owned Hermes Main bridge (BuilderChat -> ACP) ───────────
// One stable native Hermes conversation per saved Main card and product
// conversation. The saved Coder Card remains a separate Hermes profile.

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
};

function nativeAttentionEvents(value: unknown): NativeAttentionEvent[] {
  if (!value || typeof value !== 'object') return [];
  const runs = Array.isArray((value as any).runs) ? (value as any).runs : [];
  return runs.flatMap((run: any) => Array.isArray(run?.attentionEvents) ? run.attentionEvents : [])
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
    }));
}

function latestScopedNativeAttentionEvents(
  value: unknown,
  scope: { projectId: string; deckId: string; conversationId?: string },
): NativeAttentionEvent[] {
  const scoped = nativeAttentionEvents(value)
    .filter((event) => event.projectId === scope.projectId && event.deckId === scope.deckId)
    .filter((event) => !scope.conversationId || event.conversationId === scope.conversationId)
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

router.get('/main/session/attention', async (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query?.conversationId || '').trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  try {
    const inspection = await requestPythonRailsJson('/domain/agentgraph/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, limit: 50 }),
    });
    return res.json({
      ok: true,
      events: latestScopedNativeAttentionEvents(inspection, {
        projectId,
        deckId,
        ...(conversationId ? { conversationId } : {}),
      }),
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'native_attention_read_failed',
    });
  }
});

async function readPreparedMainSessionProfile(
  projectId: string,
  deckId: string,
): Promise<Record<string, any>> {
  const prepared = await requestPythonRailsJson('/domain/main/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      deckId,
    }),
  }) as any;
  if (prepared.runtimeOwner !== 'hermes' || !prepared.cardIdentity || !prepared.sessionProfile) {
    throw new Error('main_hermes_card_not_runnable');
  }
  return { ...prepared.sessionProfile, cardIdentity: prepared.cardIdentity };
}

router.post('/main/session/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '');
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'default');
  const message = String(req.body?.message || '');
  const workingDirectory = String(req.body?.workingDirectory || '').trim() || undefined;
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }
  // One correlation id per turn for the concise backend trace. This does NOT change
  // the SSE stream or browser behavior — it only makes the real Harness events
  // (already flowing to the browser) legible in the backend dev terminal.
  const correlationId = `req_${randomUUID().slice(0, 8)}`;
  let prepared: any;
  try {
    prepared = await requestPythonRailsJson('/domain/main/runs/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        deckId,
        message,
        conversationId,
        runId: correlationId,
        correlationId,
        dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
      }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'main_domain_preparation_failed';
    logHarnessTrace(
      `[harness] request rejected corr=${correlationId} reason=${redactTrace(reason)}`,
    );
    return res.status(503).json({
      ok: false,
      error: 'main_domain_preparation_failed',
      correlationId,
    });
  }
  if (prepared.runtimeOwner !== 'hermes' || !prepared.hermesTransport?.cardIdentity || !prepared.hermesTransport?.request) {
    return res.status(424).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  }
  const mainCardId = String(prepared.hermesTransport.cardIdentity.cardId || '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let eventSequence = 0;
  const eventIdentity = { projectId, deckId, cardId: mainCardId,
    cardName: String(prepared.hermesTransport.cardIdentity.title || ''), runId: correlationId,
    parentRunId: null, nativeChildId: null };
  const writeSse = (eventName: string, payload: unknown): boolean => {
    if (res.destroyed || res.writableEnded) return false;
    try {
      const sequence = ++eventSequence;
      const publicEvent = projectHermesEvent(eventIdentity, { ...(payload as object), kind: eventName },
        sequence, new Date().toISOString());
      res.write(`event: ${eventName}\ndata: ${JSON.stringify({ ...(payload as object),
        ...eventIdentity, ...(publicEvent ? { terminalEvent: publicEvent } : {}) })}\n\n`);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logHarnessTrace(`[harness] sse write skipped corr=${correlationId} reason=${redactTrace(reason)}`);
      return false;
    }
  };
  logHarnessTrace(`[hermes] request received ${`corr=${correlationId}`} project=${projectId} profile=${prepared.hermesTransport.request.runtime.profile}`);
  let turnFinished = false;
  let terminalDoneEvent: Extract<HermesSessionEvent, { kind: 'done' }> | null = null;
  const emittedAttentionIds = new Set<string>();
  let attentionReadQueue = Promise.resolve();
  const queueAttentionRead = (): Promise<void> => {
    attentionReadQueue = attentionReadQueue.then(async () => {
      const inspection = await requestPythonRailsJson('/domain/agentgraph/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, conversationId, runId: correlationId, limit: 1 }),
      });
      for (const attention of nativeAttentionEvents(inspection)) {
        if (attention.runId !== correlationId || emittedAttentionIds.has(attention.eventId)) continue;
        emittedAttentionIds.add(attention.eventId);
        writeSse('native_attention', { kind: 'native_attention', ...attention });
      }
    }).catch((error) => {
      logHarnessTrace(
        `[harness] native attention readback skipped corr=${correlationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
      );
    });
    return attentionReadQueue;
  };
  try {
    const handle = await startPreparedHermesTransport({
      prepared,
      projectId,
      deckId,
      conversationId,
      parentRunId: correlationId,
      workingDirectory,
      onEvent: async (event) => {
        if (turnFinished) return;
        if (event.kind === 'done') {
          terminalDoneEvent = event;
          return;
        }
        const scopedEvent = event.kind === 'tool_start' || event.kind === 'tool_result'
          ? { ...event, invokingCardId: mainCardId }
          : event;
        const traceLine = formatHarnessTrace(scopedEvent, correlationId);
        if (traceLine) logHarnessTrace(traceLine);
        writeSse(scopedEvent.kind, scopedEvent);
        if (scopedEvent.kind === 'tool_result' && !scopedEvent.isError) {
          void queueAttentionRead();
        }
      },
    });
    // Announce an active stream only after the native Hermes adapter has
    // returned a real turn handle. Before this event the browser renders
    // Connecting, never Working.
    writeSse('session', {
      sessionId: handle.runtime?.sessionId || null,
      runId: correlationId,
      projectId,
      deckId,
      conversationId,
      cardId: mainCardId,
      configuration: {
        provider: prepared.hermesTransport.request.provider?.provider || null,
        model: prepared.hermesTransport.request.provider?.providerModelId || null,
        profile: prepared.hermesTransport.request.runtime.profile,
        grantedTools: prepared.hermesTransport.request.enabledTools || [],
        loadedSkills: null,
      },
    });
    const { finalText, usage, transport } = await handle.done;
    await attentionReadQueue;
    try {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: correlationId,
          state: 'completed',
          providerThreadRef: handle.runtime?.sessionId || transport?.threadId || null,
          providerTurnRef: transport?.turnId || null,
          providerInputTokens: usage.providerInputTokens,
          providerOutputTokens: usage.providerOutputTokens,
          totalCostUsd: usage.totalCostUsd,
          finalResult: finalText,
        }),
      });
    } catch (error) {
      throw new Error(
        `harness_run_persistence_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const doneEvent = terminalDoneEvent || { kind: 'done', fullText: finalText, usage };
    const doneTrace = formatHarnessTrace(doneEvent, correlationId);
    if (doneTrace) logHarnessTrace(doneTrace);
    writeSse('done', doneEvent);
    turnFinished = true;
    logHarnessTrace(
      `[harness] request completed corr=${correlationId} providerUsage=${usage.usageAvailable ? `${usage.providerInputTokens}in/${usage.providerOutputTokens}out (${usage.usageSource})` : 'unavailable'} cost=${usage.totalCostUsd ?? 'unavailable'} contextBreakdown=${usage.contextBreakdownJson ? 'present' : 'unavailable'}`,
    );
  } catch (error) {
    turnFinished = true;
    const reason = error instanceof Error ? error.message : 'hermes_turn_failed';
    const errorCode = reason.startsWith('harness_run_persistence_failed')
      ? 'harness_run_persistence_failed'
      : 'harness_turn_failed';
    const runCancelled = reason === 'hermes_turn_cancelled';
    await requestPythonRailsJson('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: correlationId,
        state: runCancelled ? 'cancelled' : 'failed',
        nativePhase: runCancelled ? 'cancelled' : 'failed',
        errorCode: runCancelled ? 'main_run_stopped' : errorCode,
        errorSummary: reason,
      }),
    }).catch((persistenceError) => {
      logHarnessTrace(
        `[harness] failure persistence failed corr=${correlationId} reason=${redactTrace(persistenceError instanceof Error ? persistenceError.message : String(persistenceError))}`,
      );
    });
    logHarnessTrace(`[harness] request failed corr=${correlationId} reason=${redactTrace(reason)}`);
    writeSse('error', {
      code: runCancelled ? 'harness_turn_cancelled' : errorCode,
      message: runCancelled
        ? 'The chat run was stopped.'
        : errorCode === 'harness_run_persistence_failed'
        ? 'The model finished, but its durable run record could not be completed.'
        : 'The chat run failed. Check the correlation ID in the backend logs.',
      correlationId,
      route: '/api/coder/main/session/chat',
      status: 502,
    });
  } finally {
    turnFinished = true;
    writeSse('end', {});
    if (!res.destroyed && !res.writableEnded) res.end();
  }
  return undefined;
});

router.post('/main/session/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'default');
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  let runtimeConfig: Record<string, any>;
  try {
    runtimeConfig = await readPreparedMainSessionProfile(projectId, deckId);
  } catch {
    return res.status(404).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  }
  const sessionId = deriveHermesSessionKey(
    projectId,
    conversationId,
    runtimeConfig.cardIdentity.cardId,
  );
  try {
    const runId = cancelHermesSession(runtimeConfig.runtime.profile, sessionId);
    return res.status(202).json({ ok: true, runId, state: 'stopping' });
  } catch (error) {
    if (error instanceof Error && error.message === 'hermes_session_turn_not_running') {
      return res.status(404).json({ ok: false, error: 'no_active_turn' });
    }
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_run_stop_failed',
    });
  }
});

router.post('/main/session/answer', async (req, res) => {
  const projectId = String(req.body?.projectId || '');
  const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
  let runtimeConfig: Record<string, any>;
  try {
    runtimeConfig = await readPreparedMainSessionProfile(projectId, deckId);
  } catch {
    return res.status(404).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  }
  const sessionId = deriveHermesSessionKey(
    projectId,
    String(req.body?.conversationId || 'default'),
    runtimeConfig.cardIdentity.cardId,
  );
  try {
    answerHermesSession(
      runtimeConfig.runtime.profile,
      sessionId,
      String(req.body?.promptId || ''),
      String(req.body?.reply || ''),
    );
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'hermes_session_turn_not_running') {
      return res.status(404).json({ ok: false, error: 'no_active_turn' });
    }
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_permission_answer_failed',
    });
  }
});

// Load the durable project-scoped transcript for a conversation so a reload
// restores the same chat. A valid conversation with no messages returns an
// empty transcript. A persistence failure remains a visible typed failure.
router.get('/main/session/history', async (req, res) => {
  const projectId = String(req.query?.projectId || '');
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query?.conversationId || 'default');
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId_required', messages: [] });
  }
  try {
    const mainIdentity = await resolveMainChatHermesIdentity(projectId, deckId);
    if (!mainIdentity) throw new Error('main_hermes_card_not_runnable');
    const historyArgs: HermesHistoryArgs = {
      sessionKey: deriveHermesSessionKey(projectId, conversationId, mainIdentity.cardId),
      profile: mainIdentity.profile,
    };
    const history = await readHermesHistory(historyArgs);
    return res.json({ ok: true, sessionId: history.sessionId, messages: history.messages });
  } catch (error) {
    logHarnessTrace(
      `[harness] history read failed project=${projectId} conversation=${conversationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
    );
    return res.status(500).json({
      ok: false,
      error: 'conversation_history_read_failed',
      messages: [],
    });
  }
});

router.delete('/main/session/history', async (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const deckId = String(req.query?.deckId || BUILDER_DECK_ID).trim();
  const conversationId = String(req.query?.conversationId || '').trim();
  if (!projectId || !conversationId) {
    return res.status(400).json({
      ok: false,
      error: 'projectId_and_conversationId_required',
    });
  }
  try {
    const mainIdentity = await resolveMainChatHermesIdentity(projectId, deckId);
    if (!mainIdentity) throw new Error('main_hermes_card_not_runnable');
    const result = await deleteHermesHistory({
      sessionKey: deriveHermesSessionKey(projectId, conversationId, mainIdentity.cardId),
      profile: mainIdentity.profile,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'conversation_history_delete_failed';
    return res.status(code === 'hermes_session_turn_already_running' ? 409 : 500).json({
      ok: false,
      error: code,
    });
  }
});

router.get('/main/session/conversations', async (req, res) => {
  const projectId = String(req.query?.projectId || '');
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId_required', conversations: [] });
  }
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

// ── Repository Hermes control center ───────────────────────────────────────
// xterm forwards bytes to and from the startup-owned Hermes Coder ConPTY.
// Opening or closing the dock never owns this process lifecycle.
function mountConsoleSessionRoutes(
  prefix: string,
  manager: typeof coderTerminalSessionManager,
): void {
  router.get(`${prefix}/sessions`, (_req, res) => {
    return res.json({ ok: true, sessions: manager.list() });
  });

  router.get(`${prefix}/sessions/:id`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    return res.json({ ok: true, session: session.info });
  });

  router.get(`${prefix}/sessions/:id/pty`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    if (!session.isLive()) {
      return res.status(409).json({ ok: false, error: 'hermes_coder_terminal_not_running' });
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const unsubscribeOutput = session.subscribeOutput((data) => {
      if (!res.destroyed && !res.writableEnded) res.write(data);
    });
    const unsubscribeLifecycle = session.subscribeLifecycle((info) => {
      if (['stopped', 'failed'].includes(info.state) && !res.writableEnded) {
        res.end();
      }
    });
    if (!session.isLive() && !res.writableEnded) res.end();
    const detach = () => {
      unsubscribeOutput();
      unsubscribeLifecycle();
    };
    res.once('close', detach);
    req.once('aborted', () => {
      detach();
      if (!res.writableEnded) res.end();
    });
    return undefined;
  });

  router.post(`${prefix}/sessions/:id/input`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    if (!data || data.length > 65_536) {
      return res.status(400).json({ ok: false, error: 'coder_terminal_data_required' });
    }
    const delivered = session.write(data);
    return res.status(delivered ? 200 : 409).json({
      ok: delivered,
      delivered,
      ...(delivered ? {} : { error: 'hermes_coder_terminal_not_running' }),
    });
  });

  router.post(`${prefix}/sessions/:id/resize`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const resized = session.resize(Number(req.body?.cols), Number(req.body?.rows));
    return res.status(resized ? 200 : 409).json({
      ok: resized,
      resized,
      ...(resized ? {} : { error: 'hermes_coder_terminal_resize_rejected' }),
    });
  });

}

mountConsoleSessionRoutes('/hermes/coder-terminal', coderTerminalSessionManager);


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
