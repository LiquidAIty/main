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
import { flushAgentTelemetry, recordAgentEvent } from '../services/agentTelemetry';
// The app's one canonical Agent Canvas deck id, defined once on the deck store.
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { createCodebaseMemoryMcpCaller } from '../services/graphContext/cbmMcpCaller';
import { pool } from '../db/pool';
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
import { runCoderSubagent } from '../coder/execution/coderRouter';
import { resolveCoderWorkspaceRoot } from '../coder/workspaceRoot';

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
    const jobId = String(req.body?.jobId || '').trim();
    const deckId = String(req.body?.deckId || BUILDER_DECK_ID);
    const result = await runMagOne({
      ...(req.body || {}),
      jobId,
      projectId: String(req.body?.projectId || ''),
      deckId,
    });
    // Hermes receives the completed job identity first. Main Chat gets only
    // the compact reviewed outcome; raw worker text and files remain in the
    // returns folder and can be inspected deliberately through job tools.
    const hermesReview = await runHermesPostflightAndRecord({
      projectId: String(req.body?.projectId || ''),
      deckId,
      conversationId: result.conversationId || String(req.body?.conversationId || ''),
      runId: result.runId,
      jobId: result.jobId,
      workspaceRoot: resolveCoderWorkspaceRoot(),
      status: result.status,
      ...(result.failure ? { failure: result.failure } : {}),
      finalTextPresent: Boolean(result.finalText),
      participants: result.connectedParticipants,
      returnFiles: result.returnedFiles,
      ...(req.body?.parentContext && typeof req.body.parentContext === 'object'
        ? { parentContext: req.body.parentContext }
        : {}),
    });
    return res.json({
      ok: result.status !== 'failed',
      result: {
        status: result.status,
        runId: result.runId,
        jobId: result.jobId,
        conversationId: result.conversationId,
        connectedParticipants: result.connectedParticipants,
        returnsDir: result.returnsDir,
        returnedFiles: result.returnedFiles,
        returnStatus: result.returnStatus,
        failure: result.failure,
      },
      hermesReview: hermesReview.ok ? hermesReview.report : null,
      hermesReviewError: hermesReview.ok ? null : hermesReview.error,
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_mag_one_failed' });
  }
});

router.post('/mcp-bridge/run_coder_subagent', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runCoderSubagent({
      parentRunId: String(body.parentRunId || ''),
      projectId: String(body.projectId || ''),
      deckId: String(body.deckId || BUILDER_DECK_ID),
      conversationId: String(body.conversationId || ''),
      cardId: String(body.cardId || ''),
      adapter: String(body.adapter || ''),
      approvedPrompt: String(body.approvedPrompt || ''),
    });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'run_coder_subagent_failed' });
  }
});

// ── Hermes ThinkGraph structured update (canonical writer, minted authority) ─
// The model supplies ONLY the bounded structured update; the server mints the
// authority from the live Hermes card + real conversation. Same validation and
// same one applyThinkGraphPatch writer as the ThinkGraph card path.
router.post('/mcp-bridge/thinkgraph_submit_update', async (req, res) => {
  const startedMs = Date.now();
  const projectId = String(req.body?.projectId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  try {
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
    if (!conversationId) return res.status(400).json({ ok: false, error: 'conversationId_required' });
    const hermesCardId = await resolveHermesCardId(projectId, BUILDER_DECK_ID);
    if (!hermesCardId) return res.status(409).json({ ok: false, error: 'hermes_card_not_found' });
    const authority: ThinkGraphPatchAuthority = {
      projectId,
      cardId: hermesCardId,
      correlationId: `hermes_update_${Date.now()}_${randomUUID().slice(0, 8)}`,
      conversationId,
    };
    const result = await applyThinkGraphPatch(authority, {
      resources: Array.isArray(req.body?.resources) ? req.body.resources : [],
      relations: Array.isArray(req.body?.relations) ? req.body.relations : [],
      statements: Array.isArray(req.body?.statements) ? req.body.statements : [],
    });
    recordAgentEvent({
      stage: 'graph_write',
      status: result.ok ? 'completed' : 'failed',
      mode: 'real_model_call',
      caller: 'hermes',
      projectId,
      deckId: BUILDER_DECK_ID,
      conversationId,
      correlationId: authority.correlationId,
      cardId: hermesCardId,
      inputSummary: 'hermes thinkgraph_submit_update',
      outputSummary: result.ok ? `status=${result.status}` : '',
      errorSummary: result.ok ? null : result.error,
      durationMs: Date.now() - startedMs,
      graphWrites: result.ok && result.status === 'applied' ? ['thinkgraph'] : [],
      metadata: { invocationPath: 'direct_harness' },
    });
    return res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'thinkgraph_submit_update_failed' });
  }
});

// ── Hermes SQL memory (liq_core.memory_space/memory_item, scope 'hermes') ───
// Project-scoped private steward continuity — separate from ThinkGraph. The
// runtime project authority is ag_catalog.projects, the same table used by
// deck/conversation resolution. The old liq_core.project table is legacy data
// only; never silently mirror or guess an identity from it.
export async function resolveHermesProjectId(projectId: string): Promise<string> {
  const normalized = String(projectId || '').trim();
  if (!normalized) throw new Error('hermes_project_id_required');
  const { rows } = await pool.query(
    `SELECT id::text AS id FROM ag_catalog.projects WHERE id::text = $1 LIMIT 1`,
    [normalized],
  );
  if (rows.length === 0) throw new Error(`hermes_project_not_found: ${normalized}`);
  return String(rows[0].id);
}

async function resolveHermesMemorySpaceId(projectId: string): Promise<number> {
  const canonicalProjectId = await resolveHermesProjectId(projectId);
  const existing = await pool.query(
    `SELECT memory_space_id FROM liq_core.memory_space
     WHERE project_id = $1 AND scope = 'hermes' ORDER BY memory_space_id LIMIT 1`,
    [canonicalProjectId],
  );
  if (existing.rows.length > 0) return Number(existing.rows[0].memory_space_id);
  const created = await pool.query(
    `INSERT INTO liq_core.memory_space (project_id, scope, label, tags, config)
     VALUES ($1, 'hermes', 'Hermes Steward Memory', '{}', '{}') RETURNING memory_space_id`,
    [canonicalProjectId],
  );
  return Number(created.rows[0].memory_space_id);
}

router.post('/mcp-bridge/hermes_memory_read', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
    const key = String(req.body?.key || '').trim();
    const spaceId = await resolveHermesMemorySpaceId(projectId);
    const { rows } = key
      ? await pool.query(
          `SELECT key, value, updated_at FROM liq_core.memory_item
           WHERE memory_space_id = $1 AND key = $2 ORDER BY updated_at DESC LIMIT 1`,
          [spaceId, key],
        )
      : await pool.query(
          `SELECT key, value, updated_at FROM liq_core.memory_item
           WHERE memory_space_id = $1 ORDER BY updated_at DESC LIMIT 50`,
          [spaceId],
        );
    return res.json({
      ok: true,
      items: rows.map((row: any) => ({ key: row.key, value: row.value, updatedAt: row.updated_at })),
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'hermes_memory_read_failed' });
  }
});

router.post('/mcp-bridge/hermes_memory_write', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const key = String(req.body?.key || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
    if (!key) return res.status(400).json({ ok: false, error: 'key_required' });
    if (req.body?.value === undefined) return res.status(400).json({ ok: false, error: 'value_required' });
    const valueJson = JSON.stringify(req.body.value).slice(0, 32_000);
    const spaceId = await resolveHermesMemorySpaceId(projectId);
    const updated = await pool.query(
      `UPDATE liq_core.memory_item SET value = $3::jsonb
       WHERE memory_space_id = $1 AND key = $2 RETURNING memory_item_id`,
      [spaceId, key, valueJson],
    );
    if (updated.rows.length === 0) {
      await pool.query(
        `INSERT INTO liq_core.memory_item (memory_space_id, key, value) VALUES ($1, $2, $3::jsonb)`,
        [spaceId, key, valueJson],
      );
    }
    return res.json({ ok: true, key, stored: true });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'hermes_memory_write_failed' });
  }
});

// ── CodeGraph reads (CBM is the one indexer/writer; these are thin reads) ───
router.post('/mcp-bridge/codegraph_status', async (_req, res) => {
  let session: Awaited<ReturnType<typeof createCodebaseMemoryMcpCaller>> | null = null;
  try {
    session = await createCodebaseMemoryMcpCaller(process.cwd());
    const projectList = await session.callTool('list_projects', {});
    const projects = Array.isArray((projectList as any).projects) ? (projectList as any).projects : [];
    const cbmProject = String(projects[0]?.name || '').trim();
    if (!cbmProject) return res.json({ ok: false, error: 'cbm_no_indexed_project' });
    const status = await session.callTool('index_status', { project: cbmProject });
    return res.json({ ok: true, cbmProject, status });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'codegraph_status_failed' });
  } finally {
    await session?.close();
  }
});

router.post('/mcp-bridge/codegraph_search', async (req, res) => {
  let session: Awaited<ReturnType<typeof createCodebaseMemoryMcpCaller>> | null = null;
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'query_required' });
    const limit = Math.min(Math.max(Number(req.body?.limit) || 15, 1), 50);
    session = await createCodebaseMemoryMcpCaller(process.cwd());
    const projectList = await session.callTool('list_projects', {});
    const projects = Array.isArray((projectList as any).projects) ? (projectList as any).projects : [];
    const cbmProject = String(projects[0]?.name || '').trim();
    if (!cbmProject) return res.json({ ok: false, error: 'cbm_no_indexed_project' });
    const result = await session.callTool('search_graph', { project: cbmProject, query, limit });
    return res.json({ ok: true, cbmProject, result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'codegraph_search_failed' });
  } finally {
    await session?.close();
  }
});

// ── KnowGraph bridges (query is read-only; ingestion = real sources through
// the existing Neo/Python pipeline via the canonical gateway) ────────────────
router.post('/mcp-bridge/knowgraph_ingest', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
    if (documents.length === 0) return res.status(400).json({ ok: false, error: 'real_source_documents_required' });
    // Same-process call into the canonical gateway logic via HTTP keeps ONE
    // authority for KNOWGRAPH_URL resolution and pipeline error shaping.
    const port = Number(process.env.PORT || 4000);
    const axios = (await import('axios')).default;
    const response = await axios.post(
      `http://127.0.0.1:${port}/api/knowgraph/ingest_web`,
      { project_id: projectId, documents, ...(req.body?.researchFocus ? { research_focus: req.body.researchFocus } : {}) },
      { timeout: 300_000, validateStatus: () => true },
    );
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'knowgraph_ingest_failed' });
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
    recordAgentEvent({
      stage: 'graph_read',
      status: 'completed',
      mode: 'real_model_call',
      caller: 'thinkgraph_card_tool',
      projectId,
      correlationId,
      graphReads: ['thinkgraph'],
      outputSummary: `${scope.nodes.length} node(s), ${scope.edges.length} edge(s)`,
    });
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
    recordAgentEvent({
      stage: 'graph_write',
      status: result.ok ? 'completed' : 'blocked',
      mode: 'real_model_call',
      caller: 'thinkgraph_card_tool',
      projectId: String(authority?.projectId || '') || null,
      cardId: String((authority as any)?.cardId || '') || null,
      correlationId: String(authority?.correlationId || '') || null,
      graphWrites: ['thinkgraph'],
      outputSummary: result.ok ? result.status : '',
      errorSummary: result.ok ? null : result.error,
      metadata: result.ok
        ? { storedResourceIds: result.storedResourceIds, storedStatementIds: result.storedStatementIds }
        : {},
    });
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
  // Dev telemetry: the front door — a real user message entering Main Chat.
  const frontdoorStartedMs = Date.now();
  recordAgentEvent({
    stage: 'frontdoor',
    status: 'started',
    mode: 'real_model_call',
    caller: 'user',
    projectId,
    conversationId,
    correlationId,
    inputSummary: message,
    metadata: { surfaceMode: mode, sessionId },
  });
  // Durable project-scoped transcript persistence (conversations/store.ts). Best-effort:
  // a DB failure must never block or break the live SSE stream.
  void appendMessage({ projectId, conversationId, role: 'user', content: message }).catch(() => null);
  let turnFinished = false;
  const hermesToolUseIds = new Set<string>();
  const hermesStartedAt = new Map<string, number>();
  // Durable caller attribution for LiquidAIty MCP actions: one card_call event
  // pair (started/completed) per mcp__liquidaity__* invocation, carrying the
  // engine-supplied invokingCardId from the tool_start event — the record that
  // proves WHICH card (Main Chat vs a doorway child) performed the action.
  const liquidaityCallByToolUse = new Map<string, { invokingCardId: string; toolName: string; startedMs: number }>();
  try {
    const handle = await startGrpcTurn({ sessionId, message, workingDirectory, mode, traceId: correlationId }, (event) => {
      if (turnFinished) return;
      if (event.kind === 'tool_start' && event.toolName.startsWith('mcp__liquidaity__')) {
        liquidaityCallByToolUse.set(event.toolUseId, {
          invokingCardId: event.invokingCardId,
          toolName: event.toolName,
          startedMs: Date.now(),
        });
        recordAgentEvent({
          stage: 'card_call',
          status: 'started',
          mode: 'real_model_call',
          caller: 'harness',
          projectId,
          deckId: BUILDER_DECK_ID,
          conversationId,
          correlationId,
          cardId: event.invokingCardId,
          inputSummary: `${event.toolName} ${String(event.argsJson || '').slice(0, 200)}`,
          metadata: { toolUseId: event.toolUseId, toolName: event.toolName, invokingCardId: event.invokingCardId, agentType: event.agentType },
        });
      } else if (event.kind === 'tool_result' && liquidaityCallByToolUse.has(event.toolUseId)) {
        const started = liquidaityCallByToolUse.get(event.toolUseId)!;
        liquidaityCallByToolUse.delete(event.toolUseId);
        recordAgentEvent({
          stage: 'card_call',
          status: event.isError ? 'failed' : 'completed',
          mode: 'real_model_call',
          caller: 'harness',
          projectId,
          deckId: BUILDER_DECK_ID,
          conversationId,
          correlationId,
          cardId: started.invokingCardId,
          outputSummary: String(event.output || '').slice(0, 200),
          errorSummary: event.isError ? `${started.toolName} failed` : null,
          durationMs: Date.now() - started.startedMs,
          metadata: { toolUseId: event.toolUseId, toolName: started.toolName, invokingCardId: started.invokingCardId },
        });
      }
      if (event.kind === 'tool_start' && event.toolName === 'Agent') {
        try {
          const input = JSON.parse(event.argsJson || '{}') as Record<string, unknown>;
          if (input.subagent_type === 'card_hermes_steward') {
            // Both legitimate invocation forms are recorded: prompt omitted =
            // full native parent-context inheritance; prompt present = a
            // scoped task from Main Chat. The form is real event metadata.
            const inherited = !Object.prototype.hasOwnProperty.call(input, 'prompt');
            hermesToolUseIds.add(event.toolUseId);
            hermesStartedAt.set(event.toolUseId, Date.now());
            recordAgentEvent({
              stage: 'hermes_context',
              status: 'started',
              mode: 'real_model_call',
              caller: 'harness',
              projectId,
              deckId: BUILDER_DECK_ID,
              conversationId,
              correlationId,
              cardId: 'card_hermes_steward',
              inputSummary: inherited
                ? 'native inherited parent context; prompt omitted'
                : String(input.prompt || '').slice(0, 200),
              metadata: { toolUseId: event.toolUseId, invocationForm: inherited ? 'inherited_context' : 'scoped_task' },
            });
          }
        } catch {
          // The raw tool event still flows; malformed args simply cannot prove Hermes.
        }
      } else if (event.kind === 'tool_result' && hermesToolUseIds.has(event.toolUseId)) {
        recordAgentEvent({
          stage: 'hermes_context',
          status: event.isError ? 'failed' : 'completed',
          mode: 'real_model_call',
          caller: 'harness',
          projectId,
          deckId: BUILDER_DECK_ID,
          conversationId,
          correlationId,
          cardId: 'card_hermes_steward',
          // The REAL terminal result of the foreground Hermes child (the Agent
          // tool_result), bounded — never a hardcoded "Mag One job-folder
          // result" string (Hermes preparation is not a Mag One job) and never
          // Mag One wording on the Hermes path.
          outputSummary: event.isError ? '' : String(event.output || '').slice(0, 200),
          errorSummary: event.isError ? 'named Hermes agent turn failed' : null,
          durationMs: Date.now() - (hermesStartedAt.get(event.toolUseId) ?? Date.now()),
          metadata: { toolUseId: event.toolUseId },
        });
      }
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
    recordAgentEvent({
      stage: 'frontdoor',
      status: 'completed',
      mode: 'real_model_call',
      caller: 'user',
      projectId,
      conversationId,
      correlationId,
      // Real resolved identity of the turn (saved main_chat card), so the
      // event trail answers "which card/model acted" without log spelunking.
      cardId: handle.resolved.cardId,
      provider: handle.resolved.provider,
      model: handle.resolved.providerModelId,
      outputSummary: String(finalText || ''),
      durationMs: Date.now() - frontdoorStartedMs,
    });
    // The telemetry writer is intentionally non-blocking at each event
    // boundary, but the completed turn must not be reported before its
    // already-recorded internal events are durable. This also preserves the
    // trace when the dev stack watcher reloads immediately after a run.
    await flushAgentTelemetry();
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
    recordAgentEvent({
      stage: 'frontdoor',
      status: 'failed',
      mode: 'real_model_call',
      caller: 'user',
      projectId,
      conversationId,
      correlationId,
      errorSummary: reason,
      durationMs: Date.now() - frontdoorStartedMs,
    });
    await flushAgentTelemetry();
    writeSse('error', {
      code: 'harness_turn_failed',
      message: 'The chat run failed. Check the correlation ID in the backend logs.',
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
  jobId: string | null;
  workspaceRoot: string;
  status: string;
  failure?: string;
  finalTextPresent?: boolean;
  participants?: string[];
  returnFiles?: string[];
  parentContext?: { objective?: string; acceptanceCriteria?: string[]; reviewInstruction?: string };
  // Explicit diagnostic compatibility only. The normal run_mag_one bridge never
  // forwards raw worker text; Hermes reads bounded return artifacts instead.
  objective?: string;
  finalText?: string;
}): Promise<{ ok: true; report: HermesReviewReport } | { ok: false; error: string }> {
  const postflightStartedMs = Date.now();
  // Dev telemetry for the postflight boundary (non-blocking, dev-only).
  const recordPostflight = (
    status: 'completed' | 'failed',
    extra: { outputSummary?: string; errorSummary?: string; graphWrites?: string[]; metadata?: Record<string, unknown> } = {},
  ): void => {
    recordAgentEvent({
      stage: 'hermes_postflight',
      status,
      mode: 'real_model_call',
      caller: 'hermes',
      projectId: input.projectId || null,
      deckId: input.deckId || null,
      conversationId: input.conversationId || null,
      correlationId: input.runId,
      inputSummary: `run ${input.runId} status=${input.status}`,
      outputSummary: extra.outputSummary ?? '',
      errorSummary: extra.errorSummary ?? null,
      durationMs: Date.now() - postflightStartedMs,
      graphWrites: extra.graphWrites ?? [],
      metadata: extra.metadata ?? {},
    });
  };
  try {
    const reviewResult = await requestHermesRunReview({
      runId: input.runId,
      ...(input.jobId ? { jobId: input.jobId, workspaceRoot: input.workspaceRoot } : {}),
      ...(input.returnFiles ? { returnFiles: input.returnFiles } : {}),
      status: input.status,
      ...(input.failure ? { failure: input.failure } : {}),
      finalTextPresent: Boolean(input.finalTextPresent),
      ...(input.participants?.length ? { participants: input.participants } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.parentContext ? { parentContext: input.parentContext } : {}),
    });
    if (!reviewResult.ok) {
      appendHermesBlocked(reviewResult.error, input.runId);
      recordPostflight('failed', { errorSummary: reviewResult.error });
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

    recordPostflight('completed', {
      outputSummary: `verdict=${String((reviewResult.review as any)?.verdict || 'empty')} write=${thinkGraphWrite.status}`,
      graphWrites: thinkGraphWrite.status === 'applied' ? ['thinkgraph'] : [],
      metadata: { thinkGraphWrite },
    });
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
    recordPostflight('failed', { errorSummary: message });
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
  const jobId = String(body.jobId || '').trim();
  if (!jobId) return res.status(400).json({ ok: false, error: 'jobId_required' });
  const failure = String(body.failure || '').trim();
  const result = await runHermesPostflightAndRecord({
    projectId,
    deckId: String(body.deckId || BUILDER_DECK_ID),
    conversationId: String(body.conversationId || '').trim(),
    runId,
    jobId,
    workspaceRoot: resolveCoderWorkspaceRoot(),
    status: String(body.status || ''),
    ...(Array.isArray(body.returnFiles)
      ? { returnFiles: (body.returnFiles as unknown[]).map((p) => String(p)) }
      : {}),
    ...(failure ? { failure } : {}),
    finalTextPresent: body.finalTextPresent === true,
    ...(Array.isArray(body.participants)
      ? { participants: (body.participants as unknown[]).map((p) => String(p)) }
      : {}),
    ...(body.objective ? { objective: String(body.objective) } : {}),
    ...(body.finalText ? { finalText: String(body.finalText) } : {}),
    ...(body.parentContext && typeof body.parentContext === 'object'
      ? { parentContext: body.parentContext as { objective?: string; acceptanceCriteria?: string[]; reviewInstruction?: string } }
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
