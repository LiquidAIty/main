import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { AgentCard, AgentConfig } from '../types/agentBuilder';
type ProjectState = {
  plan: any[];
  links: any[];
  knowledge: { nodes: any[]; edges: any[] };
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
  max: 5,
});

// Projects table lives in ag_catalog schema in your DB
const PROJECTS_TABLE = 'ag_catalog.projects';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const PROJECTS_SCHEMA = PROJECTS_TABLE.includes('.')
  ? PROJECTS_TABLE.split('.')[0]
  : 'public';
const PROJECTS_NAME = PROJECTS_TABLE.includes('.')
  ? PROJECTS_TABLE.split('.')[1]
  : PROJECTS_TABLE;

let projectColumnsPromise: Promise<Map<string, boolean>> | null = null;

async function getProjectColumns(): Promise<Map<string, boolean>> {
  if (!projectColumnsPromise) {
    projectColumnsPromise = pool
      .query(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
        [PROJECTS_SCHEMA, PROJECTS_NAME]
      )
      .then(({ rows }) => {
        const map = new Map<string, boolean>();
        rows.forEach((row) => {
          map.set(row.column_name, row.is_nullable === 'YES');
        });
        return map;
      })
      .catch(() => new Map<string, boolean>());
  }
  return projectColumnsPromise;
}

function pickOwnerId(): string | null {
  const candidate =
    process.env.AGENT_DEFAULT_OWNER_ID ||
    process.env.DEFAULT_OWNER_USER_ID ||
    process.env.DEFAULT_OWNER_ID ||
    null;
  if (candidate && UUID_REGEX.test(candidate)) {
    return candidate;
  }
  return null;
}

function hasConfig(row: any): boolean {
  const tools = Array.isArray(row.agent_tools) ? row.agent_tools : [];
  const ioSchema = row.agent_io_schema ?? {};
  const permissions = row.agent_permissions ?? {};

  return Boolean(
    (row.agent_model && row.agent_model.length > 0) ||
      (row.agent_prompt_template && row.agent_prompt_template.length > 0) ||
      tools.length > 0 ||
      (ioSchema && Object.keys(ioSchema).length > 0) ||
      (permissions && Object.keys(permissions).length > 0) ||
      (row.agent_temperature !== null && row.agent_temperature !== undefined) ||
      (row.agent_max_tokens !== null && row.agent_max_tokens !== undefined)
  );
}

function normalizeJson<TDefault>(value: unknown, fallback: TDefault): TDefault {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as TDefault;
      }
    } catch {
      // ignore parse errors and fall back
    }
  }
  if (value && typeof value === 'object') {
    return value as TDefault;
  }
  return fallback;
}

function normalizeTools(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeTools(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) {
    return { clause: 'id = $1', params: [projectId] };
  }
  // Fall back to slug/code lookup when a non-UUID id (e.g., "default") is provided
  return { clause: 'code = $1', params: [projectId] };
}

function normalizeState(value: unknown): ProjectState {
  const empty: ProjectState = { plan: [], links: [], knowledge: { nodes: [], edges: [] } };
  if (!value || typeof value !== 'object') return empty;
  const obj = value as any;
  const knowledge = obj.knowledge && typeof obj.knowledge === 'object'
    ? {
        nodes: Array.isArray(obj.knowledge.nodes) ? obj.knowledge.nodes : [],
        edges: Array.isArray(obj.knowledge.edges) ? obj.knowledge.edges : [],
      }
    : { nodes: [], edges: [] };
  return {
    plan: Array.isArray(obj.plan) ? obj.plan : [],
    links: Array.isArray(obj.links) ? obj.links : [],
    knowledge,
  };
}

export async function createProject(name: string, code?: string | null): Promise<AgentCard> {
  const columns = await getProjectColumns();
  const hasOwnerColumn = columns.has('owner_user_id');
  const ownerNullable = columns.get('owner_user_id') ?? true;
  const ownerId = pickOwnerId() ?? (ownerNullable ? null : NIL_UUID);
  const projectId = randomUUID();
  const projectCode = code?.trim() || null;
  const sql = `
    INSERT INTO ${PROJECTS_TABLE} (
      id, name, code, status,
      agent_tools, agent_io_schema, agent_permissions${hasOwnerColumn ? ', owner_user_id' : ''}
    )
    VALUES ($1, $2, $3, 'active', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb${hasOwnerColumn ? ', $4' : ''})
    ON CONFLICT (id) DO NOTHING
    RETURNING id, name, code, status
  `;
  const params = hasOwnerColumn ? [projectId, name, projectCode, ownerId] : [projectId, name, projectCode];
  const { rows } = await pool.query(sql, params);
  const row = rows[0] || { id: projectId, name, code: projectCode, status: 'active' };
  return { id: row.id, name: row.name, slug: row.code ?? null, status: row.status ?? null, hasAgentConfig: false };
}

export async function listAgentCards(userId?: string | null): Promise<AgentCard[]> {
  const params: any[] = [];
  let sql = `
    SELECT id, name, code, status,
           agent_model, agent_prompt_template, agent_tools,
           agent_io_schema, agent_temperature, agent_max_tokens, agent_permissions
    FROM ${PROJECTS_TABLE}
  `;

  if (userId) {
    sql += ' WHERE owner_user_id = $1';
    params.push(userId);
  }

  sql += ' ORDER BY updated_at DESC';

  console.log('[listAgentCards] Querying DB:', {
    table: PROJECTS_TABLE,
    hasUserId: !!userId,
    dbUrl: process.env.DATABASE_URL ? 'set' : 'NOT SET',
  });

  try {
    const { rows } = await pool.query(sql, params);
    console.log('[listAgentCards] Query success, rows:', rows.length);
    
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.code ?? null,
      status: row.status ?? null,
      hasAgentConfig: hasConfig(row),
    }));
  } catch (err: any) {
    console.error('[listAgentCards] Query failed:', {
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      table: PROJECTS_TABLE,
    });
    throw err;
  }
}

export async function getAgentConfig(projectId: string): Promise<AgentConfig | null> {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    return null;
  }

  const { clause, params } = projectLookup(trimmed);
  const { rows } = await pool.query(
    `SELECT id, name, agent_model, agent_prompt_template, agent_tools, agent_io_schema,
            agent_temperature, agent_max_tokens, agent_permissions
     FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params
  );

  if (!rows.length) return null;
  const row = rows[0];
  if (!hasConfig(row)) {
    return null;
  }

  return {
    id: trimmed,
    name: row.name,
    agent_model: row.agent_model ?? null,
    agent_prompt_template: row.agent_prompt_template ?? null,
    agent_tools: normalizeTools(row.agent_tools),
    agent_io_schema: normalizeJson(row.agent_io_schema, {} as Record<string, unknown>),
    agent_temperature: row.agent_temperature ?? null,
    agent_max_tokens: row.agent_max_tokens ?? null,
    agent_permissions: normalizeJson(row.agent_permissions, {} as Record<string, unknown>),
  };
}

export async function saveAgentConfig(config: AgentConfig): Promise<AgentConfig> {
  if (!config.id) {
    throw new Error('agent config id required');
  }

  const trimmedId = config.id.trim();
  if (!trimmedId) {
    throw new Error('agent config id required');
  }

  const agentModel = config.agent_model?.trim() || null;
  const promptTemplate = config.agent_prompt_template?.trim() || null;
  const tools = normalizeTools(config.agent_tools);
  const ioSchema = normalizeJson(config.agent_io_schema, {} as Record<string, unknown>);
  const permissions = normalizeJson(config.agent_permissions, {} as Record<string, unknown>);

  const { clause, params } = projectLookup(trimmedId);
  const { rows } = await pool.query(
    `UPDATE ${PROJECTS_TABLE}
     SET agent_model = $2,
         agent_prompt_template = $3,
         agent_tools = $4,
         agent_io_schema = $5,
         agent_temperature = $6,
         agent_max_tokens = $7,
         agent_permissions = $8,
         updated_at = NOW()
     WHERE ${clause}
     RETURNING id, name, agent_model, agent_prompt_template, agent_tools, agent_io_schema,
               agent_temperature, agent_max_tokens, agent_permissions`,
    [
      ...params,
      agentModel,
      promptTemplate,
      JSON.stringify(tools),
      JSON.stringify(ioSchema),
      config.agent_temperature ?? null,
      config.agent_max_tokens ?? null,
      JSON.stringify(permissions),
    ]
  );

  if (!rows.length) {
    // Create a project row on the fly when one does not exist yet
    const columns = await getProjectColumns();
    const hasOwnerColumn = columns.has('owner_user_id');
    const ownerNullable = columns.get('owner_user_id') ?? true;
    const ownerId = pickOwnerId() ?? (ownerNullable ? null : NIL_UUID);
    const projectId = UUID_REGEX.test(trimmedId) ? trimmedId : randomUUID();
    const projectCode = UUID_REGEX.test(trimmedId) ? config.name?.trim() || trimmedId : trimmedId;
    const projectName = config.name?.trim() || projectCode || projectId;

    const insertParams = [
      projectId,
      projectName,
      projectCode,
      'active',
      agentModel,
      promptTemplate,
      JSON.stringify(tools),
      JSON.stringify(ioSchema),
      config.agent_temperature ?? null,
      config.agent_max_tokens ?? null,
      JSON.stringify(permissions),
      ...(hasOwnerColumn ? [ownerId] : []),
    ];

    const insertSql = `
      INSERT INTO ${PROJECTS_TABLE} (
        id, name, code, status,
        agent_model, agent_prompt_template, agent_tools, agent_io_schema,
        agent_temperature, agent_max_tokens, agent_permissions${hasOwnerColumn ? ', owner_user_id' : ''}
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11${hasOwnerColumn ? ', $12' : ''}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        code = EXCLUDED.code,
        status = EXCLUDED.status,
        agent_model = EXCLUDED.agent_model,
        agent_prompt_template = EXCLUDED.agent_prompt_template,
        agent_tools = EXCLUDED.agent_tools,
        agent_io_schema = EXCLUDED.agent_io_schema,
        agent_temperature = EXCLUDED.agent_temperature,
        agent_max_tokens = EXCLUDED.agent_max_tokens,
        agent_permissions = EXCLUDED.agent_permissions${hasOwnerColumn ? ', owner_user_id = EXCLUDED.owner_user_id' : ''}
      RETURNING id, name, agent_model, agent_prompt_template, agent_tools, agent_io_schema,
                agent_temperature, agent_max_tokens, agent_permissions
    `;

    const inserted = await pool.query(insertSql, insertParams);
    if (!inserted.rows.length) {
      throw new Error('agent not found');
    }
    rows.push(inserted.rows[0]);
  }

  const row = rows[0];

  return {
    id: row.id,
    name: row.name,
    agent_model: row.agent_model ?? null,
    agent_prompt_template: row.agent_prompt_template ?? null,
    agent_tools: normalizeTools(row.agent_tools),
    agent_io_schema: normalizeJson(row.agent_io_schema, {} as Record<string, unknown>),
    agent_temperature: row.agent_temperature ?? null,
    agent_max_tokens: row.agent_max_tokens ?? null,
    agent_permissions: normalizeJson(row.agent_permissions, {} as Record<string, unknown>),
  };
}

export async function getProjectState(projectId: string): Promise<ProjectState> {
  const { clause, params } = projectLookup(projectId);
  const { rows } = await pool.query(
    `SELECT agent_io_schema FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params
  );
  if (!rows.length) {
    throw new Error('project not found');
  }
  const ioSchema = normalizeJson(rows[0].agent_io_schema, {} as Record<string, unknown>);
  return normalizeState((ioSchema as any).builder_state);
}

export async function saveProjectState(projectId: string, state: ProjectState): Promise<ProjectState> {
  const { clause, params } = projectLookup(projectId);
  const { rows } = await pool.query(
    `SELECT agent_io_schema FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params
  );
  if (!rows.length) {
    throw new Error('project not found');
  }
  const ioSchema = normalizeJson(rows[0].agent_io_schema, {} as Record<string, unknown>);
  const nextSchema = { ...ioSchema, builder_state: state };
  await pool.query(
    `UPDATE ${PROJECTS_TABLE} SET agent_io_schema = $2, updated_at = NOW() WHERE ${clause}`,
    [...params, JSON.stringify(nextSchema)]
  );
  return state;
}

export async function getAssistAssignments(projectId: string): Promise<{
  assist_main_agent_id: string | null;
  assist_kg_ingest_agent_id: string | null;
}> {
  const { clause, params } = projectLookup(projectId);
  
  // Check which columns exist in the schema
  const columns = await getProjectColumns();
  const hasMainAgent = columns.has('assist_main_agent_id');
  const hasKgAgent = columns.has('assist_kg_ingest_agent_id');
  
  // Build SELECT clause with only existing columns
  const selectCols: string[] = ['id'];
  if (hasMainAgent) selectCols.push('assist_main_agent_id');
  if (hasKgAgent) selectCols.push('assist_kg_ingest_agent_id');
  
  const { rows } = await pool.query(
    `SELECT ${selectCols.join(', ')} FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw new Error('project not found');
  }
  const row = rows[0];
  return {
    assist_main_agent_id: hasMainAgent ? (row.assist_main_agent_id || null) : null,
    assist_kg_ingest_agent_id: hasKgAgent ? (row.assist_kg_ingest_agent_id || null) : null,
  };
}

export async function setAssistAssignments(
  projectId: string,
  assignments: { assist_main_agent_id?: string | null; assist_kg_ingest_agent_id?: string | null },
): Promise<{
  assist_main_agent_id: string | null;
  assist_kg_ingest_agent_id: string | null;
}> {
  const updates: string[] = [];
  const updateParams: any[] = [];

  if ('assist_main_agent_id' in assignments) {
    updates.push(`assist_main_agent_id = $${updateParams.length + 1}`);
    updateParams.push(assignments.assist_main_agent_id ?? null);
  }
  if ('assist_kg_ingest_agent_id' in assignments) {
    updates.push(`assist_kg_ingest_agent_id = $${updateParams.length + 1}`);
    updateParams.push(assignments.assist_kg_ingest_agent_id ?? null);
  }

  if (!updates.length) {
    return getAssistAssignments(projectId);
  }

  // projectLookup for WHERE clause; append project param last
  const { clause, params } = projectLookup(projectId);
  const whereParamIndex = updateParams.length + 1;
  const whereClause = clause.replace('$1', `$${whereParamIndex}`);

  const sql = `UPDATE ${PROJECTS_TABLE} SET ${updates.join(', ')} WHERE ${whereClause} RETURNING assist_main_agent_id, assist_kg_ingest_agent_id`;
  const { rows } = await pool.query(sql, [...updateParams, ...params]);
  if (!rows.length) {
    throw new Error('project not found');
  }
  const row = rows[0];
  return {
    assist_main_agent_id: row.assist_main_agent_id || null,
    assist_kg_ingest_agent_id: row.assist_kg_ingest_agent_id || null,
  };
}
