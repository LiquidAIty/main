import { Router } from 'express';

import {
  fetchThinkGraphNeighborhood,
  fetchThinkGraphProjection,
} from '../services/autogen/pythonRailsClient';

const router = Router();

// Transport only: Python/Engraphis owns the projection and its graph data.
router.get('/projection', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const limit = Number(req.query.limit);
  try {
    return res.json(await fetchThinkGraphProjection(
      projectId,
      Number.isFinite(limit) ? limit : undefined,
    ));
  } catch (error: any) {
    return res.status(502).json({ error: String(error?.message || 'thinkgraph_projection_unavailable') });
  }
});

router.get('/neighborhood', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const canonicalId = String(req.query.canonicalId || '').trim();
  if (!projectId || !canonicalId) {
    return res.status(400).json({ error: 'projectId and canonicalId required' });
  }
  try {
    return res.json(await fetchThinkGraphNeighborhood(projectId, canonicalId));
  } catch (error: any) {
    return res.status(502).json({
      error: String(error?.message || 'thinkgraph_neighborhood_unavailable'),
    });
  }
});

export default router;
