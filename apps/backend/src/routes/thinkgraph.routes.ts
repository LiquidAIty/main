import { Router } from 'express';

import { fetchThinkGraphProjection } from '../services/autogen/autogenOrchestratorClient';

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

export default router;
