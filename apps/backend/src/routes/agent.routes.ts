import { Router } from 'express';

export const agentRoutes = Router();

agentRoutes.post('/boss', async (req, res) => {
  const { projectId, goal, domain } = req.body || {};
  if (!goal) return res.status(400).json({ ok: false, error: "Missing 'goal' in body" });

  // TODO: call your BossAgent orchestrator here.
  // For now, stub a success shape:
  return res.json({
    ok: true,
    projectId: projectId ?? 'default',
    domain: domain ?? 'general',
    result: { final: `BossAgent: ${goal}` }
  });
});
