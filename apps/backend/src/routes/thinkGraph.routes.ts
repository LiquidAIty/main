/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: This file exposes owner-scoped reads, retirement, and committed-graph notifications while leaving graph data and semantics to Engraphis.
 * Entity: Authentication
 * Relationship: This file requires ownership of the exact Project before forwarding any ThinkGraph read or retirement operation.
 * Entity: Project Knowledge Graph
 * Relationship: This file supplies the shared Project graph workspace with the provider-owned ThinkGraph projection and bounded focus neighborhoods.
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

export function notifyThinkGraphChanged(projectId: string): void {
  for (const [response, project] of graphStreams) {
    if (project !== projectId || response.destroyed || response.writableEnded) continue;
    if (!response.write(`event: changed\ndata: ${JSON.stringify({ projectId })}\n\n`)) response.end();
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
    res.on('close', () => { clearInterval(heartbeat); graphStreams.delete(res); });
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
