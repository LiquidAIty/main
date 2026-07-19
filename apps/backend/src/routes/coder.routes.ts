import { Router } from 'express';
import { createHash, randomUUID } from 'crypto';
import { ZodError } from 'zod';
import type { OpenClaudeRunRequest } from '../coder/openclaude/contracts';
import { openClaudeRuntimeService } from '../coder/openclaude/runtime/service';
import { localCoderService } from '../coder/localcoder/service';
import {
  openClaudeConsoleSessionManager,
  type ConsoleMode,
} from '../coder/openclaude/console/consoleSession';
import { runConfiguredCard, resolveCardModelStrict } from '../cards/runtime';
import { resolveProductChatWorkingDirectory } from '../coder/workspaceRoot';
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
  parseHermesInvestigationContext,
  beginHermesInvestigation,
  endHermesInvestigation,
  readLatestHermesReport,
  readActiveHermesReport,
  writeActiveHermesReport,
  type HermesInvestigationContext,
} from '../coder/hermes/hermesReportArtifact';
import {
  appendMessage,
  getConversationMessages,
  listConversations,
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
import { runCoderSubagent } from '../coder/execution/coderRouter';
import { setLatestCoderAuditView, getLatestCoderAuditView } from '../coder/execution/coderAuditView';
import type { CodeGraphViewContractResult } from '../contracts/coderContracts';
import { completeGraphViews, parseGraphViews, type GraphView } from '../contracts/graphView';
import {
  fetchDoorwayContext,
  fetchUnifiedModelContext,
  persistGraphViewOnPython,
} from '../services/autogen/autogenOrchestratorClient';
import {
  parseGraphObjectRefs,
  resolveSelectedGraphObjectContext,
} from '../coder/openclaude/session/graphObjectContext';
import {
  createPromptDraft,
  approvePromptDraft,
  publishApprovedPrompt,
  getPromptDraft,
  type PromptSource,
} from '../services/prompt/promptLifecycle';

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
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'run_mag_one_failed' });
  }
});

router.post('/mcp-bridge/run_coder_subagent', async (req, res) => {
  try {
    const body = req.body || {};
    const projectId = String(body.projectId || '');
    const deckId = String(body.deckId || BUILDER_DECK_ID);
    const cardId = String(body.cardId || '');
    const conversationId = String(body.conversationId || '');
    // Resolve the saved Coder card's provider/model EXACTLY as the runtime does
    // (no hardcoded model, no deckSeed edit). Missing/mismatched config throws.
    const { deck } = await getDeckDocument(projectId, deckId);
    const nodes: unknown[] = Array.isArray((deck as { nodes?: unknown[] } | null)?.nodes)
      ? ((deck as { nodes: unknown[] }).nodes)
      : [];
    const card = nodes.find((node) => String((node as { id?: unknown })?.id || '') === cardId);
    if (!card) return res.status(404).json({ ok: false, error: `coder_card_not_found: ${cardId}` });
    const model = resolveCardModelStrict(card);
    const authority =
      body.authority === 'mag_one_execution' || body.authority === 'direct_main_audit'
        ? body.authority
        : undefined;
    // The caller (Main's tool call) supplies persisted Graph View IDS only —
    // never view content. The server resolves the persisted records and
    // renders the one compact representation; a request still carrying full
    // view JSON is rejected, no fallback.
    if (body.graphViews !== undefined) {
      return res.status(400).json({ ok: false, error: 'caller_graph_views_removed: pass graphViewIds — the server resolves persisted views' });
    }
    const graphViewIds = (Array.isArray(body.graphViewIds) ? body.graphViewIds : [])
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean);
    let attachedViews: GraphView[] = [];
    let doorwayGraphContext = '';
    if (graphViewIds.length > 0) {
      const doorway = (await fetchDoorwayContext(projectId, conversationId, graphViewIds)) as {
        views?: unknown;
        modelContext?: unknown;
      };
      attachedViews = parseGraphViews(doorway?.views, { projectId, conversationId });
      // Honest role check: a view aimed at another role is an explicit error,
      // never silently dropped (the rendered text must match the attached set).
      const misdirected = attachedViews.filter(
        (view) => view.receivingRole !== 'coder' && view.receivingRole !== 'main_chat',
      );
      if (misdirected.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `graph_view_not_for_coder: ${misdirected.map((view) => view.viewId).join(', ')}`,
        });
      }
      doorwayGraphContext = String(doorway?.modelContext || '');
    }
    if (authority === 'direct_main_audit' && !attachedViews.some((view) => view.receivingRole === 'coder')) {
      return res.status(400).json({ ok: false, error: 'coder_targeted_graph_view_required' });
    }
    await Promise.all(attachedViews.map((view) => persistGraphViewOnPython({
      ...view,
      status: 'active',
      invocationId: String(body.parentRunId || ''),
      updatedAt: new Date().toISOString(),
    })));
    const approvedPrompt = [
      String(body.approvedPrompt || ''),
      attachedViews.length ? doorwayGraphContext : '',
    ].filter(Boolean).join('\n\n');
    const result = await runCoderSubagent({
      parentRunId: String(body.parentRunId || ''),
      projectId,
      deckId,
      conversationId,
      cardId,
      adapter: String(body.adapter || ''),
      approvedPrompt,
      authority,
      model: model.providerModelId,
      provider: model.provider,
    });
    if (attachedViews.length) {
      const completedAt = new Date().toISOString();
      await Promise.all(attachedViews.map((view) => persistGraphViewOnPython({
        ...view,
        status: result.ok ? 'consumed' : 'failed',
        invocationId: result.correlationId,
        updatedAt: completedAt,
      })));
    }
    let returnedGraphView: GraphView | null = null;
    // A successful read-only audit publishes its filtered CodeGraph view for the
    // frontend to focus the existing CodeGraphSurface on the audited branch.
    if (result.ok && result.resultKind === 'audit' && result.report) {
      const audit = result.report as Record<string, unknown>;
      setLatestCoderAuditView({
        projectId,
        conversationId,
        childRunId: result.childRunId,
        correlationId: result.correlationId,
        conclusion: String(audit.conclusion ?? ''),
        repositoryIdentity: String(audit.repositoryIdentity ?? ''),
        revision: String(audit.revision ?? ''),
        freshness: String(audit.freshness ?? ''),
        codeGraphQuery: String(audit.codeGraphQuery ?? ''),
        codeGraphNodeRefs: Array.isArray(audit.codeGraphNodeRefs) ? audit.codeGraphNodeRefs.map(String) : [],
        viewContract: (audit.viewContract ?? {}) as CodeGraphViewContractResult,
        transcriptArtifact: result.transcriptArtifact ?? null,
      });
      const includedCanonicalNodeIds = Array.isArray(audit.codeGraphNodeRefs) ? audit.codeGraphNodeRefs.map(String).filter(Boolean) : [];
      const now = new Date().toISOString();
      [returnedGraphView] = parseGraphViews([{
        schemaVersion: 'graph-view.v1',
        viewId: `codegraph:return:${result.childRunId}`,
        authority: 'codegraph',
        status: 'returned',
        projectId,
        conversationId,
        jobId: result.childRunId,
        invocationId: result.correlationId,
        producingRole: 'coder',
        receivingRole: 'main_chat',
        rootCanonicalNodeIds: includedCanonicalNodeIds.slice(0, 3),
        includedCanonicalNodeIds,
        includedRelationships: [],
        records: includedCanonicalNodeIds.map((canonicalId) => ({
          canonicalId,
          summary: `${canonicalId} was selected by the live Coder CodeGraph audit.`,
          selectionReason: String(audit.codeGraphQuery || 'Selected by Coder inspection'),
          provenanceRefs: Array.isArray(audit.files) ? audit.files.map(String).slice(0, 12) : [],
        })),
        query: String(audit.codeGraphQuery || ''),
        filter: {
          nodeTypes: Array.isArray((audit.viewContract as any)?.nodeLabelAllowlist) ? (audit.viewContract as any).nodeLabelAllowlist : [],
          trustStates: [],
        },
        hopDepth: 0,
        provenanceRefs: [result.transcriptArtifact, ...(Array.isArray(audit.files) ? audit.files.map(String) : [])].filter((value): value is string => Boolean(value)).slice(0, 40),
        note: String(audit.conclusion || ''),
        parentViewId: attachedViews[0]?.viewId,
        omittedNeighborCount: 0,
        createdAt: now,
        updatedAt: now,
      }], { projectId, conversationId }, 'returned');
      await persistGraphViewOnPython(returnedGraphView);
    }
    return res.status(result.ok ? 200 : 502).json({ ...result, graphView: returnedGraphView });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'run_coder_subagent_failed' });
  }
});

// ── Main Chat ThinkGraph structured update (canonical writer, minted authority) ─
// The model supplies ONLY the bounded structured update; the server mints the
// authority from the live Main Chat card + real conversation. Same validation and
// same one applyThinkGraphPatch writer as the ThinkGraph card path.
router.post('/mcp-bridge/thinkgraph_submit_update', async (req, res) => {
  const startedMs = Date.now();
  const projectId = String(req.body?.projectId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  try {
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
    if (!conversationId) return res.status(400).json({ ok: false, error: 'conversationId_required' });
    const mainCardId = await resolveMainChatCardId(projectId, BUILDER_DECK_ID);
    if (!mainCardId) return res.status(409).json({ ok: false, error: 'main_chat_card_not_found' });
    const authority: ThinkGraphPatchAuthority = {
      projectId,
      cardId: mainCardId,
      correlationId: `main_update_${Date.now()}_${randomUUID().slice(0, 8)}`,
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
      caller: 'main_chat',
      projectId,
      deckId: BUILDER_DECK_ID,
      conversationId,
      correlationId: authority.correlationId,
      cardId: mainCardId,
      inputSummary: 'main_chat thinkgraph_submit_update',
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
    const canonicalRefs = [...new Set<string>(
      (Array.isArray(req.body?.canonicalRefs) ? req.body.canonicalRefs : [])
        .map((value: unknown): string => String(value || '').trim().replace(/^code:/, ''))
        .filter((value: string) => Boolean(value)),
    )].slice(0, 20);
    const projectId = String(req.body?.projectId || '').trim();
    const conversationId = String(req.body?.conversationId || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'query_required' });
    if (!projectId || !conversationId) return res.status(400).json({ ok: false, error: 'projectId_and_conversationId_required' });
    const limit = Math.min(Math.max(Number(req.body?.limit) || 15, 1), 50);
    session = await createCodebaseMemoryMcpCaller(process.cwd());
    const projectList = await session.callTool('list_projects', {});
    const projects = Array.isArray((projectList as any).projects) ? (projectList as any).projects : [];
    const cbmProject = String(projects[0]?.name || '').trim();
    if (!cbmProject) return res.json({ ok: false, error: 'cbm_no_indexed_project' });
    const exactQualifiedNames = canonicalRefs.length > 0
      ? `^(?:${canonicalRefs.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
      : null;
    const result = await session.callTool('search_graph', exactQualifiedNames
      ? { project: cbmProject, qn_pattern: exactQualifiedNames, limit }
      : { project: cbmProject, query, limit });
    const matches = Array.isArray((result as any)?.results) ? (result as any).results : [];
    const includedCanonicalNodeIds = matches.map((match: any) => String(match?.qualified_name || match?.name || '')).filter(Boolean);
    const now = new Date().toISOString();
    const viewIdentity = createHash('sha256').update(JSON.stringify({
      projectId,
      conversationId,
      receivingRole: String(req.body?.receivingRole || 'main_chat'),
      parentViewId: String(req.body?.parentViewId || '').trim(),
      includedCanonicalNodeIds,
    })).digest('hex').slice(0, 24);
    const [graphView] = parseGraphViews([{
      schemaVersion: 'graph-view.v1',
      authority: 'codegraph',
      viewId: `codegraph:${viewIdentity}`,
      status: 'returned',
      producingRole: String(req.body?.producingRole || 'coder'),
      receivingRole: String(req.body?.receivingRole || 'main_chat'),
      rootCanonicalNodeIds: includedCanonicalNodeIds.slice(0, 3),
      includedCanonicalNodeIds,
      includedRelationships: [],
      query,
      filter: { nodeTypes: [], trustStates: [] },
      hopDepth: Math.min(6, Math.max(0, Number(req.body?.hopDepth) || 0)),
      provenanceRefs: [...new Set(matches.map((match: any) => String(match?.file_path || '')).filter(Boolean))],
      note: String(req.body?.note || '').trim(),
      parentViewId: String(req.body?.parentViewId || '').trim(),
      records: matches.map((match: any) => ({
        canonicalId: String(match?.qualified_name || match?.name || ''),
        summary: [String(match?.name || ''), String(match?.label || ''), String(match?.file_path || '')].filter(Boolean).join(' · '),
        selectionReason: `Matched CodeGraph inspection query: ${query}`,
        ...(Number.isFinite(match?.rank) ? { relevance: Number(match.rank) } : {}),
        provenanceRefs: [String(match?.file_path || '')].filter(Boolean),
      })),
      omittedNeighborCount: Math.max(0, Number((result as any)?.total || matches.length) - matches.length),
      createdAt: now,
      updatedAt: now,
    }], { projectId, conversationId }, 'returned');
    return res.json({ ok: true, cbmProject, result, graphView });
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
    if (documents.length === 0) return res.status(400).json({ ok: false, error: 'documents_required' });
    // Same-process call into the canonical gateway logic via HTTP keeps ONE
    // authority for KNOWGRAPH_URL resolution and pipeline error shaping.
    const port = Number(process.env.PORT || 4000);
    const axios = (await import('axios')).default;
    const response = await axios.post(
      `http://127.0.0.1:${port}/api/knowgraph/ingest_web`,
      {
        project_id: projectId,
        // Project identity is trusted transport scope, not source content. The
        // canonical web-ingest request validates it on every selected document.
        documents: documents.map((document: Record<string, unknown>) => ({ ...document, project_id: projectId })),
        ...(req.body?.researchFocus ? { research_focus: req.body.researchFocus } : {}),
      },
      { timeout: 300_000, validateStatus: () => true },
    );
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'knowgraph_ingest_failed' });
  }
});

async function forwardKnowGraphAnalysis(
  method: 'get' | 'post',
  pathname: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const port = Number(process.env.PORT || 4000);
  const axios = (await import('axios')).default;
  const response = await axios.request({
    method,
    url: `http://127.0.0.1:${port}/api/knowgraph${pathname}`,
    data: body,
    timeout: 300_000,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

router.post('/mcp-bridge/knowgraph_analyze_scope', async (req, res) => {
  try {
    const response = await forwardKnowGraphAnalysis('post', '/analysis/analyze', req.body?.request);
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'knowgraph_analysis_failed' });
  }
});

router.post('/mcp-bridge/knowgraph_get_analysis', async (req, res) => {
  try {
    const analysisId = String(req.body?.analysisId || '').trim();
    if (!analysisId) return res.status(400).json({ ok: false, error: 'analysisId_required' });
    const response = await forwardKnowGraphAnalysis('get', `/analysis/${encodeURIComponent(analysisId)}`);
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'knowgraph_analysis_read_failed' });
  }
});

router.post('/mcp-bridge/knowgraph_compare_providers', async (req, res) => {
  try {
    const response = await forwardKnowGraphAnalysis('post', '/analysis/compare', {
      request: req.body?.request,
      external_provider_permission: req.body?.externalProviderPermission === true,
      persist: req.body?.persist !== false,
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'knowgraph_provider_comparison_failed' });
  }
});

for (const detail of ['topics', 'gateways', 'gaps'] as const) {
  router.post(`/mcp-bridge/knowgraph_get_${detail}`, async (req, res) => {
    try {
      const analysisId = String(req.body?.analysisId || '').trim();
      if (!analysisId) return res.status(400).json({ ok: false, error: 'analysisId_required' });
      const response = await forwardKnowGraphAnalysis('get', `/analysis/${encodeURIComponent(analysisId)}/${detail}`);
      return res.status(response.status).json(response.data);
    } catch (error) {
      return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : `knowgraph_${detail}_read_failed` });
    }
  });
}

router.post('/mcp-bridge/knowgraph_create_analysis_view', async (req, res) => {
  try {
    const response = await forwardKnowGraphAnalysis('post', '/analysis-view', {
      analysis_id: req.body?.analysisId,
      project_id: req.body?.projectId,
      producing_invocation: req.body?.producingInvocation,
      parent_view_id: req.body?.parentViewId || null,
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'knowgraph_analysis_view_failed' });
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

router.post('/mcp-bridge/hermes_write_report', (req, res) => {
  try {
    const completion = writeActiveHermesReport(req.body || {});
    return res.json({ ok: true, ...completion });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'hermes_report_write_failed';
    return res.status(reason === 'hermes_investigation_context_not_active' ? 409 : 400).json({
      ok: false,
      error: reason,
    });
  }
});

router.post('/mcp-bridge/hermes_read_report', (req, res) => {
  try {
    return res.json({ ok: true, report: readActiveHermesReport(String(req.body?.parentRunId || '')) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'hermes_report_read_failed';
    return res.status(reason === 'hermes_investigation_context_not_active' ? 409 : 400).json({ ok: false, error: reason });
  }
});

router.get('/hermes/report', (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const conversationId = String(req.query?.conversationId || 'main').trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  return res.json({ ok: true, report: readLatestHermesReport(projectId, conversationId) });
});

// Latest filtered CodeGraph view from a direct_main_audit run, for the frontend
// to focus the existing CodeGraphSurface on the audited branch.
router.get('/coder-audit-view', (req, res) => {
  const projectId = String(req.query?.projectId || '').trim();
  const conversationId = String(req.query?.conversationId || 'main').trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId_required' });
  return res.json({ ok: true, view: getLatestCoderAuditView(projectId, conversationId) });
});

// ── Editable prompt lifecycle: draft → revise → approve → publish prompt.md ────
// Main Chat owns the approved prompt; an unapproved prompt never reaches the
// handoff artifact. Prompt BODY stays in the Markdown file; lineage goes to
// ThinkGraph via the episode contract.
const PROMPT_SOURCES: readonly PromptSource[] = ['main_chat', 'coder', 'hermes'];
router.post('/prompt-draft', (req, res) => {
  try {
    const body = req.body || {};
    const draft = createPromptDraft({
      jobId: String(body.jobId || ''),
      projectId: String(body.projectId || ''),
      conversationId: String(body.conversationId || 'main'),
      markdown: String(body.markdown || ''),
      source: PROMPT_SOURCES.includes(body.source) ? (body.source as PromptSource) : undefined,
      goalId: typeof body.goalId === 'string' ? body.goalId : null,
      codeGraphRefs: Array.isArray(body.codeGraphRefs) ? body.codeGraphRefs.map(String) : undefined,
      knowGraphRefs: Array.isArray(body.knowGraphRefs) ? body.knowGraphRefs.map(String) : undefined,
      thinkGraphRefs: Array.isArray(body.thinkGraphRefs) ? body.thinkGraphRefs.map(String) : undefined,
    });
    return res.json({ ok: true, draft });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'prompt_draft_failed' });
  }
});
router.post('/prompt-draft/:jobId/approve', (req, res) => {
  try {
    return res.json({ ok: true, draft: approvePromptDraft(String(req.params.jobId)) });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'prompt_approve_failed' });
  }
});
router.post('/prompt-draft/:jobId/publish', (req, res) => {
  try {
    return res.json({ ok: true, draft: publishApprovedPrompt(String(req.params.jobId)) });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'prompt_publish_failed' });
  }
});
router.get('/prompt-draft/:jobId', (req, res) => {
  const draft = getPromptDraft(String(req.params.jobId));
  if (!draft) return res.status(404).json({ ok: false, error: `prompt_draft_not_found: ${req.params.jobId}` });
  return res.json({ ok: true, draft });
});

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
  let investigationContext: HermesInvestigationContext;
  try {
    investigationContext = parseHermesInvestigationContext(
      req.body?.investigationContext,
      projectId,
      conversationId,
    );
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'turn_context_invalid',
    });
  }
  // Graph context: the browser is a renderer, never the transport for graph
  // membership. The chat request carries projection IDENTITY only; the server
  // resolves the persisted projection and derives the compact model
  // representation. A request still carrying view content is rejected — no
  // silent browser-payload fallback.
  if (req.body?.graphViews !== undefined) {
    return res.status(400).json({
      ok: false,
      error: 'browser_graph_views_removed: send projectionId (+activeGraphViewId) — the server resolves graph context',
    });
  }
  const projectionId = String(req.body?.projectionId || '').trim();
  const activeGraphViewId = String(req.body?.activeGraphViewId || '').trim();
  const knowgraphScope = String(req.body?.knowgraphScope || '').trim();
  const sessionId = deriveSessionId(projectId, conversationId);
  // One correlation id per turn for the concise backend trace. This does NOT change
  // the SSE stream or browser behavior — it only makes the real Harness events
  // (already flowing to the browser) legible in the backend dev terminal.
  const correlationId = `req_${randomUUID().slice(0, 8)}`;
  let graphViews: GraphView[] = [];
  let graphContext = '';
  let graphContextMeasurements: unknown = null;
  let selectedGraphObjectRefs: ReturnType<typeof parseGraphObjectRefs>;
  try {
    selectedGraphObjectRefs = parseGraphObjectRefs(req.body?.selectedGraphObjectRefs);
    if (selectedGraphObjectRefs.length) await getDeckDocument(projectId, BUILDER_DECK_ID);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'selected_graph_object_refs_invalid',
    });
  }
  if (projectionId) {
    try {
      const resolved = (await fetchUnifiedModelContext({
        projectionId,
        projectId,
        conversationId,
        role: 'main_chat',
        activeGraphViewId: activeGraphViewId || undefined,
        knowgraphScope: knowgraphScope || undefined,
      })) as { graphViews?: unknown; modelContext?: unknown; measurements?: unknown };
      graphViews = parseGraphViews(resolved?.graphViews, { projectId, conversationId });
      graphContext = String(resolved?.modelContext || '');
      graphContextMeasurements = resolved?.measurements ?? null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'projection_resolution_failed';
      // 409 = the persistent graphs moved since the human looked (superseded) —
      // the client refetches Unified and resends. Anything else is a real
      // resolution failure. Never proceed with different context silently.
      return res
        .status(reason.includes('thinkgraph_http_409') ? 409 : 502)
        .json({ ok: false, error: reason, projectionId });
    }
  }
  if (selectedGraphObjectRefs.length) {
    try {
      const objectContext = await resolveSelectedGraphObjectContext({
        projectId,
        conversationId,
        references: selectedGraphObjectRefs,
      });
      if (objectContext) {
        graphContext = [graphContext, objectContext.modelContext].filter(Boolean).join('\n\n');
        graphContextMeasurements = graphContextMeasurements
          ? { projection: graphContextMeasurements, selectedObjects: objectContext.measurements }
          : { selectedObjects: objectContext.measurements };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'graph_object_resolution_failed';
      return res.status(reason.includes('http_409') || reason.includes('not_visible') ? 409 : 502).json({
        ok: false,
        error: reason,
      });
    }
  }
  // Compact Graph View lifecycle announcements for the browser: identity and
  // status ONLY — the UI discovers contents by refetching its server-owned
  // projection, never from event payloads (browser is not a membership carrier).
  const compactGraphViewEvent = (views: GraphView[]) => ({
    views: views.map((view) => ({
      viewId: view.viewId,
      status: view.status,
      authority: view.authority,
      producingRole: view.producingRole,
      receivingRole: view.receivingRole,
      ...(view.invocationId ? { invocationId: view.invocationId } : {}),
      ...(view.parentViewId ? { parentViewId: view.parentViewId } : {}),
    })),
  });
  // Bind this turn's Hermes report lifecycle to the run (parentRunId = correlationId)
  // so a mid-turn hermes.write_report attaches to THIS focused branch — the 0-caller
  // lifecycle is now driven. Best-effort: a lifecycle hiccup never breaks the stream.
  try {
    beginHermesInvestigation(correlationId, investigationContext);
  } catch (error) {
    logHarnessTrace(
      `[harness] hermes investigation begin skipped corr=${correlationId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
    );
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
    metadata: {
      surfaceMode: mode,
      sessionId,
      ...(projectionId ? { projectionId } : {}),
      ...(selectedGraphObjectRefs.length ? { selectedGraphObjectCount: selectedGraphObjectRefs.length } : {}),
      ...(graphContextMeasurements ? { graphContextMeasurements } : {}),
    },
  });
  if (graphContext) {
    // The exact measured graph-context cost of THIS turn, visible to the
    // browser before the model even answers — counting, not enforcement.
    writeSse('context_measurement', {
      projectionId: projectionId || null,
      characters: graphContext.length,
      measurements: graphContextMeasurements,
    });
  }
  // Durable project-scoped transcript persistence (conversations/store.ts). Best-effort:
  // a DB failure must never block or break the live SSE stream.
  void appendMessage({ projectId, conversationId, role: 'user', content: message }).catch(() => null);
  let turnFinished = false;
  let activeRuntimeViews: GraphView[] = [];
  const pendingGraphViewWrites: Promise<void>[] = [];
  const hermesToolUseIds = new Set<string>();
  const hermesStartedAt = new Map<string, number>();
  // Durable caller attribution for LiquidAIty MCP actions: one card_call event
  // pair (started/completed) per mcp__liquidaity__* invocation, carrying the
  // engine-supplied invokingCardId from the tool_start event — the record that
  // proves WHICH card (Main Chat vs a doorway child) performed the action.
  const liquidaityCallByToolUse = new Map<string, { invokingCardId: string; toolName: string; startedMs: number }>();
  try {
    const handle = await startGrpcTurn({
      sessionId,
      message,
      workingDirectory,
      mode,
      traceId: correlationId,
      investigationContext,
      graphViews,
      graphContext,
    }, async (event) => {
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
        if (!event.isError) {
          try {
            const payload = JSON.parse(String(event.output || '{}')) as Record<string, unknown>;
            const rawView = payload.graphView;
            if (rawView) {
              const returned = parseGraphViews([rawView], { projectId, conversationId }, 'returned')[0];
              const write = persistGraphViewOnPython(returned).then(() => {
                writeSse('graph_view', compactGraphViewEvent([returned]));
              });
              pendingGraphViewWrites.push(write);
            }
          } catch {
            // A normal tool result may be prose or a non-view JSON payload.
          }
        }
      }
      if (event.kind === 'tool_start' && event.toolName === 'Agent') {
        try {
          const input = JSON.parse(event.argsJson || '{}') as Record<string, unknown>;
          if (input.subagent_type === 'card_hermes_steward') {
            // Canvas authority gate: Hermes requires a hermes_observe edge
            // from an authorized card in the saved deck. Prompt text cannot
            // bypass missing topology. Disconnected = no spawn.
            // Deck is loaded lazily; a missing/unreadable deck means no authority.
            let hermesEdge: any = null;
            try {
              const chk = await getDeckDocument(projectId, BUILDER_DECK_ID);
              hermesEdge = (chk?.deck as any)?.edges?.find(
                (e: any) => e.edgeType === 'hermes_observe' && e.target === 'card_hermes_steward',
              );
            } catch { /* deck unreadable = no authority */ }
            if (!hermesEdge) {
              logHarnessTrace(
                `[harness] hermes blocked corr=${correlationId} reason=no_hermes_observe_edge`,
              );
              return; // skip this tool_start — no spawn without authority
            }
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
        // hermes_postflight is NOT emitted here. It requires:
        // 1) real completed source run, 2) readable run manifest,
        // 3) actual Hermes invocation, 4) review result, 5) Hermes-owned
        // review artifact, 6) artifact readback, 7) event ref to that artifact.
        // Until all seven are met, the stage chip is honestly absent.
      }
      // Backend trace of the REAL event (only when it carries lifecycle signal),
      // then the unchanged SSE forward to the browser.
      const traceLine = formatHarnessTrace(event, correlationId);
      if (traceLine) logHarnessTrace(traceLine);
      writeSse(event.kind, event);
    });
    if (handle.runtimeGraphViews.length > 0) {
      activeRuntimeViews = handle.runtimeGraphViews;
      await Promise.all(activeRuntimeViews.map((view) => persistGraphViewOnPython(view)));
      writeSse('graph_view', compactGraphViewEvent(handle.runtimeGraphViews));
    }
    activeGrpcTurns.set(sessionId, handle);
    req.on('close', () => {
      if (turnFinished) return;
      handle.cancel();
      activeGrpcTurns.delete(sessionId);
    });
    const { finalText, usage } = await handle.done;
    await Promise.all(pendingGraphViewWrites);
    if (activeRuntimeViews.length > 0) {
      const consumedViews = completeGraphViews(activeRuntimeViews);
      await Promise.all(consumedViews.map((view) => persistGraphViewOnPython(view)));
      writeSse('graph_view', compactGraphViewEvent(consumedViews));
    }
    turnFinished = true;
    logHarnessTrace(
      `[harness] request completed corr=${correlationId} providerUsage=${usage.usageAvailable ? `${usage.providerInputTokens}in/${usage.providerOutputTokens}out (${usage.usageSource})` : 'unavailable'} cost=${usage.totalCostUsd ?? 'unavailable'} contextBreakdown=${usage.contextBreakdownJson ? 'present' : 'unavailable'}`,
    );
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
      // Provider-reported usage (null = provider did not report — never a
      // fake zero) + the engine's own per-component context ESTIMATES.
      metadata: {
        providerUsage: {
          inputTokens: usage.providerInputTokens,
          outputTokens: usage.providerOutputTokens,
          totalCostUsd: usage.totalCostUsd,
          usageAvailable: usage.usageAvailable,
          usageSource: usage.usageSource,
        },
        ...(usage.contextBreakdownJson ? { contextBreakdownJson: usage.contextBreakdownJson } : {}),
      },
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
    try {
      endHermesInvestigation(correlationId);
    } catch {
      /* investigation already cleared — never block turn teardown */
    }
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


/** Resolve the saved Main Chat card from the live deck (binding, never a title
 * match) so the canonical ThinkGraph writer has truthful provenance. */
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
