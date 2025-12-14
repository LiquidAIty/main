import express from 'express';
import { runCypher } from '../services/graphService';

const router = express.Router();

router.post('/:projectId/run', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { cypher, params } = req.body || {};

    const rows = await runCypher(projectId, cypher, params);
    res.json({ ok: true, rows });
  } catch (err: any) {
    console.error('[GRAPH] run failed', err);
    res.status(500).json({ ok: false, error: err?.message || 'Graph error' });
  }
});

export default router;
