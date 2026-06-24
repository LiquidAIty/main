import { Router } from 'express';
import { ZodError } from 'zod';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';
import { localCoderService } from '../coder/localcoder/service';
import {
  persistCoderRunOutcome,
  prepareActiveCoderPacket,
} from '../services/coderPlanning/coderPlanningService';
import {
  openClaudeConsoleSessionManager,
  type ConsoleMode,
} from '../coder/openclaude/console/consoleSession';
import { routeCodingTaskToConsole } from '../coder/openclaude/console/consoleTaskRouter';
import { codingRunLifecycleService } from '../coder/openclaude/console/codingRunLifecycle';
import { buildMagOneRoutingDiagnostics, runCardWithContract } from '../cards/runtime';
import {
  buildAgentFabricProfile,
  buildProjectContext,
  executeVisibleFlow,
  setSessionBuilderContext,
  writePlanDraft,
} from '../coder/openclaude/mcp/liquidAItyAgentFlow';
import {
  deriveSessionId,
  startGrpcTurn,
  type GrpcTurnHandle,
} from '../coder/openclaude/session/grpcChatClient';
import { getDeckDocument } from '../decks/store';
import {
  appendMessage,
  finalizeMessage,
  getConversationMessages,
  getMostRecentConversation,
  listConversations,
  getOutcomeReviews,
  upsertOutcomeReview,
  type VisibleActivity,
} from '../conversations/store';
import { buildContextPack } from '../conversations/contextPack';

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

// Persist ONE structured Plan Draft onto the authoritative deck (revision CAS).
// Sole structured source for the visible canvas Plan object — no execution starts.
router.post('/mcp-bridge/write_plan_draft', async (req, res) => {
  try {
    const result = await writePlanDraft(req.body);
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'write_plan_draft_failed' });
  }
});

// ── Persistent native OpenClaude session bridge (BuilderChat -> gRPC) ───────
// SSE stream of the REAL QueryEngine event stream, verbatim. One stable session
// id per (projectId, conversationId). The browser never touches gRPC.
const activeGrpcTurns = new Map<string, GrpcTurnHandle>();

router.post('/openclaude/session/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '');
  const conversationId = String(req.body?.conversationId || 'default');
  const tabRuntimeId = String(req.body?.tabRuntimeId || '').trim();
  const parentMessageId =
    typeof req.body?.parentMessageId === 'string' && req.body.parentMessageId.trim()
      ? req.body.parentMessageId.trim()
      : null;
  const runtimeFresh = req.body?.runtimeFresh === true;
  const message = String(req.body?.message || '');
  const model = typeof req.body?.model === 'string' ? req.body.model : undefined;
  const workingDirectory = String(
    req.body?.workingDirectory || process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main',
  );
  if (!projectId || !message) {
    return res.status(400).json({ ok: false, error: 'projectId_and_message_required' });
  }
  // RUNTIME session key = projectId + durable conversationId + tab runtime id, so
  // write_plan_draft binds to THIS tab's session only (never a shared global, never
  // another tab). The BuilderChat deck is the builder deck unless stated otherwise.
  const deckId = String(req.body?.deckId || '').trim() || 'deck_builder';
  const sessionId = deriveSessionId(projectId, conversationId, tabRuntimeId);
  setSessionBuilderContext(sessionId, projectId, deckId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 1) Persist the user message (before the turn) + an assistant message in
  // streaming state. The frontend uses these ids so a reload shows no duplicates.
  let userMsgId = '';
  let assistantMsgId = '';
  try {
    const userMsg = await appendMessage({
      projectId, conversationId, role: 'user', content: message, status: 'complete', parentMessageId,
    });
    userMsgId = userMsg.messageId;
    const assistantMsg = await appendMessage({
      projectId, conversationId, role: 'assistant', content: '', status: 'streaming', parentMessageId: userMsgId,
    });
    assistantMsgId = assistantMsg.messageId;
    res.write(`event: saved\ndata: ${JSON.stringify({ userMessageId: userMsgId, assistantMessageId: assistantMsgId, conversationId })}\n\n`);
  } catch (persistErr) {
    res.write(`event: persist_error\ndata: ${JSON.stringify({ message: persistErr instanceof Error ? persistErr.message : 'persist_failed' })}\n\n`);
  }
  res.write(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);

  // 2) Build the bounded Context Pack — active branch tail (only when fresh/branch),
  // reply-anchor lineage, and active Plan context. Never the whole transcript; no
  // automatic graph dump. Provenance is surfaced for debugging, not chain-of-thought.
  let modelMessage = message;
  try {
    const [deckRes, messages] = await Promise.all([
      getDeckDocument(projectId, deckId).catch(() => ({ deck: null }) as any),
      getConversationMessages(projectId, conversationId).catch(() => []),
    ]);
    const pack = await buildContextPack({
      projectId,
      conversationId,
      messages,
      activeLeafMessageId: assistantMsgId || userMsgId || null,
      anchorMessageId: parentMessageId && parentMessageId !== userMsgId ? parentMessageId : null,
      runtimeFresh,
      planDraft: (deckRes?.deck?.planDraft ?? null) as any,
    });
    if (pack.preamble) modelMessage = `${pack.preamble}\n\n${message}`;
    res.write(
      `event: context_pack\ndata: ${JSON.stringify({ items: pack.items.map((i) => ({ source: i.source, ref: i.ref, reason: i.reason })), excluded: pack.excluded })}\n\n`,
    );
  } catch {
    /* context pack best-effort; fall back to the raw user message */
  }

  // 3) Run the gRPC turn; collect only SAFE visible activity summaries + plan link.
  let accumulated = '';
  let linkedPlanDraftId: string | null = null;
  const visibleActivities: VisibleActivity[] = [];
  try {
    const handle = await startGrpcTurn({ sessionId, message: modelMessage, workingDirectory, model }, (event) => {
      res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.kind === 'text') {
        accumulated += String((event as { text?: unknown }).text || '');
      } else if (event.kind === 'tool_start') {
        const tn = String((event as { toolName?: unknown }).toolName || '');
        const isPlan = /write_plan_draft/i.test(tn);
        visibleActivities.push({ kind: isPlan ? 'plan_write' : 'tool', label: isPlan ? 'Saving plan to canvas…' : tn, status: 'started' });
      } else if (event.kind === 'tool_result') {
        const tn = String((event as { toolName?: unknown }).toolName || '');
        if (/write_plan_draft/i.test(tn)) {
          visibleActivities.push({ kind: 'plan_write', label: 'Plan saved to canvas.', status: 'complete' });
          try {
            const out = JSON.parse(String((event as { output?: unknown }).output || '{}'));
            if (out?.planDraft?.id) linkedPlanDraftId = String(out.planDraft.id);
          } catch {
            /* result not JSON; no plan id to link */
          }
        } else {
          visibleActivities.push({ kind: 'tool', label: `${tn} result`, status: (event as { isError?: unknown }).isError ? 'error' : 'complete' });
        }
      } else if (event.kind === 'permission') {
        visibleActivities.push({ kind: 'question', label: String((event as { question?: unknown }).question || 'Question'), status: 'asked' });
      } else if (event.kind === 'error') {
        visibleActivities.push({ kind: 'error', label: String((event as { message?: unknown }).message || 'error'), status: 'error' });
      }
    });
    activeGrpcTurns.set(sessionId, handle);
    req.on('close', () => {
      handle.cancel();
      activeGrpcTurns.delete(sessionId);
    });
    const { finalText } = await handle.done;
    // 4) Finalize: a plan turn persists ONLY the brief pointer (never plan markdown/
    // JSON) and links the Plan Draft; otherwise the real final text.
    if (assistantMsgId) {
      const finalContent = linkedPlanDraftId ? 'Plan created on canvas.' : finalText || accumulated || '';
      await finalizeMessage({
        projectId, messageId: assistantMsgId, content: finalContent, status: 'complete', linkedPlanDraftId, visibleActivities,
      }).catch(() => undefined);
    }
  } catch (error) {
    if (assistantMsgId) {
      await finalizeMessage({ projectId, messageId: assistantMsgId, content: accumulated, status: 'error', visibleActivities }).catch(() => undefined);
    }
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
    String(req.body?.tabRuntimeId || '').trim(),
  );
  const handle = activeGrpcTurns.get(sessionId);
  if (!handle) return res.status(404).json({ ok: false, error: 'no_active_turn' });
  handle.answer(String(req.body?.promptId || ''), String(req.body?.reply || ''));
  return res.json({ ok: true });
});

// ── Durable conversation history (read) + outcome reviews ───────────────────
router.get('/openclaude/conversation/list', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || '');
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
    const conversations = await listConversations(projectId);
    const mostRecent = await getMostRecentConversation(projectId);
    return res.json({ ok: true, conversations, mostRecentConversationId: mostRecent?.conversationId ?? null });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'conversation_list_failed' });
  }
});

router.get('/openclaude/conversation/messages', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || '');
    const conversationId = String(req.query?.conversationId || '');
    if (!projectId || !conversationId) return res.status(400).json({ ok: false, error: 'projectId_and_conversationId_required' });
    const messages = await getConversationMessages(projectId, conversationId);
    return res.json({ ok: true, messages });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'conversation_messages_failed' });
  }
});

router.get('/openclaude/outcome-reviews', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || '');
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
    const reviews = await getOutcomeReviews(projectId, {
      planDraftId: typeof req.query?.planDraftId === 'string' ? req.query.planDraftId : undefined,
      planStepId: typeof req.query?.planStepId === 'string' ? req.query.planStepId : undefined,
    });
    return res.json({ ok: true, reviews });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'outcome_reviews_failed' });
  }
});

router.post('/openclaude/outcome-review', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '');
    const requestedOutcome = String(req.body?.requestedOutcome || '');
    if (!projectId || !requestedOutcome) return res.status(400).json({ ok: false, error: 'projectId_and_requestedOutcome_required' });
    const review = await upsertOutcomeReview({
      projectId,
      requestedOutcome,
      reviewId: typeof req.body?.reviewId === 'string' ? req.body.reviewId : undefined,
      requestMessageId: typeof req.body?.requestMessageId === 'string' ? req.body.requestMessageId : undefined,
      planDraftId: typeof req.body?.planDraftId === 'string' ? req.body.planDraftId : undefined,
      planStepId: typeof req.body?.planStepId === 'string' ? req.body.planStepId : undefined,
      acceptanceCriteria: Array.isArray(req.body?.acceptanceCriteria) ? req.body.acceptanceCriteria.map((x: unknown) => String(x)) : undefined,
    });
    return res.json({ ok: true, review });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'outcome_review_failed' });
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

router.post('/planflow/prepare', async (req, res) => {
  try {
    const result = await prepareActiveCoderPacket({
      projectId: String(req.body?.projectId || ''),
      userInput: String(req.body?.userInput || ''),
      repoPath: typeof req.body?.repoPath === 'string' ? req.body.repoPath : null,
      planFlowState:
        req.body?.planFlowState && typeof req.body.planFlowState === 'object'
          ? req.body.planFlowState
          : {},
      selectedContext:
        req.body?.selectedContext && typeof req.body.selectedContext === 'object'
          ? req.body.selectedContext
          : {},
      workflowOption: typeof req.body?.workflowOption === 'string' ? req.body.workflowOption : undefined,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_context_or_coder_packet',
        issues: error.issues,
      });
    }
    const message = error instanceof Error ? error.message : 'active_coder_packet_prepare_failed';
    const blocked =
      message.startsWith('coder_planner_') ||
      message.startsWith('context_packet_') ||
      message.startsWith('thinkgraph_');
    return res.status(blocked ? 424 : 500).json({ ok: false, error: message });
  }
});

router.post('/localcoder/run', async (req, res) => {
  try {
    const result = await localCoderService.run(req.body?.coderPacket ?? req.body);
    let thinkGraphPersistence: { ok: boolean; error?: string } = { ok: true };
    try {
      await persistCoderRunOutcome(result);
    } catch (error) {
      thinkGraphPersistence = {
        ok: false,
        error: error instanceof Error ? error.message : 'thinkgraph_coder_report_write_failed',
      };
    }
    const reportOk = result.report.status === 'succeeded' || result.report.status === 'partial';
    const statusCode = !thinkGraphPersistence.ok
      ? 500
      :
      result.report.status === 'blocked'
        ? 424
        : result.report.status === 'failed'
          ? 502
          : 200;
    return res.status(statusCode).json({
      ok: reportOk && thinkGraphPersistence.ok,
      ...result,
      thinkGraphPersistence,
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
