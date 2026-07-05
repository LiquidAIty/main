import { Router } from 'express';
import { ZodError } from 'zod';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';
import { localCoderService } from '../coder/localcoder/service';
import {
  openClaudeConsoleSessionManager,
  type ConsoleMode,
} from '../coder/openclaude/console/consoleSession';
import { routeCodingTaskToConsole } from '../coder/openclaude/console/consoleTaskRouter';
import { codingRunLifecycleService } from '../coder/openclaude/console/codingRunLifecycle';
import { buildMagOneRoutingDiagnostics, runCardWithContract, runConfiguredCard } from '../cards/runtime';
import {
  buildAgentFabricProfile,
  buildProjectContext,
  executeVisibleFlow,
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
import { processThinkGraphPair } from '../services/thinkgraph/processThinkGraphPair';
import { callPythonAgentMcpTool } from '../services/mcp/pythonAgentMcpClient';
import {
  applyThinkGraphPatch,
  readThinkGraphScope,
  type ThinkGraphPatchAuthority,
} from '../services/thinkgraph/thinkGraphStore';

// The app's one canonical Agent Canvas deck (client BUILDER_DECK_ID).
const BUILDER_DECK_ID = 'deck_builder';

const router = Router();
export const OPENCLAUDE_HARNESS_ROUTE_PREFIX = '/coder/openclaude';

// ── LiquidAIty MCP bridge (SDK-free) ───────────────────────────────────────
// Internal JSON endpoints that run the proven MCP handlers server-side, where
// the backend already owns deck state + the Python transport. These import NO
// MCP SDK (liquidAItyAgentFlow.ts is SDK-free), so they are safe in the Nx serve
// graph. The separate MCP host process (which DOES use the SDK) bridges MCP tool
// / resource calls to these endpoints — single authority, no duplicated state.
router.post('/mcp-bridge/project_context', async (req, res) => {
  try {
    const ctx = await buildProjectContext({
      projectId: String(req.body?.projectId || ''),
      deckId: String(req.body?.deckId || ''),
      selectedCardId: typeof req.body?.selectedCardId === 'string' ? req.body.selectedCardId : undefined,
    });
    return res.json({ ok: true, projectContext: ctx });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'project_context_failed' });
  }
});

router.post('/mcp-bridge/describe_agent_fabric', async (req, res) => {
  try {
    const profile = await buildAgentFabricProfile({
      projectId: String(req.body?.projectId || ''),
      deckId: String(req.body?.deckId || ''),
      selectedCardId: typeof req.body?.selectedCardId === 'string' ? req.body.selectedCardId : undefined,
    });
    return res.json({ ok: true, agentFabricProfile: profile });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'describe_agent_fabric_failed' });
  }
});

router.post('/mcp-bridge/execute_visible_flow', async (req, res) => {
  try {
    const result = await executeVisibleFlow(req.body);
    return res.json({ ok: result.status !== 'failed', result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'execute_visible_flow_failed' });
  }
});

// ── ThinkGraph post-chat runner bridge (same mcp-bridge family) ─────────────
// thinkgraph_process_pair: the MCP-facing capability implementation — exact pair
// references only, no raw prompts/models/cards/patches/task data accepted.
router.post('/mcp-bridge/thinkgraph_process_pair', async (req, res) => {
  try {
    const body = req.body || {};
    // Structural input contract: exactly these six references (extra keys rejected
    // inside processThinkGraphPair as overrides).
    const result = await processThinkGraphPair({
      projectId: String(body.projectId || ''),
      deckId: String(body.deckId || BUILDER_DECK_ID),
      conversationId: String(body.conversationId || ''),
      userMessageId: String(body.userMessageId || ''),
      assistantMessageId: String(body.assistantMessageId || ''),
      correlationId: String(body.correlationId || ''),
    });
    return res.json({ ok: result.status !== 'failed', result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'thinkgraph_process_pair_failed' });
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
  const model = typeof req.body?.model === 'string' ? req.body.model : undefined;
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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);
  // Durable project-scoped transcript persistence (conversations/store.ts). Best-effort:
  // a DB failure must never block or break the live SSE stream.
  void appendMessage({ projectId, conversationId, role: 'user', content: message }).catch(() => null);
  try {
    const handle = await startGrpcTurn({ sessionId, message, workingDirectory, model, mode }, (event) => {
      res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    activeGrpcTurns.set(sessionId, handle);
    req.on('close', () => {
      handle.cancel();
      activeGrpcTurns.delete(sessionId);
    });
    const { finalText } = await handle.done;
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
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : 'grpc_turn_failed' })}\n\n`,
    );
  } finally {
    activeGrpcTurns.delete(sessionId);
    res.write('event: end\ndata: {}\n\n');
    res.end();
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

router.post('/openclaude/run', async (req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'openclaude_plain_task_run_removed_use_localcoder_run',
  });
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

router.post('/openclaude/console/task', async (req, res) => {
  const cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
  const edges = Array.isArray(req.body?.edges) ? req.body.edges : [];
  const task = String(req.body?.task || '');
  const repoPath = String(req.body?.repoPath || '');
  const projectId = String(req.body?.projectId || '');
  const userGoal = String(req.body?.userGoal || '').trim();
  const generatedSpec = String(req.body?.generatedSpec || task).trim();
  const explicitApproval = req.body?.explicitApproval === true;
  if (!repoPath) {
    return res.status(400).json({ ok: false, error: 'console_task_repo_path_required' });
  }
  const codingRun = codingRunLifecycleService.request({
    projectId,
    targetRoot: repoPath,
    userGoal: userGoal || task,
    generatedSpec,
    editMode: req.body?.editMode === 'edit' ? 'edit' : 'read_only',
  });
  const workflowOption = req.body?.workflowOption;
  
  if (!workflowOption) {
    return res.status(400).json({
      ok: false,
      error: 'magone_next_action_missing',
    });
  }

  const isSelectedReadOnlyWorkflow = workflowOption === 'run_read_only_coder_task';
  const editModeRequested = req.body?.editMode === 'edit' ? 'edit' : 'read_only';

  if (workflowOption === 'draft_spec_for_approval' || workflowOption === 'plan_only' || workflowOption === 'report_blocker' || workflowOption === 'answer_general') {
    return res.status(200).json({
      ok: true,
      workflowOption,
      dispatched: false,
      codingRun,
    });
  }

  // Otherwise, if it's run_read_only_coder_task, we require editMode: read_only and we can auto dispatch
  const readOnlyAutoDispatch = isSelectedReadOnlyWorkflow && editModeRequested === 'read_only';
  
  if (!explicitApproval && !readOnlyAutoDispatch) {
    return res.status(409).json({
      ok: false,
      error: 'coding_run_explicit_approval_required',
      codingRun,
    });
  }
  codingRunLifecycleService.approve(codingRun.id);
  const magenticCard = cards.find(
    (card: any) => String(card?.runtimeType || '').trim().toLowerCase() === 'magentic_one',
  );
  if (!magenticCard) {
    return res.status(400).json({ ok: false, error: 'console_task_magentic_card_missing' });
  }
  const routing = buildMagOneRoutingDiagnostics(magenticCard, cards, edges, task, { projectId });
  const localCoderBusConnected = routing.eligibleBusConnectedAgents.some(
    (agent) => agent.role === 'local_coder',
  );
  const codeGraphBusConnected = routing.eligibleBusConnectedAgents.some(
    (agent) => agent.role === 'codegraph',
  );
  const result = await routeCodingTaskToConsole({
    repoPath,
    task,
    localCoderBusConnected,
    codeGraphBusConnected,
    editMode: typeof req.body?.editMode === 'string' ? req.body.editMode : undefined,
    sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
    model: typeof req.body?.model === 'string' ? req.body.model : undefined,
    provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
  });
  const updatedRun =
    result.routed && result.session
      ? codingRunLifecycleService.dispatched(
          codingRun.id,
          result.session.id,
          result.session.provider,
          result.session.model,
        )
      : codingRunLifecycleService.blocked(codingRun.id, result.blocked || 'coder_console_dispatch_blocked');
  return res.status(result.routed ? 200 : 424).json({
    ok: result.routed,
    routing,
    autoDispatchedReadOnly: !explicitApproval && readOnlyAutoDispatch,
    ...result,
    codingRun: updatedRun,
  });
});

router.post('/openclaude/console/run_approved_task', async (req, res) => {
  const payload = req.body as {
    projectId: string;
    targetRoot?: string;
    taskLedger?: any;
    proposedAction?: any;
    progressLedger?: any;
    contextPacket?: any;
    cards?: any[];
    edges?: any[];
  };

  const projectId = String(payload.projectId || '');
  const repoPath = String(payload.targetRoot || '');
  if (!repoPath) {
    return res.status(400).json({ ok: false, error: 'console_task_repo_path_required' });
  }

  if (!payload.taskLedger && !payload.proposedAction) {
    return res.status(400).json({ ok: false, error: 'no approved task ledger' });
  }

  const taskParts = [];
  if (payload.taskLedger) {
    taskParts.push(`Task Ledger:\n${JSON.stringify(payload.taskLedger, null, 2)}`);
  }
  if (payload.proposedAction) {
    taskParts.push(`Proposed Action:\n${JSON.stringify(payload.proposedAction, null, 2)}`);
  }
  if (payload.progressLedger) {
    taskParts.push(`Progress Ledger:\n${JSON.stringify(payload.progressLedger, null, 2)}`);
  }
  if (payload.contextPacket) {
    taskParts.push(`Context Packet Summary:\n${JSON.stringify(payload.contextPacket, null, 2)}`);
  }
  taskParts.push('Execute this approved task ledger.');
  
  const formattedTask = taskParts.join('\n\n');

  const codingRun = codingRunLifecycleService.request({
    projectId,
    targetRoot: repoPath,
    userGoal: formattedTask,
    generatedSpec: formattedTask,
    editMode: 'read_only',
  });
  
  codingRunLifecycleService.approve(codingRun.id);

  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];

  const magenticCard = cards.find(
    (card: any) => String(card?.runtimeType || '').trim().toLowerCase() === 'magentic_one',
  );
  if (!magenticCard) {
    return res.status(400).json({ ok: false, error: 'console_task_magentic_card_missing' });
  }

  const routing = buildMagOneRoutingDiagnostics(magenticCard, cards, edges, formattedTask, { projectId });
  const localCoderBusConnected = routing.eligibleBusConnectedAgents.some(
    (agent) => agent.role === 'local_coder',
  );
  const codeGraphBusConnected = routing.eligibleBusConnectedAgents.some(
    (agent) => agent.role === 'codegraph',
  );

  const result = await routeCodingTaskToConsole({
    repoPath,
    task: formattedTask,
    localCoderBusConnected,
    codeGraphBusConnected,
    editMode: 'read_only',
  });

  const updatedRun = result.routed && result.session
    ? codingRunLifecycleService.dispatched(codingRun.id, result.session.id, result.session.provider, result.session.model)
    : codingRunLifecycleService.blocked(codingRun.id, result.blocked || 'coder_console_dispatch_blocked');

  return res.status(result.routed ? 200 : 424).json({
    ok: result.routed,
    routing,
    ...result,
    codingRun: updatedRun,
  });
});

// Skill step 12: after execution completes, feed the real TaskResult back into
// a Magentic-One reasoning turn together with the previous Task Ledger and
// Progress Ledger. Magentic-One — not TypeScript — decides whether the task is
// complete, blocked, or needs a revised/next Task Ledger and returns its own
// interpretation + (optionally) a revised plan. This is a planning/reasoning
// turn: it routes to no coder and starts no execution.
router.post('/openclaude/console/result_feedback', async (req, res) => {
  const payload = req.body as {
    projectId?: string;
    targetRoot?: string;
    taskLedger?: any;
    progressLedger?: any;
    runTaskPayload?: any;
    taskResult?: any;
    cards?: any[];
    edges?: any[];
  };

  const projectId = String(payload.projectId || '');
  const taskLedger = payload.taskLedger ?? payload.runTaskPayload?.task_ledger ?? null;
  const progressLedger = payload.progressLedger ?? payload.runTaskPayload?.progress_ledger ?? null;

  // Source of truth must be the real previous Task Ledger and the real
  // TaskResult — never raw user input or a frontend-only summary.
  if (!taskLedger && !payload.runTaskPayload?.proposed_action) {
    return res.status(400).json({ ok: false, error: 'result_feedback_missing_task_ledger' });
  }
  if (!payload.taskResult) {
    return res.status(400).json({ ok: false, error: 'result_feedback_missing_task_result' });
  }

  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const magenticCard = cards.find(
    (card: any) => String(card?.runtimeType || '').trim().toLowerCase() === 'magentic_one',
  );
  if (!magenticCard) {
    return res.status(400).json({ ok: false, error: 'console_task_magentic_card_missing' });
  }

  const feedbackInstruction = [
    'This is a result-interpretation turn. Execution of the previously approved Task Ledger has completed.',
    'The real execution TaskResult / CoderReport is provided in the blackboard findings, and the previous',
    'Task Ledger and Progress Ledger are provided in the plan context.',
    'Interpret the actual result against the previous Task Ledger and Progress Ledger and decide whether the',
    'task is complete, blocked, needs a revised Task Ledger, or needs the next Task Ledger.',
    'Do not invent success. If the task is complete, do not fabricate next work.',
  ].join(' ');

  try {
    const result = await runCardWithContract(magenticCard, {}, feedbackInstruction, {
      deckId: '',
      projectId,
      allCards: cards,
      allEdges: edges,
      allTemplates: [],
      previousOutput: '',
      priorPlanContext: { task_ledger: taskLedger, progress_ledger: progressLedger },
      resultFeedback: payload.taskResult,
    });
    return res.status(result.status === 'error' ? 502 : 200).json({
      ok: result.status !== 'error',
      interpretation: result.output,
      // The revised / next Task Ledger (if any) comes back only from real
      // Magentic-One output. TypeScript never fabricates completion or a plan.
      plan: result.magenticTrace?.plan ?? null,
    });
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get('/openclaude/console/runs/:id', async (req, res) => {
  const run = await codingRunLifecycleService.refresh(req.params.id);
  if (!run) return res.status(404).json({ ok: false, error: 'coding_run_not_found' });
  return res.json({
    ok: true,
    codingRun: run,
    consoleTranscriptPath: run.sessionId
      ? `/api/coder/openclaude/console/sessions/${run.sessionId}`
      : null,
  });
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
    const result = await localCoderService.run(req.body?.coderPacket ?? req.body);
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
