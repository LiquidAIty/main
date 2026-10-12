import { Router } from 'express';

import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { requireOwnedProject } from './projectAccess';

const projectGraphRoutes = Router();

projectGraphRoutes.post('/entity-context', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const query = String(req.body?.query || '').trim();
  const entities = req.body?.entities;
  const context = String(req.body?.context || '');
  const limit = Number(req.body?.limit ?? 1);
  if (!projectId || !query || !Array.isArray(entities) || !entities.length
    || !Number.isInteger(limit) || limit < 1 || limit > 12) {
    return res.status(400).json({
      error: 'projectId, query, entities, and limit from 1 through 12 required',
    });
  }
  try {
    if (!await requireOwnedProject(req, res, projectId)) return undefined;
    return res.json(await requestPythonRailsJson('/graph/entity-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, query, context, limit, entities }),
    }));
  } catch (error: any) {
    return res.status(502).json({
      error: String(error?.message || 'project_graph_entity_context_unavailable'),
    });
  }
});

export default projectGraphRoutes;
