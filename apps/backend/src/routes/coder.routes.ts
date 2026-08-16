import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';
import { localCoderService } from '../coder/localcoder/service';
import {
  hermesConsoleSessionManager,
  openClaudeConsoleSessionManager,
  type ConsoleMode,
} from '../coder/openclaude/console/consoleSession';
import { describeConnectedAgents } from '../coder/openclaude/mcp/mainAgentFlow';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import {
  deriveHermesSessionKey,
  requestHermesCodexAccount,
  startHermesTurn,
  type HermesSessionEvent,
  type HermesTurnHandle,
} from '../hermes/mainAdapter';
import {
  getConversationMessages,
  listConversations,
} from '../conversations/store';
import { formatHarnessTrace, logHarnessTrace, redactTrace } from '../services/harnessTrace';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveExternalIdentityMainGrant } from '../auth/externalIdentityGrantStore';
import {
  requestPythonRailsJson,
  runSingleCardWithAutoGen,
} from '../services/autogen/autogenOrchestratorClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import {
  indexToolCatalogReferences,
  searchToolCatalogReferences,
  type ToolCatalogReference,
} from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';

const router = Router();

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
// MCP SDK (mainAgentFlow.ts is SDK-free), so they are safe in the Nx serve
// graph. The separate MCP host process (which DOES use the SDK) bridges MCP tool
// / resource calls to these endpoints — single authority, no duplicated state.
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

router.post('/mcp-bridge/coder_status', async (_req, res) => {
  const sessions = openClaudeConsoleSessionManager.list();
  const liveSessions = sessions.filter(
    (session) => session.state === 'starting' || session.state === 'running',
  );
  return res.json({
    ok: true,
    state: liveSessions.length > 0 ? 'running' : 'idle',
    running: liveSessions.length > 0,
    liveSessions,
    recentSessions: sessions.slice(-10),
    authority: 'openclaude_console_session_manager',
  });
});

async function resolveCodingCard(projectId: string, deckId: string, cardId: string): Promise<any> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find((node: any) => String(node?.id || '') === cardId);
  if (!card) throw new Error(`coder_card_not_found:${cardId}`);
  const system = card.runtimeType === 'assistant_agent' && card.runtimeBinding === 'local_coder';
  if (!system) throw new Error(`coder_card_runtime_unsupported:${cardId}`);
  return card;
}

router.post('/mcp-bridge/coder_stop', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const cardId = String(req.body?.cardId || '').trim();
    await resolveCodingCard(projectId, deckId, cardId);
    const session = openClaudeConsoleSessionManager.findRunningForCard(cardId);
    if (!session) return res.status(409).json({ ok: false, error: 'openclaude_card_no_active_session' });
    const stopped = session.stop();
    return res.status(stopped ? 200 : 409).json({ ok: stopped, cardId, session: session.info });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/mcp-bridge/coder_steer', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const cardId = String(req.body?.cardId || '').trim();
    const input = String(req.body?.input || '').trim();
    if (!input) return res.status(400).json({ ok: false, error: 'steer_input_required' });
    await resolveCodingCard(projectId, deckId, cardId);
    const session = openClaudeConsoleSessionManager.findRunningForCard(cardId);
    if (!session) return res.status(409).json({ ok: false, error: 'openclaude_card_no_active_session' });
    if (!session.info.interactiveSupported || session.info.transportMode !== 'pty') {
      return res.status(409).json({ ok: false, error: 'openclaude_card_steer_unsupported_noninteractive' });
    }
    const delivered = session.submitLine(input);
    return res.status(delivered ? 200 : 409).json({ ok: delivered, cardId, session: session.info });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

async function startPreparedHermesTransport(args: {
  prepared: any;
  projectId: string;
  deckId: string;
  conversationId: string;
  parentRunId?: string;
  workingDirectory?: string;
  onEvent: (event: HermesSessionEvent) => void;
}): Promise<HermesTurnHandle> {
  const transport = args.prepared?.hermesTransport;
  const context = transport?.cardContext || {};
  const profile = String(transport?.profile || '').trim();
  if (args.prepared?.runtimeOwner !== 'hermes' || !profile) {
    throw new Error('prepared_hermes_transport_invalid');
  }
  return startHermesTurn({
    cardId: String(context.cardId || ''),
    title: String(context.title || ''),
    runtimeBinding: String(context.runtimeBinding || ''),
    prompt: String(transport.systemPrompt || ''),
    profile,
    provider: String(context.provider || ''),
    modelKey: String(context.modelKey || ''),
    providerModelId: String(context.providerModelId || ''),
    accessMode: context.accessMode,
    executionMode: context.executionMode === 'auto-kanban' ? 'auto-kanban' : 'single',
    tools: Array.isArray(context.tools) ? context.tools : [],
    nativeTools: Array.isArray(context.nativeTools) ? context.nativeTools : [],
    skills: Array.isArray(context.skills) ? context.skills : [],
    toolsets: Array.isArray(context.toolsets) ? context.toolsets : [],
    mcpConnectionIds: Array.isArray(context.mcpConnectionIds) ? context.mcpConnectionIds : [],
    coderCardIds: Array.isArray(context.coderCardIds) ? context.coderCardIds : [],
    directSubagents: Array.isArray(context.directSubagents) ? context.directSubagents : [],
    savedCardRuntime: context.savedCardRuntime || {
      provider: String(context.provider || ''),
      modelKey: String(context.modelKey || ''),
      providerModelId: String(context.providerModelId || ''),
    },
    profileSnapshot: context.profileSnapshot || null,
    profileConflicts: Array.isArray(context.profileConflicts) ? context.profileConflicts : [],
    profileConflictResolution: context.profileConflictResolution === 'card' ? 'card' : 'hermes',
    sessionKey: deriveHermesSessionKey(
      args.projectId,
      args.conversationId,
      String(context.cardId || ''),
    ),
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    parentRunId: args.parentRunId || args.conversationId,
    message: String(transport.message || ''),
    ...(args.workingDirectory ? { workingDirectory: args.workingDirectory } : {}),
  }, args.onEvent);
}

// Thin configured-Card transport. Python owns Card/AGE/IDD validation,
// transient IDF materialization, runtime-owner selection, and prompt-free run
// persistence. This route only forwards preview data or moves the accepted
// bytes through the already-canonical Hermes ACP / Python AutoGen transports.
router.post('/mcp-bridge/run_configured_card', async (req, res) => {
  const body = req.body || {};
  const action = body.action === 'materialize' || body.action === 'preview' ? 'preview' : 'execute';
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
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    outputRequirements: typeof body.outputRequirements === 'string' ? body.outputRequirements : '',
  };

  try {
    if (action === 'preview') {
      const preview = await requestPythonRailsJson('/domain/cards/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transientRequest),
      });
      return res.json({ ok: true, result: { status: 'previewed', invocation: preview } });
    }

    const exactIdf = String(body.exactIdf || '').trim();
    const cardRevisionId = String(body.cardRevisionId || '').trim();
    if (!exactIdf || !cardRevisionId) {
      return res.status(400).json({ ok: false, error: 'exact_inspector_invocation_required' });
    }
    const prepared = await requestPythonRailsJson('/domain/runs/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...transientRequest,
        exactIdf,
        cardRevisionId,
        runId: correlationId,
        correlationId,
      }),
    }) as any;

    let output = '';
    let transport: Record<string, unknown> | null = null;
    try {
      if (prepared.runtimeOwner === 'hermes') {
        const handle = await startPreparedHermesTransport({
          prepared,
          projectId,
          deckId,
          conversationId,
          parentRunId: originatingRunId,
          onEvent: () => undefined,
        });
        const response = await handle.done;
        output = response.finalText;
        transport = response.transport;
      } else if (
        prepared.runtimeOwner === 'autogen'
        || prepared.runtimeOwner === 'coder'
        || prepared.runtimeOwner === 'mag_one'
      ) {
        if (!prepared.nativeRuntimeRequest) throw new Error('native_runtime_request_missing');
        const response = await runSingleCardWithAutoGen(prepared.nativeRuntimeRequest);
        if (!response.ok) throw new Error(response.error || 'single_card_run_failed');
        output = String(response.finalResponseText || '');
      } else {
        throw new Error(`configured_card_runtime_owner_unsupported:${String(prepared.runtimeOwner || '')}`);
      }
      const finished = await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: correlationId,
          state: 'completed',
          providerThreadRef: transport?.threadId || null,
          providerTurnRef: transport?.turnId || null,
        }),
      }) as any;
      return res.json({
        ok: true,
        result: {
          status: 'completed',
          correlationId,
          cardId,
          runtimeOwner: prepared.runtimeOwner,
          cardRevisionId: prepared.cardRevisionId,
          output,
          transport,
          receipt: finished.receipt || null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'configured_card_transport_failed';
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: correlationId,
          state: 'failed',
          errorCode: 'configured_card_transport_failed',
          errorSummary: message,
        }),
      }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
  }
});

// ── Persistent repo-owned Hermes Main bridge (BuilderChat -> ACP) ───────────
// One stable native Hermes conversation per saved Main card and product
// conversation. OpenClaude remains the separate Coder/terminal runtime.
const activeHermesTurns = new Map<string, HermesTurnHandle>();

function codexTransportResult(value: Record<string, unknown>): Record<string, any> {
  const result = value.result;
  return result && typeof result === 'object' ? result as Record<string, any> : {};
}

async function readPreparedMainCardContext(
  projectId: string,
  deckId: string,
): Promise<Record<string, any>> {
  const prepared = await requestPythonRailsJson('/domain/main/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      deckId,
      assignment: 'Inspect the saved Main runtime configuration without executing a model.',
    }),
  }) as any;
  if (prepared.runtimeOwner !== 'hermes' || !prepared.cardContext) {
    throw new Error('main_hermes_card_not_runnable');
  }
  return prepared.cardContext;
}

router.get('/main/codex-account', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '').trim();
    if (!projectId) {
      return res.status(400).json({ ok: false, error: 'projectId_required' });
    }
    const deckId = String(req.query.deckId || BUILDER_DECK_ID).trim();
    const runtimeConfig = await readPreparedMainCardContext(projectId, deckId);
    if (runtimeConfig.accessMode !== 'chatgpt-account') {
      return res.json({
        ok: true,
        accessMode: runtimeConfig.accessMode,
        account: null,
        rateLimits: null,
        notifications: [],
      });
    }
    const accountEnvelope = await requestHermesCodexAccount(
      runtimeConfig.profile,
      'account/read',
      { refreshToken: false },
    );
    const accountResponse = codexTransportResult(accountEnvelope);
    const account = accountResponse.account && typeof accountResponse.account === 'object'
      ? accountResponse.account as Record<string, unknown>
      : null;
    if (account && account.type !== 'chatgpt') {
      return res.status(409).json({ ok: false, error: 'codex_chatgpt_account_required' });
    }
    const rateEnvelope = account
      ? await requestHermesCodexAccount(runtimeConfig.profile, 'account/rateLimits/read')
      : null;
    return res.json({
      ok: true,
      accessMode: runtimeConfig.accessMode,
      account,
      requiresOpenaiAuth: Boolean(accountResponse.requiresOpenaiAuth),
      rateLimits: rateEnvelope ? codexTransportResult(rateEnvelope) : null,
      notifications: [
        ...(Array.isArray(accountEnvelope.notifications) ? accountEnvelope.notifications : []),
        ...(Array.isArray(rateEnvelope?.notifications) ? rateEnvelope.notifications : []),
      ],
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'codex_account_read_failed',
    });
  }
});

router.post('/main/codex-account', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const action = String(req.body?.action || '').trim();
    if (!projectId || !['login', 'logout'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'projectId_and_valid_action_required' });
    }
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID).trim();
    const runtimeConfig = await readPreparedMainCardContext(projectId, deckId);
    if (runtimeConfig.accessMode !== 'chatgpt-account') {
      return res.status(409).json({ ok: false, error: 'main_chatgpt_account_mode_required' });
    }
    if (action === 'logout') {
      const envelope = await requestHermesCodexAccount(runtimeConfig.profile, 'account/logout');
      return res.json({ ok: true, action, ...codexTransportResult(envelope) });
    }

    const currentEnvelope = await requestHermesCodexAccount(runtimeConfig.profile, 'account/read');
    const current = codexTransportResult(currentEnvelope);
    if (current.account?.type === 'chatgpt') {
      return res.json({ ok: true, action, alreadyAuthenticated: true, account: current.account });
    }
    const loginType = String(req.body?.loginType || 'chatgpt').trim();
    if (!['chatgpt', 'chatgptDeviceCode'].includes(loginType)) {
      return res.status(400).json({ ok: false, error: 'codex_login_type_not_allowed' });
    }
    const envelope = await requestHermesCodexAccount(
      runtimeConfig.profile,
      'account/login/start',
      { type: loginType },
    );
    return res.json({
      ok: true,
      action,
      ...codexTransportResult(envelope),
      notifications: Array.isArray(envelope.notifications) ? envelope.notifications : [],
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'codex_account_action_failed',
    });
  }
});

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
    const preview = await requestPythonRailsJson('/domain/main/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        deckId,
        assignment: message,
        conversationId,
      }),
    }) as any;
    prepared = await requestPythonRailsJson('/domain/runs/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        deckId,
        cardId: preview.cardContext?.cardId,
        assignment: message,
        conversationId,
        exactIdf: preview.exactIdf,
        cardRevisionId: preview.cardRevisionId,
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
  if (prepared.runtimeOwner !== 'hermes' || !prepared.hermesTransport?.cardContext) {
    return res.status(424).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  }
  const mainCardId = String(prepared.hermesTransport.cardContext.cardId || '');
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
  logHarnessTrace(`[hermes] request received ${`corr=${correlationId}`} project=${projectId} profile=${prepared.hermesTransport.profile}`);
  let turnFinished = false;
  let runCancelled = false;
  let terminalDoneEvent: Extract<HermesSessionEvent, { kind: 'done' }> | null = null;
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
        const traceLine = formatHarnessTrace(event, correlationId);
        if (traceLine) logHarnessTrace(traceLine);
        writeSse(event.kind, event);
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
    if (!runCancelled) {
      await requestPythonRailsJson('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: correlationId,
          state: 'failed',
          errorCode: reason.startsWith('harness_run_persistence_failed')
            ? 'harness_run_persistence_failed'
            : 'harness_turn_failed',
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
      code: reason.startsWith('harness_run_persistence_failed')
        ? 'harness_run_persistence_failed'
        : 'harness_turn_failed',
      message: reason.startsWith('harness_run_persistence_failed')
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
    runtimeConfig = await readPreparedMainCardContext(projectId, deckId);
  } catch {
    return res.status(404).json({ ok: false, error: 'main_hermes_card_not_runnable' });
  }
  const sessionId = deriveHermesSessionKey(
    projectId,
    String(req.body?.conversationId || 'default'),
    runtimeConfig.cardId,
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
  const conversationId = String(req.query?.conversationId || 'default');
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId_required', messages: [] });
  }
  try {
    const stored = await getConversationMessages(projectId, conversationId);
    const messages = stored
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }));
    return res.json({ ok: true, messages });
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

const CONSOLE_MODES: ConsoleMode[] = ['interactive', 'print', 'task', 'shell'];

function parseConsoleMode(value: unknown): ConsoleMode {
  return CONSOLE_MODES.includes(value as ConsoleMode) ? (value as ConsoleMode) : 'interactive';
}

router.get('/openclaude/terminal/launch', (req, res) => {
  const launch = openClaudeRuntimeService.getTerminalLaunch({
    mode: 'terminal',
    modelKey: typeof req.query.modelKey === 'string' ? req.query.modelKey : undefined,
    provider: typeof req.query.provider === 'string' ? (req.query.provider as OpenClaudeRunRequest['provider']) : undefined,
    providerModelId:
      typeof req.query.providerModelId === 'string' ? req.query.providerModelId : undefined,
  });
  const statusCode = launch.ok ? 200 : 400;
  return res.status(statusCode).json({ ok: launch.ok, launch });
});

// ── Native terminal transports ─────────────────────────────────────────────
// Route plumbing is shared, while Coder and installed Hermes keep separate
// process managers and session namespaces.
type ConsoleRouteManager =
  | typeof openClaudeConsoleSessionManager
  | typeof hermesConsoleSessionManager;

function mountConsoleSessionRoutes(
  prefix: string,
  manager: ConsoleRouteManager,
): void {
  router.post(`${prefix}/sessions`, (req, res) => {
    const started = manager.start({
      targetRoot: typeof req.body?.targetRoot === 'string' ? req.body.targetRoot : undefined,
      mode: parseConsoleMode(req.body?.mode),
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
      prompt: typeof req.body?.prompt === 'string' ? req.body.prompt : undefined,
    });
    if (!started.ok) {
      return res.status(424).json({ ok: false, error: started.error, missing: started.missing });
    }
    const info = started.session.info;
    return res.status(info.state === 'failed' ? 502 : 200).json({
      ok: info.state !== 'failed',
      session: info,
    });
  });

  router.get(`${prefix}/sessions`, (_req, res) => {
    return res.json({ ok: true, sessions: manager.list() });
  });

  router.get(`${prefix}/sessions/:id`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    return res.json({ ok: true, session: session.info, transcript: session.transcript() });
  });

  router.get(`${prefix}/sessions/:id/stream`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: info\ndata: ${JSON.stringify(session.info)}\n\n`);
    const unsubscribe = session.subscribe((event) => {
      if (event.kind === 'chunk') {
        res.write(`event: chunk\ndata: ${JSON.stringify(event.chunk)}\n\n`);
      } else {
        res.write(`event: lifecycle\ndata: ${JSON.stringify(event.info)}\n\n`);
      }
    });
    req.on('close', () => {
      unsubscribe();
      res.end();
    });
    return undefined;
  });

  router.post(`${prefix}/sessions/:id/input`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    const delivered = session.write(data);
    return res.status(delivered ? 200 : 409).json({
      ok: delivered,
      delivered,
      interactiveSupported: session.info.interactiveSupported,
    });
  });

  router.post(`${prefix}/sessions/:id/resize`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const cols = Number(req.body?.cols);
    const rows = Number(req.body?.rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
      return res.status(400).json({ ok: false, error: 'console_resize_invalid_dimensions' });
    }
    const resized = session.resize(Math.floor(cols), Math.floor(rows));
    return res.status(resized ? 200 : 409).json({
      ok: resized,
      resized,
      transportMode: session.info.transportMode,
    });
  });

  router.post(`${prefix}/sessions/:id/stop`, (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
    const stopped = session.stop();
    return res.json({ ok: true, stopped, session: session.info });
  });
}

mountConsoleSessionRoutes('/openclaude/console', openClaudeConsoleSessionManager);
mountConsoleSessionRoutes('/hermes/console', hermesConsoleSessionManager);


/** Resolve the saved Main Chat card from the live deck by binding, never title. */
async function resolveMainChatCardId(projectId: string, deckId: string): Promise<string | null> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find(
    (node: any) =>
      String((node?.runtimeOptions as any)?.binding ?? node?.runtimeBinding ?? '') === 'main_chat',
  );
  return card ? String(card.id) : null;
}

router.get('/localcoder/status', async (req, res) => {
  const repoPath = typeof req.query.repoPath === 'string' ? req.query.repoPath : undefined;
  const inspection = await localCoderService.inspect(repoPath);
  return res.status(inspection.ready ? 200 : 424).json({
    ok: inspection.ready,
    inspection,
  });
});

// LocalCoder/OpenClaude remains the sole coding runtime. Its Python-owned
// callers pass a transient logical CoderPacket; this narrow process boundary
// injects only the server-trusted repository root and process correlation id.
// It does not persist or reconstruct an IDF, conversation, result, or receipt.
router.post('/localcoder/run', async (req, res) => {
  try {
    const supplied = req.body?.coderPacket && typeof req.body.coderPacket === 'object'
      ? req.body.coderPacket
      : req.body;
    const runId = `coder_${randomUUID()}`;
    const coderPacket = {
      ...(supplied || {}),
      id: runId,
      repoPath: resolveRepoRoot(),
    };
    const result = await localCoderService.run(coderPacket);
    const reportOk = result.report.status === 'succeeded' || result.report.status === 'partial';
    const statusCode =
      result.report.status === 'blocked'
        ? 424
        : result.report.status === 'failed'
          ? 502
          : 200;
    return res.status(statusCode).json({
      ok: reportOk,
      ...result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_coder_packet',
        issues: error.issues,
      });
    }
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'localcoder_run_failed',
    });
  }
});

export default router;
