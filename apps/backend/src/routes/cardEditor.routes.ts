import { Router, type Request } from 'express';
import { createHash } from 'crypto';
import { getDeckDocument } from '../decks/store';
import { getProject } from '../services/projectStore';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { listToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import {
  indexLiveToolCatalog,
  resolveScriptToolDefinitions,
  searchToolCatalogDefinitions,
  type ToolCatalogDefinition,
} from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';

const router = Router();
export const iddRoutes = Router();

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function elapsedMilliseconds(run: Record<string, any>): number | null {
  const start = Date.parse(String(run.startedAt || run.acceptedAt || ''));
  const end = Date.parse(String(run.finishedAt || ''));
  if (!Number.isFinite(start)) return null;
  return Math.max(0, (Number.isFinite(end) ? end : Date.now()) - start);
}

function runMetricsProjection(run: Record<string, any> | undefined) {
  if (!run) return null;
  const tokenValues = [
    run.inputTokens,
    run.outputTokens,
    run.cachedTokens,
    run.reasoningTokens,
  ].map(finiteNumber);
  const totalTokens = tokenValues.some((value) => value !== null)
    ? tokenValues.reduce<number>((sum, value) => sum + (value || 0), 0)
    : null;
  const costUsd = finiteNumber(run.costUsd);
  return {
    state: String(run.state || ''),
    acceptedAt: typeof run.acceptedAt === 'string' ? run.acceptedAt : null,
    model: typeof run.model === 'string' ? run.model : null,
    elapsedMs: elapsedMilliseconds(run),
    totalTokens,
    costUsd,
    costStatus: costUsd === null ? 'unavailable' : 'estimated',
    toolCallCount: finiteNumber(run.toolCallCount),
  };
}

async function authorizeCardProject(req: Request, projectId: string): Promise<boolean> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) return false;
  const project = await getProject(projectId, userId);
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
    return res.json({ ok: true, fields: options.fields, catalogs: options.catalogs });
  } catch {
    return res.status(503).json({ ok: false, error: 'runtime_options_unavailable' });
  }
});

router.post('/run', async (req, res) => {
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
      const magnetic = objectValue(await requestPythonRailsJson('/magentic/execution/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hermesRootId }),
      }));
      return res.json({
        ok: true,
        result: { ...magnetic, runId: String(latest.runId || ''), cardId },
      });
    }
    return res.json({
      ok: true,
      result: {
        cardId,
        runId: String(latest.runId || ''),
        state: String(latest.state || ''),
        activeWorkers: finiteNumber(latest.activeWorkers) || 0,
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
