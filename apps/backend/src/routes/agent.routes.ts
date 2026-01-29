import { Router } from 'express';
import type { AgentConfig } from '../types/agentBuilder';
import {
  getAssistAssignments,
  listAgentCards,
  saveAgentConfig as persistAgentConfig,
  getAgentConfig as fetchAgentConfig,
} from '../services/agentBuilderStore';
import {
  getProjectAgent,
} from '../services/projectAgentsStore';
import { resolveModel } from '../llm/models.config';
import { runLLM } from '../llm/client';
import { ingestChatTurnInternal } from './projects.routes';
import { createTrace, storeTrace } from '../services/ingestTrace';
import { captureProbability } from '../lib/receiptCapture';
import { resolveKgIngestAgent } from '../services/resolveAgents';

export const agentRoutes = Router();

async function resolveAssistMainAgent(projectId: string) {
  const { assist_main_agent_id } = await getAssistAssignments(projectId);
  let agent = null;
  if (assist_main_agent_id) {
    agent = await getProjectAgent(assist_main_agent_id);
  }
  if (!agent) {
    return null;
  }

  const systemParts: string[] = [];
  if (agent.prompt_template?.trim()) {
    systemParts.push(agent.prompt_template.trim());
  }

  const systemPrompt = systemParts.join('\n\n').trim();
  if (!systemPrompt) {
    throw new Error('assist_main_prompt_missing');
  }
  const modelKey = agent.model;
  if (!modelKey || !String(modelKey).trim()) {
    console.error('[ASSIST_CHAT] missing model on assist main agent', {
      projectId,
      agent_id: agent.agent_id,
    });
    throw new Error('assist_main_agent_missing_model');
  }
  if (modelKey.includes('/')) {
    console.error('[ASSIST_CHAT] invalid model key format', {
      projectId,
      agent_id: agent.agent_id,
      modelKey,
    });
    throw new Error(
      `invalid_model_key_format: model key cannot be a provider ID (got: ${modelKey}). Use internal keys like 'kimi-k2-thinking'.`,
    );
  }

  return { agent, systemPrompt, modelKey };
}


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
    const resolved = await resolveAssistMainAgent(project);
    if (!resolved) {
      return res.status(409).json({ ok: false, error: 'assist_main_agent_missing', message: 'assist main agent not configured for project' });
    }

    const ingestResolved = await resolveKgIngestAgent(project);
    if (!ingestResolved) {
      return res
        .status(409)
        .json({ ok: false, error: 'kg_ingest_agent_missing', message: 'kg ingest agent not configured for project' });
    }

    // DEBUG: Log current assignments state
    const assignments = await getAssistAssignments(project);
    console.log('[ASSIGNMENTS_DEBUG] Current state for Assist project:', {
      projectId: project,
      assist_main_agent_id: assignments.assist_main_agent_id,
      assist_kg_ingest_agent_id: assignments.assist_kg_ingest_agent_id,
      main_agent_resolved: !!resolved,
      kg_agent_resolved: !!ingestResolved,
    });

    let modelEntry;
    try {
      modelEntry = resolveModel(resolved.modelKey);
    } catch (err: any) {
      console.error('[ASSIST_CHAT] model resolution failed', { projectId: project, modelKey: resolved.modelKey, error: err?.message });
      return res.status(502).json({ ok: false, error: 'model_resolution_failed', message: err?.message || 'model resolution failed' });
    }

    console.log('[ASSIST_CHAT] CONFIG RESOLUTION:', {
      projectId: project,
      assist_main_agent_id: resolved.agent.agent_id,
      agent_name: resolved.agent.name,
      agent_type: resolved.agent.agent_type,
      model_key: resolved.modelKey,
      provider: modelEntry.provider,
      temperature: resolved.agent.temperature,
      max_tokens: resolved.agent.max_tokens,
      system_prompt_length: (resolved.systemPrompt || '').length,
      system_prompt_preview: (resolved.systemPrompt || '').slice(0, 80),
      system_prompt_hash: require('crypto').createHash('sha256').update(resolved.systemPrompt || '').digest('hex').substring(0, 12)
    });

    let llmRes;
    try {
      console.log('[RUNTIME_MODEL] role=assist_chat projectId=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s', project, resolved.agent.agent_id, modelEntry.provider, resolved.modelKey, modelEntry.id);
      llmRes = await runLLM(userText, {
        modelKey: resolved.modelKey,
        temperature: resolved.agent.temperature ?? undefined,
        maxTokens: resolved.agent.max_tokens ?? undefined,
        system: resolved.systemPrompt,
      });
    } catch (err: any) {
      console.error('[ASSIST_CHAT] llm failed', { projectId: project, agent_id: resolved.agent.agent_id, error: err?.message });
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

    // Fire-and-forget KG ingest with trace
    void (async () => {
      const doc_id = `chat:${Date.now()}`;
      const src = `assist.${ingestResolved.agent?.name || 'kg_ingest'}`;
      const startTime = Date.now();
      
      // Create trace
      const trace = createTrace({
        project_id: project,
        model_key: ingestResolved.modelKey,
        embed_model: process.env.OPENROUTER_DEFAULT_EMBED_MODEL || 'openai/text-embedding-3-small',
        doc_id,
        src,
      });
      
      console.log('[KG][ingest] start projectId=%s doc_id=%s src=%s trace_id=%s', project, doc_id, src, trace.trace_id);
      
      let ingestResult: any = null;
      
      try {
        ingestResult = await ingestChatTurnInternal({
          projectId: project,
          doc_id,
          src,
          textToIngest: ['User: ', userText, '\n\nAssistant: ', finalText].join('').trim(),
          user_text: userText,
          assistant_text: finalText,
          llm_model: ingestResolved.modelKey,
          trace,
        });
        
        // ONLY mark done after ingest completes successfully
        trace.step_states.done = {
          ok: true,
          t_ms: Date.now() - startTime,
          entity_count: ingestResult?.entities_upserted || 0,
          relation_count: ingestResult?.relations_upserted || 0,
          chunk_count: ingestResult?.chunks_written || 0,
        };
        
        storeTrace(trace);
        
        console.log('[KG][ingest] done ok=true trace_id=%s entities=%d relations=%d chunks=%d', 
          trace.trace_id, 
          ingestResult?.entities_upserted || 0,
          ingestResult?.relations_upserted || 0,
          ingestResult?.chunks_written || 0
        );
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        const errorCode = errorMsg.includes('chunking_') ? 'chunking_failed' : 
                         errorMsg.includes('extraction_') ? 'extraction_failed' : 'ingest_failed';
        
        // Update trace with error
        trace.error = {
          step: errorCode.replace('_failed', ''),
          code: errorCode,
          message: errorMsg,
        };
        trace.step_states.done = {
          ok: false,
          t_ms: Date.now() - startTime,
          error: errorMsg,
        };
        
        storeTrace(trace);
        
        console.error('[KG][ingest] FAILED trace_id=%s error=%s', trace.trace_id, errorMsg);
      }
    })();

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
      message.includes('assist_main_prompt_missing') ||
      message.includes('kg_ingest_prompt_missing') ||
      message.includes('kg_ingest_model_missing') ||
      message.includes('kg_ingest_agent_missing_assist_assignment') ||
      message.includes('assist_main_agent_missing_model')
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
