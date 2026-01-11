import { Router } from 'express';
import { buildAgent0 } from '../agents/orchestrator/agent0.graph';
import type { AgentConfig } from '../types/agentBuilder';
import { getAgentConfig as fetchAgentConfig, listAgentCards, saveAgentConfig as persistAgentConfig } from '../services/agentBuilderStore';

export const agentRoutes = Router();

agentRoutes.post('/boss', async (req, res) => {
  const { projectId, goal, query, q, domain, mode, agentConfig } = req.body || {};
  const userText = goal ?? query ?? q;

  if (!userText || typeof userText !== 'string') {
    return res.status(400).json({ ok: false, error: "Missing 'goal' (or 'query'/'q') in body" });
  }

  try {
    console.log("[AGENT] /api/agents/boss called", {
      preview: userText.slice(0, 80),
      mode: mode || 'full',
      hasConfig: !!agentConfig,
    });

    // Call orchestrator with full pipeline (or legacy mode if specified)
    console.log("[AGENT] Building orchestrator...");
    const orchestrator = buildAgent0(mode === 'legacy' ? 'legacy' : 'full', agentConfig);
    
    console.log("[AGENT] Invoking orchestrator with query:", userText.slice(0, 100));
    const resultState: any = await orchestrator.invoke({ q: userText });
    console.log("[AGENT] Orchestrator returned:", Object.keys(resultState));

    const finalText =
      resultState.answer ??
      resultState.result ??
      resultState.results?.__final__ ??
      '';

    if (!finalText || typeof finalText !== 'string') {
      console.error("[AGENT] No final text produced. State:", resultState);
      throw new Error("agent did not produce a final string");
    }

    console.log("[AGENT] Success, returning response");
    return res.json({
      ok: true,
      projectId: projectId ?? 'default',
      domain: domain ?? 'general',
      result: { final: finalText }
    });
  } catch (error: unknown) {
    console.error('[AGENT] run failed:', error);
    if (error instanceof Error) {
      console.error('[AGENT] error message:', error.message);
      console.error('[AGENT] error stack:', error.stack);
    }
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'agent failed'
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
    console.log('[AGENT] /projects called');
    const cards = await listAgentCards();
    console.log('[AGENT] /projects success, returned', cards?.length || 0, 'cards');
    return res.json(cards);
  } catch (error: any) {
    console.error('[AGENT] list projects failed:', {
      message: error?.message,
      name: error?.name,
      code: error?.code,
      stack: error?.stack,
    });
    return res.status(500).json({ 
      ok: false, 
      error: error?.message || 'list failed',
      details: {
        name: error?.name,
        code: error?.code,
      }
    });
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
