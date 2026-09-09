import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { requestHermesExtension } from '../hermes/mainAdapter';
import { isLoopbackSocketRequest } from '../security/requestAccess';

import {
  fetchThinkGraphNeighborhood,
  fetchThinkGraphProjection,
  requestPythonRailsJson,
} from '../services/autogen/pythonRailsClient';

const router = Router();

// Private process transport. Engraphis owns the prompt and output validation.
router.post('/extraction-completion', async (req, res) => {
  const expected = Buffer.from(process.env.LIQUIDAITY_INTERNAL_MCP_SECRET || '');
  const supplied = Buffer.from(String(req.headers['x-internal-secret'] || ''));
  if (!isLoopbackSocketRequest(req) || expected.length < 32
      || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return res.status(403).json({ error: 'extraction_transport_forbidden' });
  }
  try {
    return res.json(await requestHermesExtension('_model/complete', req.body));
  } catch {
    return res.status(502).json({ error: 'extraction_account_completion_failed' });
  }
});

router.post('/retire', async (req, res) => {
  const { projectId, memoryId } = req.body || {};
  if (typeof projectId !== 'string' || !projectId || typeof memoryId !== 'string' || !memoryId) {
    return res.status(400).json({ error: 'projectId and memoryId required' });
  }
  try {
    return res.json(await requestPythonRailsJson('/thinkgraph/operation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, operation: 'retire', arguments: { nativeId: memoryId } }),
    }));
  } catch (error: any) {
    return res.status(409).json({ error: String(error?.message || 'thinkgraph_remove_failed') });
  }
});

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
