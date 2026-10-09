// @graph entity: KnowGraphReadRoute
// @graph role: knowgraph-read-gateway
// @graph relates_to: AgentBuilderWorkspace, KnowGraph API, KnowGraph
// @graph depends_on: Express, Python rails
// @graph feeds_to: KnowGraph
import { Router } from 'express';
import {
  fetchKnowGraphNeighborhood,
  fetchKnowGraphProjection,
} from '../services/pythonRailsClient';
import { getOwnedProjectByReference } from '../services/projectStore';

const router = Router();

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

router.get('/graph', async (req, res) => {
  try {
    const requestedProjectId =
      (typeof req.query?.projectId === 'string' && req.query.projectId.trim())
      || (typeof req.query?.project_id === 'string' && req.query.project_id.trim())
      || '';

    if (!requestedProjectId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId is required' },
      });
    }
    const userId = String((req as any).userId || '').trim();
    const projectId = userId
      ? (await getOwnedProjectByReference(requestedProjectId, userId))?.id ?? null
      : null;
    if (!projectId) {
      return res.status(userId ? 404 : 401).json({
        ok: false,
        error: { message: userId ? 'KnowGraph project not found.' : 'Authentication required.' },
      });
    }

    const limit = clampInt(req.query?.limit, 1, 500, 200);
    return res.json(await fetchKnowGraphProjection(projectId, limit));
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch KnowGraph graph';
    return res.status(500).json({ ok: false, error: { message } });
  }
});

router.get('/expand', async (req, res) => {
  try {
    const requestedProjectId =
      (typeof req.query?.projectId === 'string' && req.query.projectId.trim())
      || (typeof req.query?.project_id === 'string' && req.query.project_id.trim())
      || '';
    const nodeId =
      (typeof req.query?.nodeId === 'string' && req.query.nodeId.trim())
      || (typeof req.query?.node_id === 'string' && req.query.node_id.trim())
      || '';

    if (!requestedProjectId || !nodeId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId and nodeId are required' },
      });
    }
    const userId = String((req as any).userId || '').trim();
    const projectId = userId
      ? (await getOwnedProjectByReference(requestedProjectId, userId))?.id ?? null
      : null;
    if (!projectId) {
      return res.status(userId ? 404 : 401).json({
        ok: false,
        error: { message: userId ? 'KnowGraph project not found.' : 'Authentication required.' },
      });
    }

    const limit = clampInt(req.query?.limit, 1, 200, 50);
    // The established endpoint is always a one-hop interactive expansion;
    // the Python owner does not accept a competing traversal-depth control.
    return res.json(await fetchKnowGraphNeighborhood(projectId, nodeId, limit));
  } catch (error: any) {
    const message = error?.message || 'Failed to expand KnowGraph graph';
    return res.status(500).json({ ok: false, error: { message } });
  }
});

export default router;
