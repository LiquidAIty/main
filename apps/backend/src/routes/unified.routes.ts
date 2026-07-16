// Thin transport for the Python-owned bounded multi-authority context projection.
import { Router } from 'express';
import { fetchUnifiedContext } from '../services/autogen/autogenOrchestratorClient';

const router = Router();

router.get('/context', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const conversationId = String(req.query.conversationId || '').trim();
  if (!projectId || !conversationId) return res.status(400).json({ error: 'projectId and conversationId required' });
  try {
    return res.json(await fetchUnifiedContext({
      projectId,
      conversationId,
      role: String(req.query.role || 'main_chat'),
      activeGraphViewId: String(req.query.activeGraphViewId || '').trim() || undefined,
      knowgraphScope: String(req.query.knowgraphScope || '').trim() || undefined,
      thinkLimit: Number(req.query.thinkLimit) || undefined,
      knowLimit: Number(req.query.knowLimit) || undefined,
      codeLimit: Number(req.query.codeLimit) || undefined,
      expansionDepth: Number(req.query.expansionDepth) || 0,
    }));
  } catch (error: any) {
    return res.status(502).json({ error: String(error?.message || 'unified_context_unavailable') });
  }
});

export default router;
