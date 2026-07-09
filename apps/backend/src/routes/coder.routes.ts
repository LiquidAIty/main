import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';
import { localCoderService } from '../coder/localcoder/service';
import {
  openClaudeConsoleSessionManager,
  type ConsoleMode,
} from '../coder/openclaude/console/consoleSession';
import { runConfiguredCard } from '../cards/runtime';
import {
  describeConnectedAgents,
  runMagOne,
} from '../coder/openclaude/mcp/liquidAItyAgentFlow';
import {
  deriveSessionId,
  startGrpcTurn,
  type GrpcTurnHandle,
} from '../coder/openclaude/session/grpcChatClient';
import {
  appendMessage,
  getConversationMessages,
} from '../conversations/store';
import { callPythonAgentMcpTool } from '../services/mcp/pythonAgentMcpClient';
import {
  applyThinkGraphPatch,
  readThinkGraphScope,
  type ThinkGraphPatchAuthority,
} from '../services/thinkgraph/thinkGraphStore';
import { formatHarnessTrace, logHarnessTrace, redactTrace } from '../services/harnessTrace';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveRuntimeBinding } from '../contracts/runtimeBinding';
import type { HermesReviewReport } from '../contracts/runtimeContracts';
import {
  requestHermesReview,
  requestHermesRunReview,
} from '../services/autogen/autogenOrchestratorClient';
import {
  appendHermesActivity,
  appendHermesBlocked,
  listHermesActivity,
  normalizeHermesActivityEntry,
} from '../coder/hermes/hermesActivity';
import { hermesPreflightContext } from '../coder/hermes/hermesPreflight';

const router = Router();
export const OPENCLAUDE_HARNESS_ROUTE_PREFIX = '/coder/openclaude';

// ── LiquidAIty MCP bridge (SDK-free) ───────────────────────────────────────
// Internal JSON endpoints that run the proven MCP handlers server-side, where
// the backend already owns deck state + the Python transport. These import NO
// MCP SDK (liquidAItyAgentFlow.ts is SDK-free), so they are safe in the Nx serve
// graph. The separate MCP host process (which DOES use the SDK) bridges MCP tool
// / resource calls to these endpoints — single authority, no duplicated state.
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

router.post('/mcp-bridge/run_mag_one', async (req, res) => {
  try {
    // Same blank-deckId default as run_configured_card / describe_connected_agents.
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID);
    // The real conversation this run belongs to, when the Harness supplies it —
    // postflight run-memory provenance only; never invented here.
    const conversationId = String(req.body?.conversationId || '').trim();
    const result = await runMagOne({
      ...(req.body || {}),
      deckId,
    });
    // Hermes postflight hook: every REAL Mag One run result gets a structural
    // review + a run-memory write attempt (fire-and-forget — the response
    // below returns regardless; a postflight failure only records an honest
    // blocked activity entry). A run that threw before producing a result has
    // no runId and is never reviewed as if it ran.
    void runHermesPostflightAndRecord({
      projectId: String(req.body?.projectId || ''),
      deckId,
      conversationId,
      runId: result.runId,
      status: result.status,
      ...(result.failure ? { failure: result.failure } : {}),
      finalTextPresent: Boolean(result.finalText),
      participants: result.connectedParticipants,
    }).catch(() => null);
    return res.json({ ok: result.status !== 'failed', result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_mag_one_failed' });
  }
});

// ── Hermes preflight_context (memory read BEFORE a Mag One run) ─────────────
// The Harness calls this (via the MCP host bridge tool hermes.preflight_context)
// with its RunIntent. Hermes assembles a ContextPacket from REAL reads
// (ThinkGraph scope, live deck bus topology, KnowGraph reachability) plus a
// structural RunPacketDraft the Harness refines. Writes nothing; unavailable
// graph sources are reported honestly, never faked.
router.post('/mcp-bridge/hermes_preflight', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await hermesPreflightContext({
      projectId: String(body.projectId || ''),
      deckId: String(body.deckId || BUILDER_DECK_ID),
      conversationId: String(body.conversationId || ''),
      userRequest: String(body.userRequest || ''),
      ...(body.needsCodeContext === true ? { needsCodeContext: true } : {}),
    });
    if (!result.ok) {
      const status = result.error.startsWith('preflight_intent_incomplete') ? 400 : 502;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'hermes_preflight_failed' });
  }
});

// Card-scoped internal tools (called by the Python ThinkGraph card run; authority
// comes from the trusted run context the backend itself authored — never the model).
router.post('/mcp-bridge/thinkgraph_read_scope', async (req, res) => {
  try {
    const authority = (req.body?.authority || {}) as Record<string, unknown>;
    const projectId = String(authority.projectId || '');
    const correlationId = String(authority.correlationId || '');
    if (!projectId || !correlationId) {
      return res.status(400).json({ ok: false, error: 'thinkgraph_scope_authority_missing' });
    }
    const scope = await readThinkGraphScope({ projectId, limit: Number(req.body?.limit) || undefined });
    console.log('[THINKGRAPH][tool] read_scope project=%s correlation=%s nodes=%d', projectId, correlationId, scope.nodes.length);
    return res.json({ ok: true, scope });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'thinkgraph_read_scope_failed' });
  }
});

router.post('/mcp-bridge/thinkgraph_apply_patch', async (req, res) => {
  try {
    const authority = (req.body?.authority || {}) as ThinkGraphPatchAuthority;
    const patch = req.body?.patch || {};
    const result = await applyThinkGraphPatch(authority, patch);
    console.log(
      '[THINKGRAPH][tool] apply_patch project=%s correlation=%s -> %s',
      String(authority?.projectId || ''),
      String(authority?.correlationId || ''),
      result.ok ? result.status : `error:${result.error}`,
    );
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'thinkgraph_apply_patch_failed' });
  }
});

// ── Card runtime-assignment transport (thin MCP client shell) ────────────────
// The card editor's visible "ThinkGraph runtime" controls read and write runtime
// assignments ONLY through the Python Agent MCP tools (canvas.inspect /
// card.assign_runtime_skill / card.assign_data_binding). No policy, no DB access,
// no semantics here — Python owns validation (promoted status, compatibility,
// bounded refs, injection rejection).
router.get('/cards/runtime-assignments', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || '');
    const deckId = String(req.query?.deckId || BUILDER_DECK_ID);
    const cardId = String(req.query?.cardId || '');
    const inspect = await callPythonAgentMcpTool('canvas.inspect', { projectId, deckId });
    if (!inspect.ok) return res.status(502).json(inspect);
    const cards = Array.isArray((inspect as any).cards) ? (inspect as any).cards : [];
    const card = cards.find((c: any) => String(c?.id || '') === cardId) ?? null;
    return res.json({ ok: true, card });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'runtime_assignments_read_failed' });
  }
});

router.post('/cards/assign-runtime-skill', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await callPythonAgentMcpTool('card.assign_runtime_skill', {
      projectId: String(body.projectId || ''),
      deckId: String(body.deckId || BUILDER_DECK_ID),
      cardId: String(body.cardId || ''),
      skillId: String(body.skillId || ''),
      ...(Number.isInteger(body.skillVersion) ? { skillVersion: body.skillVersion } : {}),
      op: body.op === 'remove' ? 'remove' : 'assign',
    });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'assign_runtime_skill_failed' });
  }
});

router.post('/cards/assign-data-binding', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await callPythonAgentMcpTool('card.assign_data_binding', {
      projectId: String(body.projectId || ''),
      deckId: String(body.deckId || BUILDER_DECK_ID),
      cardId: String(body.cardId || ''),
      bindingType: String(body.bindingType || ''),
      ...(body.bindingRef && typeof body.bindingRef === 'object' ? { bindingRef: body.bindingRef } : {}),
      op: body.op === 'remove' ? 'remove' : 'assign',
    });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'assign_data_binding_failed' });
  }
});

// run_configured_card: thin transport for the card.run_assistant_agent MCP tool.
// Saved card identity/prompt/model/tools only — runConfiguredCard structurally
// rejects every extra key, so no browser/MCP-supplied override can reach the run.
router.post('/mcp-bridge/run_configured_card', async (req, res) => {
  try {
    const body = req.body || {};
    // conversationId is a structural reference to the real live conversation
    // (the Harness injects it server-side for doorway calls; absent for a
    // Task-tab test run). Card-specific authority is minted inside
    // runConfiguredCard itself — never accepted from the caller.
    const result = await runConfiguredCard({
      projectId: String(body.projectId || ''),
      deckId: String(body.deckId || BUILDER_DECK_ID),
      cardId: String(body.cardId || ''),
      correlationId: String(body.correlationId || ''),
      input: String(body.input || ''),
      conversationId: String(body.conversationId || ''),
    });
    return res.json({ ok: result.status === 'completed', result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_configured_card_failed' });
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
  const workingDirectory = String(
    req.body?.workingDirectory || process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main',
  );
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }
  const sessionId = deriveSessionId(projectId, conversationId);
  // One correlation id per turn for the concise backend trace. This does NOT change
  // the SSE stream or browser behavior — it only makes the real Harness events
  // (already flowing to the browser) legible in the backend dev terminal.
  const correlationId = `req_${randomUUID().slice(0, 8)}`;
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
  // Durable project-scoped transcript persistence (conversations/store.ts). Best-effort:
  // a DB failure must never block or break the live SSE stream.
  void appendMessage({ projectId, conversationId, role: 'user', content: message }).catch(() => null);
  let turnFinished = false;
  try {
    const handle = await startGrpcTurn({ sessionId, message, workingDirectory, mode, traceId: correlationId }, (event) => {
      if (turnFinished) return;
      // Backend trace of the REAL event (only when it carries lifecycle signal),
      // then the unchanged SSE forward to the browser.
      const traceLine = formatHarnessTrace(event, correlationId);
      if (traceLine) logHarnessTrace(traceLine);
      writeSse(event.kind, event);
    });
    activeGrpcTurns.set(sessionId, handle);
    req.on('close', () => {
      if (turnFinished) return;
      handle.cancel();
      activeGrpcTurns.delete(sessionId);
    });
    const { finalText } = await handle.done;
    turnFinished = true;
    logHarnessTrace(`[harness] request completed corr=${correlationId}`);
    // Save the assistant reply only when real text was produced — never an empty
    // bubble (mirrors the frontend's "no text → no bubble" contract). Best-effort,
    // same as the user message: a DB failure must never block or break the live
    // SSE stream, which has already delivered the final result.
    const assistantText = String(finalText || '').trim();
    if (assistantText) {
      void appendMessage({
        projectId,
        conversationId,
        role: 'assistant',
        content: assistantText,
      }).catch(() => null);
    }
  } catch (error) {
    turnFinished = true;
    const reason = error instanceof Error ? error.message : 'grpc_turn_failed';
    logHarnessTrace(`[harness] request failed corr=${correlationId} reason=${redactTrace(reason)}`);
    writeSse('error', { message: reason });
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
// restores the same chat. Returns user/assistant turns in append order. A read
// failure (e.g. project not yet persisted) returns an empty transcript, never
// a 500 — a fresh project simply has no history yet.
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
  } catch {
    return res.json({ ok: true, messages: [] });
  }
});

const CONSOLE_MODES: ConsoleMode[] = ['interactive', 'print', 'task', 'shell'];

function parseConsoleMode(value: unknown): ConsoleMode {
  return CONSOLE_MODES.includes(value as ConsoleMode) ? (value as ConsoleMode) : 'interactive';
}

router.get('/openclaude/status', (req, res) => {
  const status = openClaudeRuntimeService.getStatus({
    mode: typeof req.query.mode === 'string' ? (req.query.mode as OpenClaudeRunRequest['mode']) : undefined,
    access: typeof req.query.access === 'string' ? (req.query.access as OpenClaudeRunRequest['access']) : undefined,
    modelKey: typeof req.query.modelKey === 'string' ? req.query.modelKey : undefined,
    provider: typeof req.query.provider === 'string' ? (req.query.provider as OpenClaudeRunRequest['provider']) : undefined,
    providerModelId:
      typeof req.query.providerModelId === 'string' ? req.query.providerModelId : undefined,
  });
  return res.json({ ok: true, status });
});

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

// ── OpenClaude Console Bridge ──────────────────────────────────────────────
// Runs the real OpenClaude CLI as a long-lived, streamed process for the in-app
// terminal view. Not a sandbox; not a CoderReport. See PLAN.md.

router.post('/openclaude/console/sessions', (req, res) => {
  const started = openClaudeConsoleSessionManager.start({
    targetRoot: typeof req.body?.targetRoot === 'string' ? req.body.targetRoot : undefined,
    mode: parseConsoleMode(req.body?.mode),
    model: typeof req.body?.model === 'string' ? req.body.model : undefined,
    provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
    prompt: typeof req.body?.prompt === 'string' ? req.body.prompt : undefined,
    args: Array.isArray(req.body?.args) ? req.body.args.map((a: unknown) => String(a)) : undefined,
  });
  if (!started.ok) {
    return res.status(424).json({ ok: false, error: started.error, missing: started.missing });
  }
  const info = started.session.info;
  // A child that failed to spawn is reported honestly, never as a live session.
  return res.status(info.state === 'failed' ? 502 : 200).json({
    ok: info.state !== 'failed',
    session: info,
  });
});

router.get('/openclaude/console/sessions', (_req, res) => {
  return res.json({ ok: true, sessions: openClaudeConsoleSessionManager.list() });
});

router.get('/openclaude/console/sessions/:id', (req, res) => {
  const session = openClaudeConsoleSessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
  return res.json({ ok: true, session: session.info, transcript: session.transcript() });
});

router.get('/openclaude/console/sessions/:id/stream', (req, res) => {
  const session = openClaudeConsoleSessionManager.get(req.params.id);
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

router.post('/openclaude/console/sessions/:id/input', (req, res) => {
  const session = openClaudeConsoleSessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
  const data = typeof req.body?.data === 'string' ? req.body.data : '';
  const delivered = session.write(data);
  return res.status(delivered ? 200 : 409).json({
    ok: delivered,
    delivered,
    interactiveSupported: session.info.interactiveSupported,
  });
});

router.post('/openclaude/console/sessions/:id/resize', (req, res) => {
  const session = openClaudeConsoleSessionManager.get(req.params.id);
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

router.post('/openclaude/console/sessions/:id/stop', (req, res) => {
  const session = openClaudeConsoleSessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'console_session_not_found' });
  const stopped = session.stop();
  return res.json({ ok: true, stopped, session: session.info });
});


// ── Hermes steward: preflight / review / postflight / activity seams ────────
// The reviews themselves are PURE Python on the rails (/hermes/review,
// /hermes/review_run — no model call, no DB). This backend layer is transport,
// the transient activity buffer the Hermes console reads, and the postflight
// run-memory write: ThinkGraph persistence goes through the ONE canonical
// applyThinkGraphPatch writer under server-minted Hermes-card authority
// (projectId / hermes cardId / correlationId / conversationId) — the model
// never mints authority, and no second write path exists.

/** Run the Hermes review for one real CoderReport and record honest activity.
 * Never throws: a failed review becomes a blocked activity entry, so the
 * CoderReport path that triggered it is never disturbed. */
async function runHermesReviewAndRecord(
  payload: Record<string, unknown>,
  runId: string | null,
): Promise<
  | { ok: true; review: Record<string, unknown>; thinkgraphPatch: Record<string, unknown> }
  | { ok: false; error: string }
> {
  try {
    const result = await requestHermesReview(payload);
    if (!result.ok) {
      appendHermesBlocked(result.error, runId);
      return result;
    }
    const events = Array.isArray((result.review as any)?.activityEvents)
      ? ((result.review as any).activityEvents as unknown[])
      : [];
    appendHermesActivity(
      events
        .map(normalizeHermesActivityEntry)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'hermes_review_failed';
    appendHermesBlocked(message, runId);
    return { ok: false, error: message };
  }
}

/** Resolve the saved Hermes card from the live deck (binding, never a title
 * match) so postflight write provenance names the real card. */
async function resolveHermesCardId(projectId: string, deckId: string): Promise<string | null> {
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = (deck?.nodes || []).find(
    (node: any) =>
      resolveRuntimeBinding((node?.runtimeOptions as any)?.binding ?? node?.runtimeBinding, node?.id) ===
      'hermes_steward',
  );
  return card ? String(card.id) : null;
}

/** Hermes postflight for one REAL Mag One run result: pure Python review,
 * honest activity, and the run-memory write through the canonical
 * applyThinkGraphPatch writer under server-minted Hermes-card authority.
 * A missing conversation or Hermes card blocks the write honestly — the
 * review/activity still land. Never throws. */
async function runHermesPostflightAndRecord(input: {
  projectId: string;
  deckId: string;
  conversationId: string;
  runId: string;
  status: string;
  failure?: string;
  finalTextPresent?: boolean;
  participants?: string[];
}): Promise<{ ok: true; report: HermesReviewReport } | { ok: false; error: string }> {
  try {
    const reviewResult = await requestHermesRunReview({
      runId: input.runId,
      status: input.status,
      ...(input.failure ? { failure: input.failure } : {}),
      finalTextPresent: Boolean(input.finalTextPresent),
      ...(input.participants?.length ? { participants: input.participants } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    });
    if (!reviewResult.ok) {
      appendHermesBlocked(reviewResult.error, input.runId);
      return reviewResult;
    }
    const events = Array.isArray((reviewResult.review as any)?.activityEvents)
      ? ((reviewResult.review as any).activityEvents as unknown[])
      : [];
    const normalized = events
      .map(normalizeHermesActivityEntry)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    appendHermesActivity(normalized);

    const patch = (reviewResult.thinkgraphPatch || {}) as {
      resources?: unknown[];
      statements?: unknown[];
    };
    const hasWrites =
      (Array.isArray(patch.resources) && patch.resources.length > 0) ||
      (Array.isArray(patch.statements) && patch.statements.length > 0);
    const correlationId = `hermes_post_${input.runId}`;

    let thinkGraphWrite: HermesReviewReport['thinkGraphWrite'];
    if (!hasWrites) {
      thinkGraphWrite = {
        status: 'empty',
        correlationId,
        storedResourceIds: [],
        storedStatementIds: [],
      };
    } else if (!input.conversationId) {
      thinkGraphWrite = {
        status: 'blocked',
        reason: 'conversationId_missing: run-memory provenance requires the real conversation identity',
      };
      appendHermesBlocked('postflight ThinkGraph write blocked: conversationId missing', input.runId);
    } else {
      const hermesCardId = await resolveHermesCardId(input.projectId, input.deckId).catch(() => null);
      if (!hermesCardId) {
        thinkGraphWrite = { status: 'blocked', reason: 'hermes_card_not_found' };
        appendHermesBlocked('postflight ThinkGraph write blocked: Hermes card not found on deck', input.runId);
      } else {
        const applied = await applyThinkGraphPatch(
          { projectId: input.projectId, cardId: hermesCardId, correlationId, conversationId: input.conversationId },
          patch as any,
        );
        if (applied.ok) {
          thinkGraphWrite = {
            status: applied.status,
            correlationId: applied.correlationId,
            storedResourceIds: applied.storedResourceIds,
            storedStatementIds: applied.storedStatementIds,
          };
          if (applied.status === 'applied') {
            appendHermesActivity([
              {
                id: `hermes:write:${input.runId}`,
                timestamp: new Date().toISOString(),
                type: 'thinkgraph_write_complete',
                summary:
                  `ThinkGraph run memory written for ${input.runId}: ` +
                  `${applied.storedResourceIds.length} node(s), ${applied.storedStatementIds.length} statement(s)`,
                runId: input.runId,
              },
            ]);
          }
        } else {
          thinkGraphWrite = { status: 'blocked', reason: applied.error };
          appendHermesBlocked(`postflight ThinkGraph write failed: ${applied.error}`, input.runId);
        }
      }
    }

    return {
      ok: true,
      report: {
        runId: input.runId,
        verdict: String((reviewResult.review as any)?.verdict || 'empty'),
        recommendation: String((reviewResult.review as any)?.recommendation || ''),
        thinkGraphWrite,
        activityCount: normalized.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'hermes_postflight_failed';
    appendHermesBlocked(message, input.runId);
    return { ok: false, error: message };
  }
}

router.get('/hermes/activity', (req, res) => {
  const limit = Number(req.query?.limit);
  return res.json({ ok: true, activity: listHermesActivity(Number.isFinite(limit) ? limit : 50) });
});

// Hermes postflight_review for a Mag One / team run result. Normally invoked
// automatically by the run_mag_one bridge above; this route is the explicit
// callable seam (Harness or diagnostics). Requires a real runId — nothing is
// reviewed or written for a run that never produced a result.
router.post('/hermes/postflight', async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const runId = String(body.runId || '').trim();
  if (!runId) return res.status(400).json({ ok: false, error: 'runId_required' });
  const projectId = String(body.projectId || '').trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  const failure = String(body.failure || '').trim();
  const result = await runHermesPostflightAndRecord({
    projectId,
    deckId: String(body.deckId || BUILDER_DECK_ID),
    conversationId: String(body.conversationId || '').trim(),
    runId,
    status: String(body.status || ''),
    ...(failure ? { failure } : {}),
    finalTextPresent: body.finalTextPresent === true,
    ...(Array.isArray(body.participants)
      ? { participants: (body.participants as unknown[]).map((p) => String(p)) }
      : {}),
  });
  if (!result.ok) return res.status(502).json(result);
  return res.json({ ok: true, report: result.report });
});

router.post('/hermes/review', async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const coderReport = body.coderReport;
  if (!coderReport || typeof coderReport !== 'object') {
    return res.status(400).json({ ok: false, error: 'coderReport_object_required' });
  }
  const runId = String((coderReport as any)?.coderPacketId || body.runId || '') || null;
  const result = await runHermesReviewAndRecord(
    {
      coderReport,
      featureId: String(body.featureId || ''),
      ...(body.runId ? { runId: String(body.runId) } : {}),
      ...(body.projectId ? { projectId: String(body.projectId) } : {}),
      ...(body.thinkGraphContext && typeof body.thinkGraphContext === 'object'
        ? { thinkGraphContext: body.thinkGraphContext }
        : {}),
      ...(body.codeGraphStatus && typeof body.codeGraphStatus === 'object'
        ? { codeGraphStatus: body.codeGraphStatus }
        : {}),
    },
    runId,
  );
  if (!result.ok) {
    return res.status(502).json(result);
  }
  return res.json(result);
});

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
    // The coder's filesystem root is SERVER-OWNED and trusted — the model/caller
    // can never choose it. Any supplied repoPath is overridden with the server's
    // configured project root, and the run id is server-minted. The caller
    // supplies only the logical coding task (objective, guardrails, proof, ...).
    const incoming = (req.body?.coderPacket ?? req.body ?? {}) as Record<string, unknown>;
    const coderPacket = {
      ...incoming,
      id:
        typeof incoming.id === 'string' && incoming.id.trim()
          ? incoming.id
          : `coder_${randomUUID()}`,
      repoPath: process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main',
    };
    const result = await localCoderService.run(coderPacket);
    const reportOk = result.report.status === 'succeeded' || result.report.status === 'partial';
    const statusCode =
      result.report.status === 'blocked'
        ? 424
        : result.report.status === 'failed'
          ? 502
          : 200;
    // Hermes postflight: every REAL CoderReport gets a pure review after the
    // fact (fire-and-forget — the report below returns regardless; a review
    // failure only records an honest blocked activity entry, never touches
    // this response). featureId is honestly absent until packets carry one.
    void runHermesReviewAndRecord(
      {
        coderReport: result.report,
        featureId: '',
        ...(typeof incoming.projectId === 'string' && incoming.projectId
          ? { projectId: incoming.projectId }
          : {}),
      },
      String(result.report.coderPacketId || '') || null,
    );
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
