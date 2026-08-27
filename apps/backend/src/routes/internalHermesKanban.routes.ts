import { Router } from 'express';
import {
  HermesKanbanWorkerNotCorrelatedError,
  issueHermesKanbanWorkerBearer,
  type HermesKanbanWorkerIdentity,
} from '../hermes/kanbanWorkerBearer';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';

type IssueBearer = typeof issueHermesKanbanWorkerBearer;

export function createInternalHermesKanbanRouter(
  issueBearer: IssueBearer = issueHermesKanbanWorkerBearer,
): Router {
  const router = Router();
  router.post('/worker-bearer', async (req, res) => {
    if (!isLoopbackSocketRequest(req)) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    try {
      const { bearer } = await issueBearer({
        identity: (req.body || {}) as Partial<HermesKanbanWorkerIdentity>,
      });
      return res.json({ ok: true, bearer, mcpUrl: resolveInternalMcpUrl() });
    } catch (error) {
      if (error instanceof HermesKanbanWorkerNotCorrelatedError) {
        return res.status(404).json({
          ok: false,
          error: 'hermes_kanban_worker_not_correlated',
        });
      }
      const code = String(error instanceof Error ? error.message : error);
      if (code.startsWith('hermes_kanban_worker_') && code.endsWith('_invalid')) {
        return res.status(400).json({ ok: false, error: code });
      }
      if (code === 'hermes_kanban_worker_profile_mismatch'
        || code === 'hermes_kanban_worker_native_claim_mismatch') {
        return res.status(409).json({ ok: false, error: code });
      }
      return res.status(503).json({
        ok: false,
        error: 'hermes_kanban_worker_bearer_unavailable',
      });
    }
  });
  return router;
}

export default createInternalHermesKanbanRouter();
