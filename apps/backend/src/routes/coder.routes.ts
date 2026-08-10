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
import { runConfiguredCard } from '../cards/runtime';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../coder/workspaceRoot';
import {
  describeConnectedAgents,
  runMagOne,
} from '../coder/openclaude/mcp/mainAgentFlow';
import {
  deriveSessionId,
  startGrpcTurn,
  type GrpcSessionEvent,
  type GrpcTurnHandle,
} from '../coder/openclaude/session/grpcChatClient';
import {
  beginConversationRun,
  cancelConversationRun,
  completeConversationRun,
  failConversationRun,
  getConversationMessages,
  listConversations,
  markConversationRunRunning,
} from '../conversations/store';
import { formatHarnessTrace, logHarnessTrace, redactTrace } from '../services/harnessTrace';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveExternalIdentityMainGrant } from '../auth/externalIdentityGrantStore';
import {
  fetchAgentCardContext,
  requestPythonRailsJson,
} from '../services/autogen/autogenOrchestratorClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import {
  buildToolInputDataDictionary,
  searchToolInputReferences,
  type ToolInputDictionarySource,
} from '../cards/toolInputDataDictionary';

const router = Router();

router.get('/input-data-dictionary/tools', async (req, res) => {
  try {
    const canonicalMcpTools = await listPythonAgentMcpCatalog();
    const privateRuntimeManifest = await requestPythonRailsJson('/tools/manifest', {
      method: 'GET',
    }) as { tools?: unknown };
    if (!Array.isArray(privateRuntimeManifest?.tools)) {
      throw new Error('python_runtime_tool_manifest_invalid');
    }
    const dictionary = buildToolInputDataDictionary([
      ...canonicalMcpTools.map((tool) => ({
        ...tool,
        sourceId: 'main_mcp',
        kind: 'tool',
        publication: { externalMcp: true },
        execution: { authority: 'main_mcp', nativeName: tool.name },
      })),
      ...privateRuntimeManifest.tools as ToolInputDictionarySource[],
    ]);
    const selectedIds = Array.isArray(req.query.selectedIds)
      ? req.query.selectedIds.map(String)
      : typeof req.query.selectedIds === 'string'
        ? req.query.selectedIds.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    return res.json({
      ok: true,
      ...searchToolInputReferences(dictionary, {
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        namespace: typeof req.query.namespace === 'string' ? req.query.namespace : undefined,
        selectedIds,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      }),
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'python_agent_mcp_catalog_unavailable',
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
    // Blank deckId defaults to the ONE canonical Agent Canvas deck — the same
    // convention run_configured_card already follows. A present-but-wrong
    // deckId still fails honestly (no silent correction).
    const result = await describeConnectedAgents({
      projectId: String(req.body?.projectId || ''),
      deckId: String(req.body?.deckId || BUILDER_DECK_ID),
    });
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

router.post('/mcp-bridge/run_mag_one', async (req, res) => {
  try {
    const instructionId = String(req.body?.instructionId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID);
    const result = await runMagOne({
      ...(req.body || {}),
      instructionId,
      projectId: String(req.body?.projectId || ''),
      deckId,
    });
    return res.json({
      ok: result.status !== 'failed',
      result: {
        status: result.status,
        runId: result.runId,
        assignmentId: result.assignmentId,
        conversationId: result.conversationId,
        connectedParticipants: result.connectedParticipants,
        failure: result.failure,
      },
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_mag_one_failed' });
  }
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

// run_configured_card: thin transport for the card.run_assistant_agent MCP tool.
// Saved card identity/prompt/model/tools only — runConfiguredCard structurally
// rejects every extra key, so no browser/MCP-supplied override can reach the run.
router.post('/mcp-bridge/run_configured_card', async (req, res) => {
  try {
    const body = req.body || {};
    // conversationId is a structural reference to the real live conversation
    // (the Harness injects it server-side for doorway calls). Card-specific authority is minted inside
    // runConfiguredCard itself — never accepted from the caller.
    const result = await runConfiguredCard({
      projectId: String(body.projectId || ''),
      deckId: String(body.deckId || BUILDER_DECK_ID),
      cardId: String(body.cardId || ''),
      correlationId: String(body.correlationId || ''),
      input: String(body.input || ''),
      conversationId: String(body.conversationId || ''),
      instructionId: String(body.instructionId || ''),
      senderCardId: String(body.senderCardId || ''),
      parentRunId: String(body.parentRunId || ''),
    });
    return res.json({ ok: result.status === 'completed', result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
  }
});

router.get('/agentgraph/card-context', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || '').trim();
  const conversationId = String(req.query.conversationId || '').trim();
  const receiverCardId = String(req.query.receiverCardId || '').trim();
  const assignmentId = String(req.query.assignmentId || '').trim();
  if (!projectId || !deckId || !conversationId || !receiverCardId) {
    return res.status(400).json({
      ok: false,
      error: 'project_deck_conversation_receiver_required',
    });
  }
  try {
    return res.json(await fetchAgentCardContext({
      projectId,
      deckId,
      conversationId,
      receiverCardId,
      ...(assignmentId ? { assignmentId } : {}),
    }));
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'agent_card_context_failed',
    });
  }
});

// ── Persistent native OpenClaude session bridge (BuilderChat -> gRPC) ───────
// SSE stream of the REAL QueryEngine event stream, verbatim. One stable session
// id per (projectId, conversationId). The browser never touches gRPC.
const activeGrpcTurns = new Map<string, GrpcTurnHandle>();

router.post('/openclaude/session/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '');
  const conversationId = String(req.body?.conversationId || 'default');
  const message = String(req.body?.message || '');
  // Explicit Harness surface state from the client (chat vs Agent Canvas /
  // Edit mode) — decides which card doorways this turn exposes. Never inferred
  // from message content.
  const mode = req.body?.mode === 'canvas' ? ('canvas' as const) : ('chat' as const);
  // A PRODUCT chat session's cwd is a neutral out-of-repo directory, NOT the
  // repo root: a repo-root cwd makes the engine walk up and inject the repo's
  // developer memory (AGENTS.md/CLAUDE.md, ~8.4k tokens — M-1) into Main/Hermes
  // chat. They use MCP tools, not the filesystem, so the neutral cwd loses no
  // capability. An explicit client-supplied workingDirectory still wins; the
  // Coder keeps the real repo root (spawned separately via resolveRepoRoot).
  const workingDirectory =
    String(req.body?.workingDirectory || '').trim() || resolveProductChatWorkingDirectory();
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }
  const sessionId = deriveSessionId(projectId, conversationId);
  // One correlation id per turn for the concise backend trace. This does NOT change
  // the SSE stream or browser behavior — it only makes the real Harness events
  // (already flowing to the browser) legible in the backend dev terminal.
  const correlationId = `req_${randomUUID().slice(0, 8)}`;
  try {
    await beginConversationRun({
      runId: correlationId,
      projectId,
      deckId: BUILDER_DECK_ID,
      conversationId,
      sessionId,
      userContent: message,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'conversation_run_begin_failed';
    logHarnessTrace(
      `[harness] request rejected corr=${correlationId} reason=${redactTrace(reason)}`,
    );
    return res.status(503).json({
      ok: false,
      error: 'conversation_persistence_unavailable',
      correlationId,
    });
  }
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
  logHarnessTrace(`[harness] request received ${`corr=${correlationId}`} project=${projectId} mode=${mode}`);
  let turnFinished = false;
  let runCancelled = false;
  let terminalDoneEvent: Extract<GrpcSessionEvent, { kind: 'done' }> | null = null;
  try {
    const handle = await startGrpcTurn({
      sessionId,
      message,
      workingDirectory,
      mode,
      traceId: correlationId,
    }, async (event) => {
      if (turnFinished) return;
      if (event.kind === 'done') {
        terminalDoneEvent = event;
        return;
      }
      // Backend trace of the REAL event (only when it carries lifecycle signal),
      // then the unchanged SSE forward to the browser.
      const traceLine = formatHarnessTrace(event, correlationId);
      if (traceLine) logHarnessTrace(traceLine);
      writeSse(event.kind, event);
    });
    try {
      await markConversationRunRunning({
        runId: correlationId,
        invokingCardId: handle.resolved.cardId,
        provider: handle.resolved.provider,
        modelKey: handle.resolved.modelKey,
        providerModelId: handle.resolved.providerModelId,
      });
    } catch (error) {
      handle.cancel();
      throw new Error(
        `harness_run_persistence_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    activeGrpcTurns.set(sessionId, handle);
    req.on('close', () => {
      if (turnFinished) return;
      runCancelled = true;
      handle.cancel();
      activeGrpcTurns.delete(sessionId);
      void cancelConversationRun(correlationId).catch((error) => {
        logHarnessTrace(
          `[harness] run cancellation persistence failed corr=${correlationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
        );
      });
    });
    const { finalText, usage } = await handle.done;
    try {
      await completeConversationRun({
        runId: correlationId,
        assistantContent: String(finalText || ''),
        usage,
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
    const reason = error instanceof Error ? error.message : 'grpc_turn_failed';
    if (!runCancelled) {
      await failConversationRun(
        correlationId,
        reason.startsWith('harness_run_persistence_failed')
          ? 'harness_run_persistence_failed'
          : 'harness_turn_failed',
        reason,
      ).catch((persistenceError) => {
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
      route: '/api/coder/openclaude/session/chat',
      status: 502,
    });
  } finally {
    turnFinished = true;
    activeGrpcTurns.delete(sessionId);
    writeSse('end', {});
    if (!res.destroyed && !res.writableEnded) res.end();
  }
  return undefined;
});

router.post('/openclaude/session/answer', (req, res) => {
  const sessionId = deriveSessionId(
    String(req.body?.projectId || ''),
    String(req.body?.conversationId || 'default'),
  );
  const handle = activeGrpcTurns.get(sessionId);
  if (!handle) return res.status(404).json({ ok: false, error: 'no_active_turn' });
  handle.answer(String(req.body?.promptId || ''), String(req.body?.reply || ''));
  return res.json({ ok: true });
});

// Load the durable project-scoped transcript for a conversation so a reload
// restores the same chat. A valid conversation with no messages returns an
// empty transcript. A persistence failure remains a visible typed failure.
router.get('/openclaude/session/history', async (req, res) => {
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

router.get('/openclaude/session/conversations', async (req, res) => {
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

router.post('/localcoder/run', async (req, res) => {
  try {
    // The coder's filesystem root is server-owned and trusted. The caller
    // supplies only the bounded logical task;
    // it cannot choose the filesystem root or mint the run identity.
    const incoming = (req.body?.coderPacket ?? req.body ?? {}) as Record<string, unknown>;
    const coderPacket = {
      ...incoming,
      id:
        typeof incoming.id === 'string' && incoming.id.trim()
          ? incoming.id
          : `coder_${randomUUID()}`,
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
