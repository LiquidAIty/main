import { Router } from 'express';
import type { AgentConfig } from '../types/agentBuilder';
import {
  listAgentCards,
  saveAgentConfig as persistAgentConfig,
  getAgentConfig as fetchAgentConfig,
} from '../services/agentBuilderStore';
import { runLLM } from '../llm/client';
import { captureProbability } from '../lib/receiptCapture';
import { resolveAgentConfig } from '../services/resolveAgents';

export const agentRoutes = Router();

agentRoutes.post('/boss', async (req, res) => {
  const body = req.body || {};
  const { goal, query, q, domain } = body;
  const userText = typeof goal === 'string' ? goal : typeof query === 'string' ? query : typeof q === 'string' ? q : '';

  if (!userText || typeof userText !== 'string') {
    return res.status(400).json({ ok: false, error: "missing_goal", message: "Missing 'goal' (or 'query'/'q') in body" });
  }

  const project =
    (body.projectId || body.project_id || req.query?.projectId || req.query?.project_id || '').toString().trim();
  if (!project) {
    return res.status(400).json({ ok: false, error: 'missing_projectId', message: 'projectId required' });
  }

  try {
    const resolved = await resolveAgentConfig(project, 'llm_chat', '/api/agents/boss');
    if (!resolved) {
      return res.status(409).json({
        ok: false,
        error: 'assist_main_agent_missing',
        message: 'No agent configuration found for main chat.',
      });
    }

    let llmRes;
    try {
      console.log(
        '[RUNTIME_MODEL] route=/api/agents/boss projectId=%s agentType=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s',
        project,
        'llm_chat',
        resolved.agentId,
        resolved.provider,
        resolved.modelKey,
        resolved.providerModelId,
      );
      llmRes = await runLLM(userText, {
        modelKey: resolved.modelKey,
        temperature: resolved.temperature ?? undefined,
        maxTokens: resolved.maxTokens ?? undefined,
        system: resolved.systemPrompt,
      });
    } catch (err: any) {
      console.error('[ASSIST_CHAT] llm failed', { projectId: project, agent_id: resolved.agentId, error: err?.message });
      return res.status(502).json({ ok: false, error: 'assist_boss_failed', message: err?.message || 'agent failed' });
    }

    const finalText = (llmRes.text || '').trim();
    if (!finalText) {
      return res.status(502).json({ ok: false, error: 'empty_assistant_reply', message: 'assistant returned empty text' });
    }

    // Capture probability (fire-and-forget)
    void captureProbability({
      projectId: project,
      outputText: finalText
    }).catch(err => console.error('[ASSIST_CHAT] probability capture failed:', err));

    return res.json({
      ok: true,
      projectId: project,
      domain: domain ?? 'general',
      result: { final: finalText },
      model: llmRes.model,
      provider: llmRes.provider,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('llm_chat_prompt_missing') ||
      message.includes('llm_chat_model_missing') ||
      message.includes('assist_main_prompt_missing')
    ) {
      return res.status(409).json({
        ok: false,
        error: message,
        message,
      });
    }
    console.error('[ASSIST_CHAT] unexpected failure', error);
    return res.status(502).json({
      ok: false,
      error: 'assist_boss_failed',
      message,
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
