import { pool } from '../../db/pool';
import { MODEL_REGISTRY } from '../../llm/models.config';

export type AgentType = 'llm_chat' | 'kg_ingest' | 'agent_builder';

export interface AgentConfigRecord {
  agent_id: string;
  agent_type: AgentType;
  provider: string | null;
  model_key: string | null;
  temperature: number | null;
  top_p?: number | null;
  max_tokens: number | null;
  previous_response_id?: string | null;
  response_format?: any | null;
  tools?: any[] | null;
  prompt_template: string | null;
}

export type AgentConfigPatch = Partial<Omit<AgentConfigRecord, 'agent_id' | 'agent_type'>>;

function normalizeJson<TDefault>(value: unknown, fallback: TDefault): TDefault {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as TDefault;
      }
    } catch {
      // ignore
    }
  }
  if (value && typeof value === 'object') {
    return value as TDefault;
  }
  return fallback;
}

function normalizeTools(value: unknown): any[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeTools(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.filter((v) => v !== null && v !== undefined);
  }
  return [];
}

function sectionPromptFallback(row: any): string | null {
  const rawSections: Array<[string, string]> = [
    ['Role', String(row.role_text ?? '').trim()],
    ['Goal', String(row.goal_text ?? '').trim()],
    ['Constraints', String(row.constraints_text ?? '').trim()],
    ['Input/Output Schema', String(row.io_schema_text ?? '').trim()],
    ['Memory Policy', String(row.memory_policy_text ?? '').trim()],
  ];
  const sections = rawSections.filter(([, value]) => value.length > 0);

  if (!sections.length) return null;
  return sections.map(([title, value]) => `# ${title}\n${value}`).join('\n\n');
}

function defaultAgentName(agentType: AgentType): string {
  switch (agentType) {
    case 'llm_chat':
      return 'Main Chat';
    case 'kg_ingest':
      return 'KG Ingest';
    case 'agent_builder':
      return 'Agent Builder';
    default:
      return `agent:${agentType}`;
  }
}

function rowToConfig(row: any): AgentConfigRecord {
  const modelKey = row.model_key ?? row.model ?? null;
  const provider = row.provider ?? (modelKey ? MODEL_REGISTRY[modelKey]?.provider ?? null : null);
  const promptTemplate = String(row.prompt_template ?? '').trim() || sectionPromptFallback(row);
  const maxTokens = typeof row.max_tokens === 'number' ? row.max_tokens : 2048;
  const permissions = normalizeJson(row.permissions, {} as Record<string, unknown>);
  const responseFormat =
    (permissions as any)?.text?.format ??
    (permissions as any)?.response_format ??
    null;
  const topP = typeof (permissions as any)?.top_p === 'number' ? (permissions as any).top_p : null;
  const previousResponseId =
    typeof (permissions as any)?.previous_response_id === 'string'
      ? String((permissions as any).previous_response_id)
      : null;
  const tools = normalizeTools(row.tools);
  return {
    agent_id: row.agent_id,
    agent_type: row.agent_type,
    provider,
    model_key: modelKey,
    temperature: row.temperature ?? null,
    top_p: topP,
    max_tokens: maxTokens,
    previous_response_id: previousResponseId,
    response_format: responseFormat,
    tools,
    prompt_template: promptTemplate,
  };
}

export async function getAgentConfig(projectId: string, agentType: AgentType): Promise<AgentConfigRecord | null> {
  const { rows } = await pool.query(
    `SELECT agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions,
            role_text, goal_text, constraints_text, io_schema_text, memory_policy_text
     FROM ag_catalog.project_agents
     WHERE project_id = $1 AND agent_type::text = $2 AND is_active = true
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
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

  if (patch.tools !== undefined) {
    sets.push(`tools = $${paramIndex}`);
    values.push(JSON.stringify(patch.tools ?? []));
    paramIndex += 1;
  }

  const needsPermissionsUpdate =
    patch.response_format !== undefined ||
    patch.top_p !== undefined ||
    patch.previous_response_id !== undefined;
  if (needsPermissionsUpdate) {
    const { rows: permRows } = await pool.query(
      `SELECT permissions
       FROM ag_catalog.project_agents
       WHERE project_id = $1 AND agent_type = $2 AND is_active = true
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [projectId, agentType],
    );
    const currentPermissions = normalizeJson(permRows?.[0]?.permissions, {} as Record<string, unknown>);
    const nextPermissions: Record<string, unknown> = { ...currentPermissions };
    if (patch.response_format !== undefined) {
      const nextText = {
        ...(typeof (nextPermissions as any).text === 'object' ? (nextPermissions as any).text : {}),
        format: patch.response_format ?? null,
      };
      nextPermissions.text = nextText;
      nextPermissions.response_format = patch.response_format ?? null;
    }
    if (patch.top_p !== undefined) {
      nextPermissions.top_p = patch.top_p ?? null;
    }
    if (patch.previous_response_id !== undefined) {
      nextPermissions.previous_response_id = patch.previous_response_id ?? null;
    }
    sets.push(`permissions = $${paramIndex}`);
    values.push(JSON.stringify(nextPermissions));
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
     RETURNING agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions,
               role_text, goal_text, constraints_text, io_schema_text, memory_policy_text`,
    values,
  );

  if (!rows.length) {
    const existing = await getAgentConfig(projectId, agentType);
    if (existing) {
      return existing;
    }

    const insertValues = [
      projectId,
      defaultAgentName(agentType),
      agentType,
      patch.provider ?? null,
      patch.model_key ?? null,
      patch.model_key ?? null,
      patch.temperature ?? null,
      patch.max_tokens ?? null,
      patch.prompt_template ?? null,
      JSON.stringify(patch.tools ?? []),
      JSON.stringify({
        text: { format: patch.response_format ?? null },
        response_format: patch.response_format ?? null,
        top_p: patch.top_p ?? null,
        previous_response_id: patch.previous_response_id ?? null,
      }),
    ];
    const inserted = await pool.query(
      `INSERT INTO ag_catalog.project_agents
       (project_id, name, agent_type, is_active, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions)
       VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING agent_id, agent_type, provider, model, model_key, temperature, max_tokens, prompt_template, tools, permissions,
                 role_text, goal_text, constraints_text, io_schema_text, memory_policy_text`,
      insertValues,
    );
    if (!inserted.rows.length) return null;
    return rowToConfig(inserted.rows[0]);
  }

  return rowToConfig(rows[0]);
}

