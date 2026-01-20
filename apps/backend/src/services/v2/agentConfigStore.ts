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
  const modelKey = row.model ?? null;
  const provider = modelKey ? MODEL_REGISTRY[modelKey]?.provider ?? null : null;
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
    `SELECT agent_id, agent_type, model, temperature, max_tokens, prompt_template
     FROM ag_catalog.project_agents
     WHERE project_id = $1 AND agent_type = $2 AND is_active = true
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
     RETURNING agent_id, agent_type, model, temperature, max_tokens, prompt_template`,
    values,
  );

  if (!rows.length) {
    return null;
  }

  return rowToConfig(rows[0]);
}
