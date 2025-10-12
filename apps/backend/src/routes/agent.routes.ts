import { Router } from 'express';
import { buildAgent0 } from '../agents/orchestrator/agent0.graph';

export const agentRoutes = Router();

agentRoutes.post('/boss', async (req, res) => {
  const { projectId, goal, domain, mode } = req.body || {};
  if (!goal) return res.status(400).json({ ok: false, error: "Missing 'goal' in body" });

  try {
    // Call orchestrator with full pipeline (or legacy mode if specified)
    const orchestrator = buildAgent0(mode === 'legacy' ? 'legacy' : 'full');
    const result = await orchestrator.invoke({ q: goal });
    
    return res.json({
      ok: true,
      projectId: projectId ?? 'default',
      domain: domain ?? 'general',
      result: {
        answer: result.answer || result.results?.__final__ || 'No answer generated',
        entities: result.entities || [],
        docs: result.docs || [],
        gaps: result.gaps || [],
        forecasts: result.forecasts || [],
        writes: result.writes || { entities: [], relations: [], gaps: [], forecasts: [] }
      }
    });
  } catch (error: unknown) {
    console.error('[BossAgent] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
