import { Router } from 'express';
import { buildProjectSelfSeed, toSeedTriples } from '../knowledge/projectSelfSeed';

const router = Router();

router.get('/:projectId/knowledge/self-seed', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) {
      return res.status(400).json({ ok: false, error: 'project_id_required' });
    }

    const seed = buildProjectSelfSeed(projectId);
    const includeTriples =
      String(req.query.includeTriples || '').trim() === '1' ||
      String(req.query.includeTriples || '').trim().toLowerCase() === 'true';

    return res.json({
      ok: true,
      seed,
      triples: includeTriples ? toSeedTriples(seed) : undefined,
      note: 'Preview-only seed payload. Ingestion persistence is intentionally deferred.',
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'knowledge_self_seed_failed' });
  }
});

export default router;
