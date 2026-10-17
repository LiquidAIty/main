/**
 * Entity: Tool Grants
 * Relationship: Serves authenticated Card editor and Script palettes filtered by the exact saved Card profile, so profile-scoped tools never become ordinary choices.
 */

import { createHash } from 'crypto';
import { Router } from 'express';
import { getDeckDocument } from '../decks/deckDomainClient';
import { listConfiguredModelOptions } from '../llm/models.config';
import { listToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { indexLiveToolCatalog, resolveScriptToolDefinitions, searchToolCatalogDefinitions,
  type ToolCatalogDefinition } from '../cards/toolCatalogProjection';
import { authorizeCardProject } from './cardRunRead.routes';

const builderIddRoutes = Router();
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
  if (!Array.isArray(materialized?.references)) throw new Error('live_tool_catalog_invalid');
  return indexLiveToolCatalog(materialized.references as ToolCatalogDefinition[]);
}
async function cardCatalogScope(projectId: string, deckId: string, cardId: string) {
  if (!projectId || !deckId || !cardId) return { selectedIds: [], cardProfile: '' };
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
  return {
    selectedIds: [...new Set(selectedIds)],
    cardProfile: String(card.runtime.profile || '').trim().toLowerCase(),
  };
}
async function cardCatalogOptions(projectId: string, deckId: string, cardId: string) {
  const scope = await cardCatalogScope(projectId, deckId, cardId);
  const catalog = await loadLiveToolCatalog();
  return { catalogOptions: catalog.references, ...scope };
}
export function scriptPaletteFingerprint(definitions: ToolCatalogDefinition[]): string {
  return createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
}

export async function materializeCardEditor(
  projectId: string,
  deckId: string,
  cardId: string,
): Promise<Record<string, unknown>> {
  const openaiDefault = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna';
  const materialized = await requestPythonRailsJson('/idd/card-editor/materialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      models: listConfiguredModelOptions(openaiDefault),
      ...await cardCatalogOptions(projectId, deckId, cardId),
    }),
  }) as Record<string, unknown>;
  if (
    !materialized?.dictionary
    || !Array.isArray(materialized.fields)
    || !materialized.catalogs
    || typeof materialized.catalogs !== 'object'
  ) throw new Error('input_data_dictionary_card_editor_invalid');
  return materialized;
}

builderIddRoutes.get('/card-editor', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '').trim();
    if (projectId && !(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({
        ok: false,
        error: 'card_editor_project_access_denied',
      });
    }
    const materialized = await materializeCardEditor(
      projectId,
      String(req.query.deckId || ''),
      String(req.query.cardId || ''),
    );
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
builderIddRoutes.get('/tools', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '').trim();
    const deckId = String(req.query.deckId || '').trim();
    const cardId = String(req.query.cardId || '').trim();
    if (projectId && !(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({ ok: false, error: 'card_editor_project_access_denied' });
    }
    const scope = await cardCatalogScope(projectId, deckId, cardId);
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
        profile: scope.cardProfile,
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
builderIddRoutes.get('/script-tools', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '').trim();
    const deckId = String(req.query.deckId || '').trim();
    const cardId = String(req.query.cardId || '').trim();
    if (projectId && !(await authorizeCardProject(req, projectId))) {
      return res.status(403).json({ ok: false, error: 'card_editor_project_access_denied' });
    }
    const scope = await cardCatalogScope(projectId, deckId, cardId);
    const catalog = await loadLiveToolCatalog();
    const references = resolveScriptToolDefinitions(catalog, {
      selectedIds: commaSeparatedIds(req.query.selectedIds),
    }, scope.cardProfile);
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
        cardId,
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
export default builderIddRoutes;
