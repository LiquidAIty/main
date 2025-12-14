import { Router } from 'express';
import { buildAgent0 } from '../agents/orchestrator/agent0.graph';
import type { AgentConfig } from '../types/agentBuilder';
import { getAgentConfig as fetchAgentConfig, listAgentCards, saveAgentConfig as persistAgentConfig } from '../services/agentBuilderStore';

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

agentRoutes.get('/cards', async (_req, res) => {
  try {
    const cards = await listAgentCards();
    return res.json(cards);
  } catch (error) {
    console.error('[AGENT] list cards failed', error);
    return res.status(500).json({ ok: false, error: 'list failed' });
  }
});

// Alias for project list (used by Agent Builder drawer)
agentRoutes.get('/projects', async (_req, res) => {
  try {
    const cards = await listAgentCards();
    return res.json(cards);
  } catch (error) {
    console.error('[AGENT] list projects failed', error);
    return res.status(500).json({ ok: false, error: 'list failed' });
  }
});

agentRoutes.post('/save', async (req, res) => {
  const cfg = req.body as AgentConfig;
  if (!cfg || typeof cfg.id !== 'string' || !cfg.id) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  try {
    const saved = await persistAgentConfig(cfg);
    return res.json(saved);
  } catch (error: unknown) {
    console.error('[AGENT] save config failed', error);
    if (error instanceof Error) {
      console.error('[AGENT] save config failed stack:', error.stack);
    }
    return res.status(500).json({ ok: false, error: 'save failed' });
  }
});

agentRoutes.get('/:id', async (req, res) => {
  const projectId = req.params.id;
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  try {
    const config = await fetchAgentConfig(projectId);
    return res.json(config);
  } catch (error: unknown) {
    console.error('[AGENT] get config failed', error);
    if (error instanceof Error) {
      console.error('[AGENT] get config failed stack:', error.stack);
    }
    return res.status(500).json({ ok: false, error: 'load failed' });
  }
});
