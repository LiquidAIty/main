import { Router } from 'express';

import {
  fetchThinkGraphNeighborhood,
  fetchThinkGraphProjection,
  requestPythonRailsJson,
} from '../services/pythonRailsClient';
import { requireOwnedProject } from './projectAccess';

const thinkGraphReadRoutes = Router();

thinkGraphReadRoutes.post('/retire', async (req, res) => {
  const { projectId, memoryId } = req.body || {};
  if (typeof projectId !== 'string' || !projectId || typeof memoryId !== 'string' || !memoryId) {
    return res.status(400).json({ error: 'projectId and memoryId required' });
  }
  try {
    if (!await requireOwnedProject(req, res, projectId)) return undefined;
    return res.json(await requestPythonRailsJson('/thinkgraph/operation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, operation: 'retire', arguments: { memoryId } }),
    }));
  } catch (error: any) {
    return res.status(409).json({ error: String(error?.message || 'thinkgraph_remove_failed') });
  }
});

// Transport only: Python/Engraphis owns the projection and its graph data.
thinkGraphReadRoutes.get('/projection', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    if (!await requireOwnedProject(req, res, projectId)) return undefined;
    return res.json(await fetchThinkGraphProjection(projectId));
  } catch (error: any) {
    return res.status(502).json({ error: String(error?.message || 'thinkgraph_projection_unavailable') });
  }
});

thinkGraphReadRoutes.get('/neighborhood', async (req, res) => {
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

export default thinkGraphReadRoutes;
