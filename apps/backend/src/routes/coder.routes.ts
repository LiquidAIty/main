import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  coderTerminalSessionManager,
  resolveHermesCliInstall,
  type HermesCoderTerminalSession,
} from '../hermes/coderTerminal';
import {
  deriveHermesSessionKey,
  readHermesHistory,
  startHermesTurn,
  type HermesSessionEvent,
  type HermesTurnArgs,
  type HermesTurnHandle,
} from '../hermes/mainAdapter';
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
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import {
  resolveHermesRuntimeHome,
} from '../hermes/profileMemory';
import {
  indexToolCatalogReferences,
  searchToolCatalogReferences,
  type ToolCatalogReference,
} from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';
import { resolveHermesExecutionContext } from '../hermes/childExecutionContext';

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
    const mainCardId = await resolveMainChatCardId(grant.projectId, BUILDER_DECK_ID);
    if (!mainCardId) {
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
        mainCardId,
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
};

function resolveHermesTurnArgs(
  args: PreparedHermesTransportArgs,
  transport: any,
): HermesTurnArgs {
  const identity = transport?.cardIdentity || {};
  const idf = transport?.idf;
  const runtime = idf?.runtime;
  const provider = idf?.provider;
  if (
    !idf || typeof idf !== 'object'
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
    prompt: String(idf.systemPrompt || ''),
    provider: String(provider?.provider || ''),
    modelKey: String(provider?.modelKey || ''),
    providerModelId: String(provider?.providerModelId || ''),
    accessMode: provider?.accessMode,
    tools: Array.isArray(idf.enabledTools) ? idf.enabledTools : [],
    nativeTools: Array.isArray(idf.nativeTools) ? idf.nativeTools : [],
    skills: Array.isArray(idf.skills) ? idf.skills : [],
    toolsets: Array.isArray(idf.toolsets) ? idf.toolsets : [],
    mcpConnectionIds: Array.isArray(idf.mcpConnectionIds) ? idf.mcpConnectionIds : [],
    sessionKey: deriveHermesSessionKey(
      args.projectId,
      args.conversationId,
      String(identity.cardId || ''),
    ),
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    parentRunId: args.parentRunId || args.conversationId,
    message: String(idf.message || ''),
    ...(args.workingDirectory ? { workingDirectory: args.workingDirectory } : {}),
  };
}

function resolvePreparedHermesTurnArgs(
  args: PreparedHermesTransportArgs,
): HermesTurnArgs {
  return resolveHermesTurnArgs(args, args.prepared?.hermesTransport);
}

function resolveHermesHistoryArgs(
  args: PreparedHermesTransportArgs,
): HermesTurnArgs {
  const preview = args.prepared || {};
  const identity = preview.cardIdentity || {};
  const profile = preview.sessionProfile || {};
  const runtime = profile.runtime;
  const provider = profile.provider || {};
  if (
    preview.runtimeOwner !== 'hermes'
    || runtime?.kind !== 'hermes'
    || runtime?.mode !== 'main'
    || !String(runtime?.profile || '').trim()
  ) throw new Error('prepared_hermes_history_invalid');
  return {
    cardId: String(identity.cardId || ''),
    title: String(identity.title || ''),
    runtime,
    prompt: String(profile.systemPrompt || ''),
    provider: String(provider.provider || ''),
    modelKey: String(provider.modelKey || ''),
    providerModelId: String(provider.providerModelId || ''),
    accessMode: provider.accessMode,
    tools: Array.isArray(profile.enabledTools) ? profile.enabledTools : [],
    nativeTools: Array.isArray(profile.nativeTools) ? profile.nativeTools : [],
    skills: Array.isArray(profile.skills) ? profile.skills : [],
    toolsets: Array.isArray(profile.toolsets) ? profile.toolsets : [],
    mcpConnectionIds: Array.isArray(profile.mcpConnectionIds) ? profile.mcpConnectionIds : [],
    sessionKey: deriveHermesSessionKey(args.projectId, args.conversationId, String(identity.cardId || '')),
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    parentRunId: args.parentRunId || args.conversationId,
    message: '',
    ...(args.workingDirectory ? { workingDirectory: args.workingDirectory } : {}),
  };
}

async function startPreparedHermesTransport(
  args: PreparedHermesTransportArgs,
): Promise<HermesTurnHandle> {
  const turnArgs = resolvePreparedHermesTurnArgs(args);
  return startHermesTurn(turnArgs, args.onEvent);
}

// Thin configured-Card transport. Python owns Card/AGE/IDD validation, the one
// transient IDF materializer, runtime-owner selection, and separate Run
// persistence. This route never rebuilds the model call.
router.post('/mcp-bridge/run_configured_card', async (req, res) => {
  const body = req.body || {};
  const action = body.action;
  if (action !== 'materialize' && action !== 'execute') {
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
  if (!projectId || !deckId || !cardId || !correlationId || !input) {
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
    contextMarkdown: typeof body.contextMarkdown === 'string' ? body.contextMarkdown : '',
    nativeReferences: Array.isArray(body.nativeReferences) ? body.nativeReferences : [],
    images: Array.isArray(body.images) ? body.images : [],
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    outputRequirements: typeof body.outputRequirements === 'string' ? body.outputRequirements : '',
  };

  try {
    if (action === 'materialize') {
      const preview = await requestPythonRailsJson('/domain/cards/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transientRequest),
      });
      return res.json({ ok: true, result: { status: 'previewed', invocation: preview } });
    }

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

    let hermesHandle: HermesTurnHandle | null = null;
    let clientDisconnected = false;
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
        body: JSON.stringify({ runId: correlationId, state, ...fields }),
      });
    };
    const cancelDisconnectedHermesTurn = (): void => {
      if (clientDisconnected || res.writableEnded) return;
      clientDisconnected = true;
      hermesHandle?.cancel();
      void finishRun('cancelled').catch((error) => {
        logHarnessTrace(
          `[harness] configured-card cancellation persistence failed corr=${correlationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
        );
      });
    };
    // A configured-card response has not written headers while Hermes is
    // running, so an aborted fetch is not guaranteed to emit `close` on the
    // ServerResponse immediately. The request socket is the authoritative
    // transport lifecycle in that interval. All three signals share the same
    // scoped, idempotent cancellation path and are removed before returning.
    req.once('aborted', cancelDisconnectedHermesTurn);
    req.socket.once('close', cancelDisconnectedHermesTurn);
    res.once('close', cancelDisconnectedHermesTurn);

    let output = '';
    let transport: Record<string, unknown> | null = null;
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
          parentRunId: correlationId,
          ...(cardId === CODER_CARD_ID ? { workingDirectory: resolveRepoRoot() } : {}),
          onEvent: () => undefined,
        });
        if (clientDisconnected) {
          hermesHandle.cancel();
          throw new Error('configured_card_request_cancelled');
        }
        const response = await hermesHandle.done;
        if (clientDisconnected) throw new Error('configured_card_request_cancelled');
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
        providerThreadRef: transport?.threadId || null,
        providerTurnRef: transport?.turnId || null,
        providerInputTokens,
        providerOutputTokens,
        totalCostUsd,
      }) as any;
      return res.json({
        ok: true,
        result: {
          status: 'completed',
          correlationId,
          cardId,
          runtimeOwner: prepared.runtimeOwner,
          cardRevisionId: prepared.cardRevisionId,
          invocation: {
            ephemeral: true,
            cardRevisionId: prepared.cardRevisionId,
            cardRevision: prepared.cardRevision,
            cardRevisionSha256: prepared.cardRevisionSha256,
            runtimeOwner: prepared.runtimeOwner,
            idf: prepared.idf,
            cardIdentity: prepared.cardIdentity,
          },
          output,
          transport,
          receipt: finished.receipt || null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
      await finishRun(clientDisconnected ? 'cancelled' : 'failed', {
        errorCode: 'configured_card_transport_failed',
        errorSummary: message,
      }).catch(() => undefined);
      throw error;
    } finally {
      req.off('aborted', cancelDisconnectedHermesTurn);
      req.socket.off('close', cancelDisconnectedHermesTurn);
      res.off('close', cancelDisconnectedHermesTurn);
    }
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
  }
});

// ── Persistent repo-owned Hermes Main bridge (BuilderChat -> ACP) ───────────
// One stable native Hermes conversation per saved Main card and product
// conversation. The saved Coder Card remains a separate Hermes profile.
const activeHermesTurns = new Map<string, HermesTurnHandle>();

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
      resultHash: String(event.resultHash || ''),
      truncated: event.truncated === true,
    }));
}

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
  if (prepared.runtimeOwner !== 'hermes' || !prepared.hermesTransport?.cardIdentity || !prepared.hermesTransport?.idf) {
    return res.status(424).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  }
  const mainCardId = String(prepared.hermesTransport.cardIdentity.cardId || '');
  const sessionId = deriveHermesSessionKey(projectId, conversationId, mainCardId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const writeSse = (eventName: string, payload: unknown): boolean => {
    if (res.destroyed || res.writableEnded) return false;
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logHarnessTrace(`[harness] sse write skipped corr=${correlationId} reason=${redactTrace(reason)}`);
      return false;
    }
  };
  writeSse('session', { sessionId });
  logHarnessTrace(`[hermes] request received ${`corr=${correlationId}`} project=${projectId} profile=${prepared.hermesTransport.idf.runtime.profile}`);
  let turnFinished = false;
  let runCancelled = false;
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
    activeHermesTurns.set(sessionId, handle);
    req.on('close', () => {
      if (turnFinished) return;
      runCancelled = true;
      handle.cancel();
      activeHermesTurns.delete(sessionId);
      void requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: correlationId, state: 'cancelled' }),
      }).catch((error) => {
        logHarnessTrace(
          `[harness] run cancellation persistence failed corr=${correlationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
        );
      });
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
          providerThreadRef: transport?.threadId || null,
          providerTurnRef: transport?.turnId || null,
          providerInputTokens: usage.providerInputTokens,
          providerOutputTokens: usage.providerOutputTokens,
          totalCostUsd: usage.totalCostUsd,
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
    if (!runCancelled) {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: correlationId,
          state: 'failed',
          errorCode,
          errorSummary: reason,
        }),
      }).catch((persistenceError) => {
        logHarnessTrace(
          `[harness] failure persistence failed corr=${correlationId} reason=${redactTrace(persistenceError instanceof Error ? persistenceError.message : String(persistenceError))}`,
        );
      });
    }
    logHarnessTrace(`[harness] request failed corr=${correlationId} reason=${redactTrace(reason)}`);
    writeSse('error', {
      code: errorCode,
      message: errorCode === 'harness_run_persistence_failed'
        ? 'The model finished, but its durable run record could not be completed.'
        : 'The chat run failed. Check the correlation ID in the backend logs.',
      correlationId,
      route: '/api/coder/main/session/chat',
      status: 502,
    });
  } finally {
    turnFinished = true;
    activeHermesTurns.delete(sessionId);
    writeSse('end', {});
    if (!res.destroyed && !res.writableEnded) res.end();
  }
  return undefined;
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
  const handle = activeHermesTurns.get(sessionId);
  if (!handle) return res.status(404).json({ ok: false, error: 'no_active_turn' });
  handle.answer(String(req.body?.promptId || ''), String(req.body?.reply || ''));
  return res.json({ ok: true });
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
    const preview = await requestPythonRailsJson('/domain/main/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        deckId,
        conversationId,
      }),
    }) as any;
    const turnArgs = resolveHermesHistoryArgs({
      prepared: preview,
      projectId,
      deckId,
      conversationId,
      parentRunId: `history:${conversationId}`,
      onEvent: () => undefined,
    });
    if (turnArgs.cardId !== 'card_main_chat' || turnArgs.runtime.mode !== 'main') {
      throw new Error('main_hermes_card_not_runnable');
    }
    const history = await readHermesHistory(turnArgs);
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

function startCoderTerminalSession(session: HermesCoderTerminalSession): void {
  const install = resolveHermesCliInstall();
  const hermesHome = resolveHermesRuntimeHome(install.root);
  const profile = session.info.profile || 'coder';
  session.start({
    executable: install.executable,
    args: [
      '-p', profile,
      'chat',
      '--cli',
      '--in', session.info.targetRoot,
    ],
    env: {
      ...withoutInternalMcpSecret(process.env),
      HERMES_HOME: hermesHome,
    },
    profile,
    hermesHome,
  });
}

// ── Repository Hermes control center ───────────────────────────────────────
// xterm forwards bytes to and from one real Hermes CLI ConPTY. Card/ACP model
// execution is separate and is never materialized or replayed into this shell.
function mountConsoleSessionRoutes(
  prefix: string,
  manager: typeof coderTerminalSessionManager,
): void {
  router.post(`${prefix}/sessions`, async (req, res) => {
    if (req.body?.mode && req.body.mode !== 'interactive') {
      return res.status(400).json({ ok: false, error: 'hermes_coder_terminal_interactive_only', missing: [] });
    }
    const started = manager.acquire({
      projectId: String(req.body?.projectId || '').trim(),
      deckId: String(req.body?.deckId || BUILDER_DECK_ID).trim(),
      conversationId: String(req.body?.conversationId || 'main').trim(),
      targetRoot: typeof req.body?.targetRoot === 'string' ? req.body.targetRoot : undefined,
      mode: 'interactive',
    });
    if (!started.ok) {
      return res.status(424).json({ ok: false, error: started.error, missing: started.missing });
    }
    const session = started.session;
    if (started.created) {
      try {
        startCoderTerminalSession(session);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'hermes_coder_terminal_prepare_failed';
        session.markFailed(reason);
      }
    }
    const failed = session.info.state === 'failed';
    return res.status(failed ? 502 : 200).json({
      ok: !failed,
      session: session.info,
      ...(failed ? { error: session.info.error || 'hermes_coder_terminal_prepare_failed', missing: [] } : {}),
    });
  });

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

  router.post(`${prefix}/sessions/:id/stop`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const stopped = session.stop();
    return res.json({ ok: true, stopped, session: session.info });
  });
}

mountConsoleSessionRoutes('/hermes/coder-terminal', coderTerminalSessionManager);


/** Resolve the saved Main Chat card from explicit runtime identity, never title. */
async function resolveMainChatCardId(projectId: string, deckId: string): Promise<string | null> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find(
    (node: any) =>
      node?.runtime?.kind === 'hermes' && node?.runtime?.mode === 'main',
  );
  return card ? String(card.id) : null;
}

export default router;
