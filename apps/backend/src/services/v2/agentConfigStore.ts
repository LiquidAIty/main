import { Pool } from 'pg';
import { MODEL_REGISTRY } from '../../llm/models.config';

export type AgentType = 'llm_chat' | 'kg_ingest';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
  max: 5,
});

export interface AgentConfigRecord {
  agent_id: string;
  agent_type: AgentType;
  provider: string | null;
  model_key: string | null;
  temperature: number | null;
  max_tokens: number | null;
  prompt_template: string | null;
}

export type AgentConfigPatch = Partial<Omit<AgentConfigRecord, 'agent_id' | 'agent_type'>>;

function rowToConfig(row: any): AgentConfigRecord {
  const modelKey = row.model_key ?? row.model ?? null;
  const provider = row.provider ?? (modelKey ? MODEL_REGISTRY[modelKey]?.provider ?? null : null);
  return {
    agent_id: row.agent_id,
    agent_type: row.agent_type,
    provider,
    model_key: modelKey,
    temperature: row.temperature ?? null,
    max_tokens: row.max_tokens ?? null,
    prompt_template: row.prompt_template ?? null,
  };
}

export async function getAgentConfig(projectId: string, agentType: AgentType): Promise<AgentConfigRecord | null> {
  const { rows } = await pool.query(
    `SELECT agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template
     FROM ag_catalog.project_agents
     WHERE project_id = $1 AND agent_type::text = $2 AND is_active = true
     LIMIT 1`,
    [projectId, agentType],
  );

  if (!rows.length) {
    return null;
  }

  return rowToConfig(rows[0]);
}

export async function updateAgentConfig(
  projectId: string,
  agentType: AgentType,
  patch: AgentConfigPatch,
): Promise<AgentConfigRecord | null> {
  const sets: string[] = [];
  const values: any[] = [projectId, agentType];
  let paramIndex = 3;

  if (patch.model_key !== undefined) {
    sets.push(`model = $${paramIndex}`);
    values.push(patch.model_key ?? null);
    paramIndex += 1;
    sets.push(`model_key = $${paramIndex}`);
    values.push(patch.model_key ?? null);
    paramIndex += 1;
  }

  if (patch.provider !== undefined) {
    sets.push(`provider = $${paramIndex}`);
    values.push(patch.provider ?? null);
    paramIndex += 1;
  }

  if (patch.temperature !== undefined) {
    sets.push(`temperature = $${paramIndex}`);
    values.push(patch.temperature ?? null);
    paramIndex += 1;
  }

  if (patch.max_tokens !== undefined) {
    sets.push(`max_tokens = $${paramIndex}`);
    values.push(patch.max_tokens ?? null);
    paramIndex += 1;
  }

  if (patch.prompt_template !== undefined) {
    sets.push(`prompt_template = $${paramIndex}`);
    values.push(patch.prompt_template ?? null);
    paramIndex += 1;
  }

  if (!sets.length) {
    return getAgentConfig(projectId, agentType);
  }

  sets.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `UPDATE ag_catalog.project_agents
     SET ${sets.join(', ')}
     WHERE project_id = $1 AND agent_type = $2 AND is_active = true
     RETURNING agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template`,
    values,
  );

  if (!rows.length) {
    const insertValues = [
      projectId,
      agentType,
      patch.provider ?? null,
      patch.model_key ?? null,
      patch.model_key ?? null,
      patch.temperature ?? null,
      patch.max_tokens ?? null,
      patch.prompt_template ?? null,
    ];
    const inserted = await pool.query(
      `INSERT INTO ag_catalog.project_agents
       (project_id, agent_type, is_active, provider, model, model_key, temperature, max_tokens, prompt_template)
       VALUES ($1, $2, true, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, agent_type)
       DO UPDATE SET
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         model_key = EXCLUDED.model_key,
         temperature = EXCLUDED.temperature,
         max_tokens = EXCLUDED.max_tokens,
         prompt_template = EXCLUDED.prompt_template,
         updated_at = NOW()
       RETURNING agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template`,
      insertValues,
    );
    if (!inserted.rows.length) {
      return null;
    }
    return rowToConfig(inserted.rows[0]);
  }

  return rowToConfig(rows[0]);
}
