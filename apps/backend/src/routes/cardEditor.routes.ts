import { Router, type Request } from 'express';
import { createHash } from 'crypto';
import { getDeckDocument } from '../decks/deckDomainClient';
import { getOwnedProjectByReference } from '../services/projectStore';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { listToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import {
  indexLiveToolCatalog,
  resolveScriptToolDefinitions,
  searchToolCatalogDefinitions,
  type ToolCatalogDefinition,
} from '../cards/toolCatalogProjection';
import { autoModelCandidates, listConfiguredModelOptions } from '../llm/models.config';

const router = Router();
export const iddRoutes = Router();
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'blocked', 'cancelled']);

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function elapsedMilliseconds(run: Record<string, any>): number | null {
  const start = Date.parse(String(run.startedAt || ''));
  const end = Date.parse(String(run.finishedAt || ''));
  if (!Number.isFinite(start)) return null;
  return Math.max(0, (Number.isFinite(end) ? end : Date.now()) - start);
}

function runMetricsProjection(run: Record<string, any> | undefined) {
  if (!run) return null;
  const costUsd = finiteNumber(run.costUsd);
  const providerCostStatus = String(run.costStatus || '').trim();
  const costStatus = ['actual', 'estimated', 'included'].includes(providerCostStatus)
    ? providerCostStatus
    : 'unavailable';
  return {
    state: String(run.state || ''),
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : null,
    model: typeof run.model === 'string' ? run.model : null,
    elapsedMs: elapsedMilliseconds(run),
    inputTokens: finiteNumber(run.inputTokens),
    outputTokens: finiteNumber(run.outputTokens),
    cachedTokens: finiteNumber(run.cachedTokens),
    reasoningTokens: finiteNumber(run.reasoningTokens),
    totalTokens: finiteNumber(run.providerTotalTokens),
    costUsd,
    costStatus,
    toolCallCount: finiteNumber(run.toolCallCount),
    autoToolsDecision: objectValue(run.autoToolsDecision),
    autoModelDecision: objectValue(run.autoModelDecision),
  };
}

function magneticTaskMetrics(value: Record<string, any>): {
  tasksCompleted: number | null;
  tasksTotal: number | null;
  activeWorkers: number | null;
} {
  if (!Array.isArray(value.hermesTasks)) {
    return { tasksCompleted: null, tasksTotal: null, activeWorkers: null };
  }
  const rootId = String(value.hermesRootId || '').trim();
  const tasks = value.hermesTasks.map(objectValue);
  return {
    tasksCompleted: tasks.filter((task) => String(task.status || '').trim() === 'done').length,
    tasksTotal: tasks.length,
    activeWorkers: tasks
      .filter((task) => (
        String(task.taskId || '').trim() !== rootId
        && String(task.status || '').trim() === 'running'
      )).length,
  };
}

function magneticFailure(value: Record<string, any>, state: string): {
  errorCode?: string;
  errorSummary?: string;
} {
  if (state === 'completed') return {};
  const summary = String(value.error || '').trim();
  const code = /^([a-z][a-z0-9_]{2,120})(?::|$)/.exec(summary)?.[1]
    || `magnetic_taskgraph_${state}`;
  return { errorCode: code, errorSummary: summary || code };
}

async function reconcileMagneticRunState(
  latest: Record<string, any>,
  magnetic: Record<string, any>,
  metrics: ReturnType<typeof magneticTaskMetrics>,
): Promise<string> {
  const persistedState = String(latest.state || '').trim();
  const observedState = String(magnetic.state || '').trim();
  if (TERMINAL_RUN_STATES.has(persistedState)) {
    return persistedState;
  }
  if (!TERMINAL_RUN_STATES.has(observedState)) {
    const visibleState = String(magnetic.hermesStatus || '').trim() === 'running'
      || (metrics.activeWorkers !== null && metrics.activeWorkers > 0)
      ? 'running'
      : 'pending';
    if (visibleState === 'running') {
      const progress = objectValue(await requestPythonRailsJson('/domain/runs/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: String(latest.runId || ''),
          hermesRootId: String(magnetic.hermesRootId || '').trim(),
          hermesRunId: magnetic.hermesRunId,
          hermesStatus: String(magnetic.hermesStatus || '').trim(),
          tasksCompleted: metrics.tasksCompleted,
          tasksTotal: metrics.tasksTotal,
          activeWorkers: metrics.activeWorkers,
        }),
      }));
      if (
        progress.ok !== true
        || String(progress.runId || '') !== String(latest.runId || '')
        || String(progress.hermesRootId || '') !== String(magnetic.hermesRootId || '')
      ) {
        throw new Error('magnetic_taskgraph_outer_run_progress_invalid');
      }
    }
    return visibleState;
  }
  if (!['pending', 'running'].includes(persistedState)) return persistedState;
  const settled = objectValue(await requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: String(latest.runId || ''),
      state: observedState,
      finalResult: observedState === 'completed' ? magnetic.finalResult : undefined,
      ...magneticFailure(magnetic, observedState),
      providerThreadRef: String(magnetic.hermesRootId || '').trim() || undefined,
      providerTurnRef: String(magnetic.hermesRunId || '').trim() || undefined,
      hermesStatus: String(magnetic.hermesStatus || '').trim() || undefined,
      tasksCompleted: metrics.tasksCompleted,
      tasksTotal: metrics.tasksTotal,
      activeWorkers: metrics.activeWorkers,
    }),
  }));
  const runRecord = objectValue(settled.runRecord);
  const settledState = String(runRecord.state || settled.state || '').trim();
  if (
    settled.ok !== true
    || String(settled.runId || '') !== String(latest.runId || '')
    || !TERMINAL_RUN_STATES.has(settledState)
  ) {
    throw new Error('magnetic_taskgraph_outer_run_settlement_invalid');
  }
  return settledState;
}

async function authorizeCardProject(req: Request, projectId: string): Promise<boolean> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) return false;
  const project = await getOwnedProjectByReference(projectId, userId);
  return Boolean(project && project.ownerUserId === userId);
}

function safeToolCatalogFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const match = /^([a-z][a-z0-9_]{2,80})(?::\s*([A-Za-z0-9_.:-]{1,160}))?/.exec(message);
  return match ? [match[1], match[2]].filter(Boolean).join(':') : 'tool_catalog_read_failed';
}

function commaSeparatedIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
}

export async function loadLiveToolCatalog() {
  const canonicalMcpTools = await listToolCatalog();
  const materialized = await requestPythonRailsJson('/tools/catalog/definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerTools: canonicalMcpTools }),
  }) as { references?: unknown };
  if (!Array.isArray(materialized?.references)) {
    throw new Error('live_tool_catalog_invalid');
  }
  return indexLiveToolCatalog(materialized.references as ToolCatalogDefinition[]);
}

async function cardCatalogOptions(projectId: string, deckId: string, cardId: string) {
  if (!projectId || !deckId || !cardId) return { catalogOptions: [], selectedIds: [] };
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = deck?.nodes.find((node) => node.id === cardId);
  if (!deck || !card) throw new Error('card_not_found');
  const saved = card.runtimeOptions || {};
  const selectedIds = [card.templateId, ...(saved.tools || []),
    ...(saved.skills || []).map((name) => 'skill:' + name),
    ...(saved.toolsets || []).map((name) => 'toolset:' + name),
    ...(saved.mcpConnectionIds || []).map((name) => 'mcp:' + name),
    ...(saved.provider && saved.modelKey ? ['model:' + saved.provider + ':' + saved.modelKey] : []),
  ].filter((value): value is string => typeof value === 'string' && Boolean(value));
  const catalog = await loadLiveToolCatalog();
  return {
    catalogOptions: catalog.references,
    selectedIds: [...new Set(selectedIds)],
  };
}

router.get('/options', async (_req, res) => {
  try {
    const options = await requestPythonRailsJson('/card-editor/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: listConfiguredModelOptions(process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna'),
      }),
    }) as Record<string, unknown>;
    if (!Array.isArray(options?.fields) || !options.catalogs || typeof options.catalogs !== 'object') {
      throw new Error('runtime_options_invalid');
    }
    return res.json({
      ok: true,
      fields: options.fields,
      catalogs: options.catalogs,
      autoModelCandidates,
    });
  } catch {
    return res.status(503).json({ ok: false, error: 'runtime_options_unavailable' });
  }
});

router.post('/runs/read', async (req, res) => {
  const action = String(req.body?.action || '').trim();
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const cardId = String(req.body?.cardId || '').trim();
  if (!projectId || !deckId || !cardId) {
    return res.status(400).json({ ok: false, error: 'card_run_identity_incomplete' });
  }
  if (!['history', 'status'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'card_run_read_action_required' });
  }
  if (action === 'status' && req.body?.inspectOnly !== true) {
    return res.status(400).json({ ok: false, error: 'card_run_status_must_be_inspect_only' });
  }
  try {
    if (!(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({ ok: false, error: 'card_run_project_access_denied' });
    }
    const rawLimit = action === 'history' ? Number(req.body?.limit || 1) : 1;
    const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(20, rawLimit)) : 1;
    const history = objectValue(await requestPythonRailsJson('/domain/runs/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, cardId, limit }),
    }));
    const runs = Array.isArray(history.runs) ? history.runs.map(objectValue) : [];
    const latest = runs[0];
    if (action === 'history') {
      return res.json({
        ok: true,
        result: { cardId, latest: runMetricsProjection(latest) },
      });
    }
    if (!latest) return res.json({ ok: true, result: null });
    const hermesRootId = String(latest.hermesRootId || '').trim();
    if (String(latest.runtimeMode || '') === 'magentic_one' && hermesRootId) {
      const magnetic = objectValue(await requestPythonRailsJson('/magnetic/taskgraph/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hermesRootId }),
      }));
      const metrics = magneticTaskMetrics(magnetic);
      const state = await reconcileMagneticRunState(latest, magnetic, metrics);
      return res.json({
        ok: true,
        result: {
          ...magnetic,
          runId: String(latest.runId || ''),
          cardId,
          state,
          activeWorkers: metrics.activeWorkers,
        },
      });
    }
    return res.json({
      ok: true,
      result: {
        cardId,
        runId: String(latest.runId || ''),
        state: String(latest.state || ''),
        activeWorkers: finiteNumber(latest.activeWorkers),
      },
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_run_read_failed',
    });
  }
});

iddRoutes.get('/card-editor', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '').trim();
    if (projectId && !(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({
        ok: false,
        error: 'card_editor_project_access_denied',
      });
    }
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const materialized = await requestPythonRailsJson('/idd/card-editor/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: listConfiguredModelOptions(openaiDefault),
        ...await cardCatalogOptions(
          projectId, String(req.query.deckId || ''), String(req.query.cardId || ''),
        ),
      }),
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
  } catch (error) {
    const reason = safeToolCatalogFailureReason(error);
    console.warn(`[idd-card-editor] catalog unavailable reason=${reason}`);
    return res.status(503).json({
      ok: false,
      error: 'input_data_dictionary_card_editor_unavailable',
      reason,
      fields: [],
      catalogs: { 'configured-models': [] },
    });
  }
});

iddRoutes.get('/tools', async (req, res) => {
  try {
    const catalog = await loadLiveToolCatalog();
    const selectedIds = commaSeparatedIds(req.query.selectedIds);
    return res.json({
      ok: true,
      ...searchToolCatalogDefinitions(catalog, {
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
  } catch (error) {
    const reason = safeToolCatalogFailureReason(error);
    console.warn(`[idd-tools] catalog unavailable reason=${reason}`);
    return res.status(503).json({
      ok: false,
      error: 'builder_tool_projection_unavailable',
      reason,
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

function scriptPaletteFingerprint(definitions: ToolCatalogDefinition[]): string {
  return createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
}

iddRoutes.get('/script-tools', async (req, res) => {
  try {
    const catalog = await loadLiveToolCatalog();
    const references = resolveScriptToolDefinitions(catalog, {
      selectedIds: commaSeparatedIds(req.query.selectedIds),
    });
    const referenceIds = new Set(references.map((reference) => reference.canonicalId));
    const defaultAgentTools = commaSeparatedIds(req.query.selectedIds)
      .filter((canonicalId) => referenceIds.has(canonicalId));
    const paletteFingerprint = scriptPaletteFingerprint(references);
    const header = await requestPythonRailsJson('/card-script/header', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogTools: catalog.references,
        selectedTools: references.map((reference) => reference.canonicalId),
        defaultAgentTools,
        cardId: typeof req.query.cardId === 'string' ? req.query.cardId : '',
      }),
    });
    return res.json({ ok: true, references, paletteFingerprint, header });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_script_tools_unavailable',
      references: [],
      paletteFingerprint: '',
      header: null,
    });
  }
});

router.post('/script/validate', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const selectedToolIds: string[] = Array.isArray(body.selectedTools)
      ? body.selectedTools.map((value: unknown) => String(value))
      : [];
    const catalog = await loadLiveToolCatalog();
    const references = resolveScriptToolDefinitions(catalog, {
      selectedIds: selectedToolIds,
    });
    const referenceIds = new Set(references.map((reference) => reference.canonicalId));
    const defaultAgentTools = selectedToolIds
      .filter((canonicalId) => referenceIds.has(canonicalId));
    const paletteFingerprint = scriptPaletteFingerprint(references);
    const script = await requestPythonRailsJson('/card-script/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: body.script,
        selectedTools: references.map((reference) => reference.canonicalId),
        defaultAgentTools,
        paletteFingerprint,
      }),
    });
    return res.json({ ok: true, script, references, paletteFingerprint });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_script_validation_failed',
    });
  }
});

export default router;
