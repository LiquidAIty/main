import { Router } from 'express';
import { createHash } from 'crypto';
import { getDeckDocument } from '../decks/store';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import { indexToolCatalogReferences, resolveScriptToolReferences, searchToolCatalogReferences, type ToolCatalogReference } from '../cards/toolCatalogProjection';
import { listConfiguredModelOptions } from '../llm/models.config';
import { hydrateHermesCardProfile } from '../hermes/cardProfileProjection';
import { requestHermesNative } from '../hermes/mainAdapter';

const router = Router();
const AGENT_BUILDER_PROFILE = 'liquidaity-agent-builder';

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

async function builderNativeOptions(projectId: string, deckId: string, cardId: string) {
  if (!projectId || !deckId || !cardId) return { nativeOptions: [], selectedIds: [] };
  const { deck } = await getDeckDocument(projectId, deckId);
  const card = deck?.nodes.find((node) => node.id === cardId);
  if (!deck || !card) throw new Error('card_not_found');
  if (
    card.runtime.kind !== 'hermes'
    || card.runtime.mode !== 'delegate'
    || card.runtime.profile !== AGENT_BUILDER_PROFILE
  ) {
    throw new Error('agent_builder_card_required');
  }
  const saved = card.runtimeOptions || {};
  const selectedIds = [card.templateId, ...(saved.tools || []),
    ...(saved.nativeTools || []).map((name) => 'hermes:tool:' + name),
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
  const { native } = await hydrateHermesCardProfile(card, deck);
  const [tools, plugins] = await Promise.all([
    requestHermesNative('tools.show', {}, card.runtime.profile),
    requestHermesNative('plugins.list', {}, card.runtime.profile),
  ]) as Array<Record<string, any>>;
  options.push({ id: 'profile:' + native.name, kind: 'profile', owner: 'Hermes',
    source: 'profiles.describe', schema: { name: native.name, model: native.model }, available: true });
  selectedIds.push('profile:' + card.runtime.profile);
  for (const [kind, values] of [
    ['skill', native.skills], ['toolset', native.toolsets], ['mcp', native.mcpServers],
    ['plugin', Array.isArray(plugins.plugins) ? plugins.plugins : []],
  ] as const) {
    for (const item of values) {
      options.push({ id: kind + ':' + item.name, kind, owner: 'Hermes',
        source: 'profile:' + native.name, schema: item, available: item.enabled !== false });
      if (item.enabled === true) selectedIds.push(kind + ':' + item.name);
    }
  }
  for (const section of Array.isArray(tools.sections) ? tools.sections : []) {
    for (const tool of section.tools || []) options.push({
      id: 'hermes:tool:' + tool.name, kind: 'tool', owner: 'Hermes', source: 'tools.show:' + native.name,
      // Native tools.show does not expose schemas. Do not invent a callable signature.
      schema: { nativeName: tool.name }, available: true,
    });
  }
  return { nativeOptions: options, selectedIds: [...new Set(selectedIds)] };
}

router.get('/card-editor/options', async (_req, res) => {
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

router.get('/input-data-dictionary/card-editor', async (req, res) => {
  try {
    const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
    const materialized = await requestPythonRailsJson('/idd/card-editor/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: listConfiguredModelOptions(openaiDefault),
        ...await builderNativeOptions(
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

router.get('/input-data-dictionary/script-tools', async (req, res) => {
  try {
    const catalog = await loadInputDictionaryToolCatalog();
    const references = resolveScriptToolReferences(catalog, {
      policy: req.query.policy === 'all_healthy' ? 'all_healthy' : 'selected',
      selectedIds: commaSeparatedIds(req.query.selectedIds),
      disabledIds: commaSeparatedIds(req.query.disabledIds),
    });
    const referenceIds = new Set(references.map((reference) => reference.canonicalId));
    const defaultAgentTools = commaSeparatedIds(req.query.selectedIds)
      .filter((canonicalId) => referenceIds.has(canonicalId));
    const fingerprint = createHash('sha256').update(JSON.stringify(
      references.map((reference) => ({
        canonicalId: reference.canonicalId,
        access: reference.access,
        availability: reference.availability,
        contracts: reference.contracts,
      })),
    )).digest('hex');
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
    return res.json({ ok: true, references, paletteFingerprint: fingerprint, header });
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

router.post('/card-script/validate', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const selectedToolIds: string[] = Array.isArray(body.selectedTools)
      ? body.selectedTools.map((value: unknown) => String(value))
      : [];
    const catalog = await loadInputDictionaryToolCatalog();
    const references = resolveScriptToolReferences(catalog, {
      policy: body.toolCatalogPolicy === 'all_healthy' ? 'all_healthy' : 'selected',
      selectedIds: selectedToolIds,
      disabledIds: Array.isArray(body.disabledTools) ? body.disabledTools.map(String) : [],
    });
    const referenceIds = new Set(references.map((reference) => reference.canonicalId));
    const defaultAgentTools = selectedToolIds
      .filter((canonicalId) => referenceIds.has(canonicalId));
    const paletteFingerprint = createHash('sha256').update(JSON.stringify(
      references.map((reference) => ({
        canonicalId: reference.canonicalId,
        access: reference.access,
        availability: reference.availability,
        contracts: reference.contracts,
      })),
    )).digest('hex');
    const script = await requestPythonRailsJson('/card-script/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: body.script,
        selectedTools: references.map((reference) => reference.canonicalId),
        defaultAgentTools,
        paletteFingerprint,
        nativeAvailable: body.runtimeKind === 'hermes',
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
