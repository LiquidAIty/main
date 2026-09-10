import { Router } from 'express';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';

const router = Router();

router.post('/codegraph/read', async (req, res) => {
  try {
    return res.json(await requestPythonRailsJson('/codegraph/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    }));
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'codegraph_read_failed' });
  }
});
export default router;
