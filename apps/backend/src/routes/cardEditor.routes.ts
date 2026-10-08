import { Router } from 'express';
import { createHash } from 'crypto';
import { getDeckDocument } from '../decks/store';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import { indexToolCatalogReferences, resolveScriptToolReferences, searchToolCatalogReferences, type ToolCatalogReference } from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';

const router = Router();
export const iddRoutes = Router();

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

async function loadInputDictionaryToolCatalog() {
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
      tools: [...canonicalMcpTools, ...privateRuntimeManifest.tools],
    }),
  }) as { references?: unknown };
  if (!Array.isArray(materialized?.references)) {
    throw new Error('input_data_dictionary_tool_catalog_invalid');
  }
  return indexToolCatalogReferences(materialized.references as ToolCatalogReference[]);
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
  const catalog = await listPythonAgentMcpCatalog();
  const options: Array<Record<string, unknown>> = catalog.map((tool: any) => ({
    id: tool.name, kind: 'tool', owner: tool.sourceId, source: tool.sourceId,
    schema: tool.inputSchema, available: tool.available !== false,
  }));
  return { catalogOptions: options, selectedIds: [...new Set(selectedIds)] };
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

iddRoutes.get('/card-editor', async (req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const materialized = await requestPythonRailsJson('/idd/card-editor/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: listConfiguredModelOptions(openaiDefault),
        ...await cardCatalogOptions(
          String(req.query.projectId || ''), String(req.query.deckId || ''), String(req.query.cardId || ''),
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
    const catalog = await loadInputDictionaryToolCatalog();
    const selectedIds = commaSeparatedIds(req.query.selectedIds);
    return res.json({
      ok: true,
      ...searchToolCatalogReferences(catalog, {
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
      error: 'input_data_dictionary_tool_catalog_unavailable',
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

function scriptPaletteFingerprint(references: ToolCatalogReference[]): string {
  return createHash('sha256').update(JSON.stringify(
    references.map((reference) => ({
      canonicalId: reference.canonicalId,
      access: reference.access,
      availability: reference.availability,
      contracts: reference.contracts,
    })),
  )).digest('hex');
}

iddRoutes.get('/script-tools', async (req, res) => {
  try {
    const catalog = await loadInputDictionaryToolCatalog();
    const references = resolveScriptToolReferences(catalog, {
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
    const catalog = await loadInputDictionaryToolCatalog();
    const references = resolveScriptToolReferences(catalog, {
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
