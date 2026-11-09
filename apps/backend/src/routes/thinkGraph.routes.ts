/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: Exposes owner-scoped graph/source reads, retirement and committed-graph notifications while Engraphis owns persistence and semantics.
 * Entity: Authentication
 * Relationship: This file requires ownership of the exact Project before forwarding any ThinkGraph read or retirement operation.
 * Entity: Project Knowledge Graph
 * Relationship: Supplies provider-owned projections and notifications plus shared active-view Code category selection over the existing Project-scoped stream.
 */

import { Router, type Response } from 'express';

import {
  fetchThinkGraphNeighborhood,
  fetchThinkGraphProjection,
  requestPythonRailsJson,
} from '../services/pythonRailsClient';
import { requireOwnedProject } from './projectAccess';

const thinkGraphRoutes = Router();
const graphStreams = new Map<Response, string>();
type CodeCategorySelection = { categories: Array<{ id: string; label: string; memberFilePaths?: string[] }>; selectedIds: string[]; visible: boolean };
// View configuration shares the lifetime of the existing Project stream, not graph storage.
const codeSelections = new Map<string, CodeCategorySelection>();

export function configureCodeCategories(projectId: string, input: {
  enable?: string[]; disable?: string[]; visible?: boolean; categories?: CodeCategorySelection['categories'];
} = {}) {
  const streams = [...graphStreams].filter(([response, project]) => project === projectId
    && !response.destroyed && !response.writableEnded);
  if (!streams.length) return { ok: true, active: false, changed: false, reason: 'no_active_view', categories: [], selectedIds: [] };
  const current = codeSelections.get(projectId) || { categories: [], selectedIds: [], visible: false };
  const categories = input.categories || current.categories;
  if (!Array.isArray(categories) || categories.some(item => !item || typeof item.id !== 'string'
    || !item.id || typeof item.label !== 'string')) throw new Error('invalid_code_categories');
  const enable = input.enable || [], disable = input.disable || [];
  if (![enable, disable].every(ids => Array.isArray(ids) && ids.every(id => typeof id === 'string')))
    throw new Error('invalid_category_selection');
  const available = new Set(categories.map(category => category.id));
  if ([...enable, ...disable].some(id => !available.has(id))) throw new Error('unknown_code_category');
  const visible = input.visible ?? current.visible;
  if (!visible && enable.length) return { ok: true, active: true, changed: false,
    reason: 'code_layer_off', visible: false, categories: categories.map(({ id, label }) => ({ id, label })),
    selectedIds: [], selectedFiles: [] };
  const selected = new Set(visible ? current.selectedIds.filter(id => available.has(id)) : []);
  enable.forEach(id => selected.add(id));
  disable.forEach(id => selected.delete(id));
  if (input.visible !== undefined && typeof input.visible !== 'boolean') throw new Error('invalid_code_visibility');
  const next = { categories, selectedIds: [...selected].sort(), visible };
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  codeSelections.set(projectId, next);
  const result = { ok: true, active: true, changed, visible: next.visible, selectedIds: next.selectedIds,
    categories: categories.map(({ id, label }) => ({ id, label })),
    selectedFiles: [...new Set(categories.filter(item => selected.has(item.id)).flatMap(item => item.memberFilePaths || []))] };
  if (changed) for (const [response] of streams)
    response.write(`event: code-categories\ndata: ${JSON.stringify({ projectId, ...result })}\n\n`);
  return result;
}

thinkGraphRoutes.post('/code-categories', async (req, res) => {
  const scope = await requireOwnedProject(req, res, String(req.body?.projectId || ''));
  if (!scope) return undefined;
  try { return res.json(configureCodeCategories(scope.projectId, req.body)); }
  catch (error) { return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'code_selection_failed' }); }
});

thinkGraphRoutes.post('/view-context', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const scope = await requireOwnedProject(req, res, projectId);
  if (!scope) return undefined;
  try {
    return res.json(await requestPythonRailsJson('/project/entity-map/view', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: scope.projectId, map: req.body?.map, openNode: req.body?.openNode }),
    }));
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'graph_view_context_unavailable' });
  }
});


thinkGraphRoutes.get('/sources', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const memoryId = String(req.query.memoryId || '').trim();
  if (!projectId || !memoryId) return res.status(400).json({ error: 'projectId and memoryId required' });
  if (req.query.includeExchange !== undefined && req.query.includeExchange !== 'true') {
    return res.status(400).json({ error: 'includeExchange must be true when supplied' });
  }
  try {
    const scope = await requireOwnedProject(req, res, projectId);
    if (!scope) return undefined;
    return res.json(await requestPythonRailsJson('/thinkgraph/operation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: scope.projectId, operation: 'source_exchanges',
        arguments: { memoryId, includeExchange: req.query.includeExchange === 'true' } }),
    }));
  } catch {
    return res.status(404).json({ error: 'source_exchange_unavailable' });
  }
});

thinkGraphRoutes.get('/source-search', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const query = String(req.query.query || '').trim();
  if (!projectId || !query) return res.status(400).json({ error: 'projectId and query required' });
  try {
    const scope = await requireOwnedProject(req, res, projectId);
    if (!scope) return undefined;
    return res.json(await requestPythonRailsJson('/thinkgraph/operation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: scope.projectId, operation: 'search_sources', arguments: { query } }),
    }));
  } catch {
    return res.status(502).json({ error: 'source_search_unavailable' });
  }
});

export function notifyThinkGraphChanged(projectId: string, authority: 'thinkgraph' | 'knowgraph' = 'thinkgraph'): void {
  for (const [response, project] of graphStreams) {
    if (project !== projectId || response.destroyed || response.writableEnded) continue;
    if (!response.write(`event: ${authority === 'knowgraph' ? 'knowgraph-changed' : 'changed'}\ndata: ${JSON.stringify({ projectId })}\n\n`)) response.end();
  }
}

thinkGraphRoutes.get('/events', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    const scope = await requireOwnedProject(req, res, projectId);
    if (!scope) return undefined;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    graphStreams.set(res, scope.projectId);
    const heartbeat = setInterval(() => {
      if (!res.write(': keepalive\n\n')) res.end();
    }, 25_000);
    res.on('close', () => {
      clearInterval(heartbeat); graphStreams.delete(res);
      if (![...graphStreams.values()].includes(scope.projectId)) codeSelections.delete(scope.projectId);
    });
    // Re-read on every connection, including reconnects, so missed changes need no replay queue.
    res.write(`event: ready\ndata: ${JSON.stringify({ projectId: scope.projectId })}\n\n`);
  } catch (error: any) {
    if (!res.headersSent) res.status(502).json({ error: String(error?.message || 'thinkgraph_stream_unavailable') });
    else res.end();
  }
  return undefined;
});

thinkGraphRoutes.post('/retire', async (req, res) => {
  const { projectId, memoryId } = req.body || {};
  if (typeof projectId !== 'string' || !projectId || typeof memoryId !== 'string' || !memoryId) {
    return res.status(400).json({ error: 'projectId and memoryId required' });
  }
  try {
    const scope = await requireOwnedProject(req, res, projectId);
    if (!scope) return undefined;
    const result = await requestPythonRailsJson('/thinkgraph/operation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, operation: 'retire', arguments: { memoryId } }),
    });
    notifyThinkGraphChanged(scope.projectId);
    return res.json(result);
  } catch (error: any) {
    return res.status(409).json({ error: String(error?.message || 'thinkgraph_remove_failed') });
  }
});

// Transport only: Python/Engraphis owns the projection and its graph data.
thinkGraphRoutes.get('/projection', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    if (!await requireOwnedProject(req, res, projectId)) return undefined;
    return res.json(await fetchThinkGraphProjection(projectId));
  } catch (error: any) {
    return res.status(502).json({ error: String(error?.message || 'thinkgraph_projection_unavailable') });
  }
});

thinkGraphRoutes.get('/neighborhood', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const canonicalId = String(req.query.canonicalId || '').trim();
  if (!projectId || !canonicalId) {
    return res.status(400).json({ error: 'projectId and canonicalId required' });
  }
  try {
    if (!await requireOwnedProject(req, res, projectId)) return undefined;
    return res.json(await fetchThinkGraphNeighborhood(projectId, canonicalId));
  } catch (error: any) {
    return res.status(502).json({
      error: String(error?.message || 'thinkgraph_neighborhood_unavailable'),
    });
  }
});

export default thinkGraphRoutes;
