import express from 'express';
import { runCypherOnGraph } from '../services/graphService';

const GRAPH_NAME = 'graph_liq';

const router = express.Router();

router.post('/:projectId/run', async (req, res) => {
  try {
    const { cypher, params } = req.body || {};

    const rows = await runCypherOnGraph(GRAPH_NAME, cypher, params);
    res.json({ ok: true, rows });
  } catch (err: any) {
    console.error('[GRAPH] run failed', err);
    res.status(500).json({ ok: false, error: err?.message || 'Graph error' });
  }
});

export default router;
