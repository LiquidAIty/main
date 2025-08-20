import { Router, Request, Response } from 'express';
import { loadPolicy, decide } from '../agents/orchestrator/policy';

const router = Router();

router.get('/sol/why', (req: Request, res: Response) => {
  try {
    const q = (req.query.q ?? '').toString();
    if (!q.trim()) return res.status(400).json({ ok: false, error: 'missing ?q' });
    const policy = loadPolicy();
    const decision = decide(policy, q);
    return res.status(200).json({ ok: true, decision, policySummary: { tools: policy.tools?.length || 0, rules: policy.routing?.rules?.length || 0 } });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

export default router;
