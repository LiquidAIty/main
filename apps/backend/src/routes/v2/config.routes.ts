import { Router } from 'express';
import { getAgentConfig, updateAgentConfig, type AgentType } from '../../services/v2/agentConfigStore';

const router = Router();
const VALID_AGENT_TYPES: AgentType[] = ['llm_chat', 'kg_ingest'];
const REQUIRED_FIELDS: Array<'provider' | 'model_key' | 'prompt_template'> = [
  'provider',
  'model_key',
  'prompt_template',
];

function isValidAgentType(agentType: string): agentType is AgentType {
  return VALID_AGENT_TYPES.includes(agentType as AgentType);
}

function pickMissing(config: { provider: string | null; model_key: string | null; prompt_template: string | null }): string[] {
  const missing: string[] = [];
  REQUIRED_FIELDS.forEach((field) => {
    const value = config[field];
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      missing.push(field);
    }
  });
  return missing;
}

router.get('/:projectId/agents/:agentType/config', async (req, res) => {
  const projectId = req.params.projectId;
  const agentType = req.params.agentType;

  if (!isValidAgentType(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }

  try {
    console.log('[LOAD_CONFIG_V2] projectId=%s agent_type=%s', projectId, agentType);
    const config = await getAgentConfig(projectId, agentType);
    if (!config) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }

    const missing = pickMissing({
      provider: config.provider,
      model_key: config.model_key,
      prompt_template: config.prompt_template,
    });

    if (missing.length) {
      return res.status(409).json({ ok: false, error: 'missing_config', missing, agent_type: agentType });
    }

    return res.json({
      ok: true,
      config: {
        provider: config.provider,
        model_key: config.model_key,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        prompt_template: config.prompt_template,
      },
    });
  } catch (err: any) {
    console.error('[CONFIG_V2][GET] failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_load_config' });
  }
});

router.put('/:projectId/agents/:agentType/config', async (req, res) => {
  const projectId = req.params.projectId;
  const agentType = req.params.agentType;

  if (!isValidAgentType(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }

  const {
    provider,
    model_key,
    temperature,
    max_tokens,
    prompt_template,
  } = req.body || {};

  try {
    console.log(
      '[SAVE_CONFIG_V2] projectId=%s agent_type=%s model_key=%s provider=%s',
      projectId,
      agentType,
      model_key,
      provider,
    );

    const updated = await updateAgentConfig(projectId, agentType, {
      provider,
      model_key,
      temperature,
      max_tokens,
      prompt_template,
    });

    if (!updated) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }

    return res.json({ ok: true, agent_type: agentType });
  } catch (err: any) {
    console.error('[CONFIG_V2][PUT] failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_save_config' });
  }
});

export default router;
