import { Router } from 'express';
import { Pool } from 'pg';
import { getAgentConfig, updateAgentConfig, type AgentType } from '../../services/v2/agentConfigStore';

const router = Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
  max: 5,
});
let warnedMissingVersionsTable = false;
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
    console.log('[CONFIG_V2][GET] input', { projectId, agentType });
    const config = await getAgentConfig(projectId, agentType);
    if (!config) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }

    const missing = pickMissing({
      provider: config.provider,
      model_key: config.model_key,
      prompt_template: config.prompt_template,
    });

    return res.json({
      ok: true,
      config: {
        agent_id: config.agent_id,
        provider: config.provider,
        model_key: config.model_key,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        prompt_template: config.prompt_template,
      },
      missing,
    });
  } catch (err: any) {
    console.error('[CONFIG_V2][GET] failed', {
      projectId,
      agentType,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_load_config' });
  }
});

router.put('/:projectId/agents/:agentType/config', async (req, res) => {
  const projectId = req.params.projectId;
  const agentType = req.params.agentType;

  if (!isValidAgentType(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }

  const { provider, model_key, temperature, max_tokens, prompt_template, version_note } = req.body || {};
  const normalizedPrompt = typeof prompt_template === 'string' ? prompt_template.trim() : '';

  try {
    console.log(
      '[SAVE_CONFIG_V2] projectId=%s agent_type=%s model_key=%s provider=%s',
      projectId,
      agentType,
      model_key,
      provider,
    );

    const before = await getAgentConfig(projectId, agentType);
    const updated = await updateAgentConfig(projectId, agentType, {
      provider,
      model_key,
      temperature,
      max_tokens,
      prompt_template: normalizedPrompt,
    });

    if (!updated) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }

    const beforePrompt = (before?.prompt_template || '').trim();
    const afterPrompt = (updated?.prompt_template || '').trim();
    console.log(
      '[CONFIG_V2][SAVE] projectId=%s agent_type=%s prompt_len=%s',
      projectId,
      agentType,
      afterPrompt.length,
    );
    if (afterPrompt && beforePrompt !== afterPrompt) {
      try {
        await pool.query(
          `INSERT INTO ag_catalog.project_agent_prompt_versions
           (project_id, agent_type, version_note, provider, model_key, temperature, max_tokens, prompt_template)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            projectId,
            agentType,
            version_note || null,
            updated.provider,
            updated.model_key,
            updated.temperature,
            updated.max_tokens,
            updated.prompt_template,
          ],
        );
      } catch (err: any) {
        const message = err?.message || String(err);
        if (message.includes('project_agent_prompt_versions')) {
          if (!warnedMissingVersionsTable) {
            warnedMissingVersionsTable = true;
            console.warn('[CONFIG_V2][VERSIONS] table missing, skipping insert');
          }
        } else {
          console.error('[CONFIG_V2][PUT] version insert failed', err);
        }
      }
    }

    return res.json({ ok: true, agent_type: agentType });
  } catch (err: any) {
    console.error('[CONFIG_V2][PUT] failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_save_config' });
  }
});

router.post('/:projectId/agents/:agentType/config/restore', async (req, res) => {
  const projectId = req.params.projectId;
  const agentType = req.params.agentType;
  const { version_id } = req.body || {};

  if (!isValidAgentType(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }
  if (!version_id || typeof version_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'version_id_required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, provider, model_key, temperature, max_tokens, prompt_template
       FROM ag_catalog.project_agent_prompt_versions
       WHERE id = $1 AND project_id = $2 AND agent_type = $3
       LIMIT 1`,
      [version_id, projectId, agentType],
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'version_not_found' });
    }
    const version = rows[0];
    const updated = await updateAgentConfig(projectId, agentType, {
      provider: version.provider,
      model_key: version.model_key,
      temperature: version.temperature,
      max_tokens: version.max_tokens,
      prompt_template: version.prompt_template,
    });
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }
    return res.json({ ok: true, agent_type: agentType });
  } catch (err: any) {
    const message = err?.message || String(err);
    if (message.includes('project_agent_prompt_versions')) {
      return res.status(409).json({ ok: false, error: 'versions_table_missing' });
    }
    console.error('[CONFIG_V2][RESTORE] failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_restore_config' });
  }
});

router.get('/:projectId/agents/:agentType/config/versions', async (req, res) => {
  const projectId = req.params.projectId;
  const agentType = req.params.agentType;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  if (!isValidAgentType(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, version_note, provider, model_key, temperature, max_tokens, prompt_template
       FROM ag_catalog.project_agent_prompt_versions
       WHERE project_id = $1 AND agent_type = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [projectId, agentType, limit],
    );
    return res.json({ ok: true, versions: rows });
  } catch (err: any) {
    const message = err?.message || String(err);
    if (message.includes('project_agent_prompt_versions')) {
      if (!warnedMissingVersionsTable) {
        warnedMissingVersionsTable = true;
        console.warn('[CONFIG_V2][VERSIONS] table missing, returning empty list');
      }
      return res.json({ ok: true, versions: [], versions_enabled: false });
    }
    console.error('[CONFIG_V2][VERSIONS] failed', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_load_versions' });
  }
});

export default router;
