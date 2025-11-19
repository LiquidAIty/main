import { Router } from 'express';
import { buildAgent0 } from '../agents/orchestrator/agent0.graph';

export const agentRoutes = Router();

agentRoutes.post('/boss', async (req, res) => {
  const { projectId, goal, query, q, domain, mode } = req.body || {};
  const userText = goal ?? query ?? q;

  if (!userText || typeof userText !== 'string') {
    return res.status(400).json({ ok: false, error: "Missing 'goal' (or 'query'/'q') in body" });
  }

  try {
    console.log("[AGENT] /api/agents/boss called", {
      preview: userText.slice(0, 80),
    });

    // Call orchestrator with full pipeline (or legacy mode if specified)
    const orchestrator = buildAgent0(mode === 'legacy' ? 'legacy' : 'full');
    const resultState: any = await orchestrator.invoke({ q: userText });

    const finalText =
      resultState.answer ??
      resultState.result ??
      resultState.results?.__final__ ??
      '';

    if (!finalText || typeof finalText !== 'string') {
      throw new Error("agent did not produce a final string");
    }

    return res.json({
      ok: true,
      projectId: projectId ?? 'default',
      domain: domain ?? 'general',
      result: finalText
    });
  } catch (error: unknown) {
    console.error('[AGENT] run failed', error);
    return res.status(500).json({
      ok: false,
      error: 'agent failed'
    });
  }
});
