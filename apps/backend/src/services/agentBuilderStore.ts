import { createHash, randomUUID } from 'crypto';
import { pool } from '../db/pool';
import type { AgentCard } from '../types/agentBuilder';

export type ProjectState = {
  messages: Array<{ role: 'assistant' | 'user'; text: string }>;
  plan: any;
  links: any[];
  knowledge: { nodes: any[]; edges: any[] };
};

export type ProjectCard = AgentCard & {
  isInternal: boolean;
};

export type ProjectStateMeta = {
  revision: string;
  savedAt: string | null;
};

export type ProjectStateSnapshot = {
  state: ProjectState;
  meta: ProjectStateMeta;
};

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
const BUILDER_STATE_KEY = 'builder_state';
const BUILDER_STATE_META_KEY = 'builder_state_meta';
const PROJECT_SCHEMA_CAS_RETRIES = 3;

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

function resetProjectColumnsCache(): void {
  projectColumnsPromise = null;
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

function normalizeProjectKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferProjectType(row: any): 'assist' | 'agent' {
  const explicit = String(row?.project_type ?? '').trim().toLowerCase();
  if (explicit === 'assist' || explicit === 'agent') {
    return explicit;
  }

  const codeKey = normalizeProjectKey(row?.code);
  const nameKey = normalizeProjectKey(row?.name);
  const legacyAgentKeys = new Set([
    'main-chat',
    'kg-ingest',
    'thinkgraph',
    'knowgraph',
    'neo4j',
    'research-agent',
    'agent-builder',
  ]);

  if (legacyAgentKeys.has(codeKey) || legacyAgentKeys.has(nameKey) || hasConfig(row)) {
    return 'agent';
  }

  return 'assist';
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

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) {
    return { clause: 'id = $1', params: [projectId] };
  }
  // Fall back to slug/code lookup when a non-UUID id (e.g., "default") is provided
  return { clause: 'code = $1', params: [projectId] };
}

function normalizeState(value: unknown): ProjectState {
  const empty: ProjectState = {
    messages: [],
    plan: [],
    links: [],
    knowledge: { nodes: [], edges: [] },
  };
  if (!value || typeof value !== 'object') return empty;
  const obj = value as any;
  const messages = Array.isArray(obj.messages)
    ? obj.messages
        .map((entry: any): { role: 'assistant' | 'user'; text: string } => ({
          role: entry?.role === 'assistant' ? 'assistant' : 'user',
          text: String(entry?.text ?? '').trim(),
        }))
        .filter((entry: { role: 'assistant' | 'user'; text: string }) => entry.text.length > 0)
    : [];
  const knowledge = obj.knowledge && typeof obj.knowledge === 'object'
    ? {
        nodes: Array.isArray(obj.knowledge.nodes) ? obj.knowledge.nodes : [],
        edges: Array.isArray(obj.knowledge.edges) ? obj.knowledge.edges : [],
      }
    : { nodes: [], edges: [] };
  return {
    messages,
    plan:
      Array.isArray(obj.plan) || typeof obj.plan === 'string' || (obj.plan && typeof obj.plan === 'object')
        ? obj.plan
        : [],
    links: Array.isArray(obj.links) ? obj.links : [],
    knowledge,
  };
}

function hashRevision(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value ?? null), 'utf8').digest('hex');
}

function normalizeProjectStateMeta(value: unknown, state: ProjectState): ProjectStateMeta {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const revision = String(raw.revision || '').trim() || `legacy:${hashRevision(state)}`;
  const savedAt = typeof raw.savedAt === 'string' && raw.savedAt.trim() ? raw.savedAt.trim() : null;
  return { revision, savedAt };
}

async function loadProjectSchema(projectId: string): Promise<{
  clause: string;
  params: any[];
  ioSchema: Record<string, unknown>;
}> {
  const { clause, params } = projectLookup(projectId);
  const { rows } = await pool.query(
    `SELECT agent_io_schema FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw new Error('project not found');
  }
  return {
    clause,
    params,
    ioSchema: normalizeJson(rows[0].agent_io_schema, {} as Record<string, unknown>),
  };
}

async function writeProjectSchemaCas(
  projectId: string,
  updater: (ioSchema: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < PROJECT_SCHEMA_CAS_RETRIES; attempt += 1) {
    const { clause, params, ioSchema } = await loadProjectSchema(projectId);
    const nextSchema = updater(ioSchema);
    const result = await pool.query(
      `UPDATE ${PROJECTS_TABLE}
       SET agent_io_schema = $${params.length + 1}::jsonb, updated_at = NOW()
       WHERE ${clause}
         AND COALESCE(agent_io_schema, '{}'::jsonb) = $${params.length + 2}::jsonb
       RETURNING agent_io_schema`,
      [...params, JSON.stringify(nextSchema), JSON.stringify(ioSchema)],
    );
    if (result.rows.length > 0) {
      return normalizeJson(result.rows[0].agent_io_schema, {} as Record<string, unknown>);
    }
  }
  throw new Error('project_state_conflict');
}

function isProjectStateConflictError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return message === 'builder_state_conflict' || message === 'project_state_conflict';
}

export async function createProject(
  name: string,
  code?: string | null,
  projectType: 'assist' | 'agent' = 'agent',
  ownerUserId?: string | null,
): Promise<AgentCard> {
  const columns = await getProjectColumns();
  const hasOwnerColumn = columns.has('owner_user_id');
  const hasProjectType = columns.has('project_type');
  const ownerNullable = columns.get('owner_user_id') ?? true;
  const explicitOwnerId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
  const ownerId = explicitOwnerId || pickOwnerId() || (ownerNullable ? null : NIL_UUID);
  const projectId = randomUUID();
  const projectCode = code?.trim() || null;
  
  const cols = ['id', 'name', 'code', 'status', 'agent_tools', 'agent_io_schema', 'agent_permissions'];
  const vals = ['$1', '$2', '$3', "'active'", "'[]'::jsonb", "'{}'::jsonb", "'{}'::jsonb"];
  const params: any[] = [projectId, name, projectCode];
  
  if (hasOwnerColumn) {
    cols.push('owner_user_id');
    vals.push(`$${params.length + 1}`);
    params.push(ownerId);
  }
  
  if (hasProjectType) {
    cols.push('project_type');
    vals.push(`$${params.length + 1}`);
    params.push(projectType);
  }
  
  const sql = `
    INSERT INTO ${PROJECTS_TABLE} (${cols.join(', ')})
    VALUES (${vals.join(', ')})
    ON CONFLICT (id) DO NOTHING
    RETURNING id, name, code, status, ${hasProjectType ? 'project_type' : "'agent' as project_type"}
  `;
  
  const { rows } = await pool.query(sql, params);
  const row = rows[0] || { id: projectId, name, code: projectCode, status: 'active', project_type: projectType };
  
  return { id: row.id, name: row.name, code: row.code ?? null, status: row.status ?? null, hasAgentConfig: false, project_type: row.project_type || 'agent' };
}

export async function listAgentCards(userId?: string | null, projectType?: 'assist' | 'agent' | null): Promise<AgentCard[]> {
  const runQuery = async (columns: Map<string, boolean>): Promise<AgentCard[]> => {
    const hasOwnerColumn = columns.has('owner_user_id');
    const hasProjectType = columns.has('project_type');

    const selectColumn = (column: string, fallbackSql: string) =>
      columns.has(column) ? column : `${fallbackSql} as ${column}`;

    const params: any[] = [];
    const whereClauses: string[] = [];

    let sql = `
      SELECT id,
             name,
             ${selectColumn('code', 'NULL')},
             ${selectColumn('status', 'NULL')},
             ${selectColumn('agent_model', 'NULL')},
             ${selectColumn('agent_prompt_template', 'NULL')},
             ${selectColumn('agent_tools', "'[]'::jsonb")},
             ${selectColumn('agent_io_schema', "'{}'::jsonb")},
             ${selectColumn('agent_temperature', 'NULL')},
             ${selectColumn('agent_max_tokens', 'NULL')},
             ${selectColumn('agent_permissions', "'{}'::jsonb")},
             ${hasProjectType ? 'project_type' : "'agent' as project_type"}
      FROM ${PROJECTS_TABLE}
    `;

    if (userId && hasOwnerColumn) {
      whereClauses.push(`owner_user_id = $${params.length + 1}`);
      params.push(userId);
    }

    if (whereClauses.length > 0) {
      sql += ' WHERE ' + whereClauses.join(' AND ');
    }

    sql += columns.has('updated_at')
      ? ' ORDER BY updated_at DESC'
      : columns.has('created_at')
        ? ' ORDER BY created_at DESC'
        : ' ORDER BY name ASC';

    if (process.env.LOG_LEVEL === 'debug') {
      console.log('[listAgentCards] Querying DB:', {
        table: PROJECTS_TABLE,
        hasUserId: !!userId,
        dbUrl: process.env.DATABASE_URL ? 'set' : 'NOT SET',
      });
    }

    const { rows } = await pool.query(sql, params);
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('[listAgentCards] Query success, rows:', rows.length);
    }

    return rows
      .map((row) => {
        const effectiveProjectType =
          hasProjectType ? inferProjectType(row) : 'agent';
        return {
          id: row.id,
          name: row.name,
          code: row.code ?? null,
          status: row.status ?? null,
          hasAgentConfig: hasConfig(row),
          project_type: effectiveProjectType,
        };
      })
      .filter((row) => !projectType || row.project_type === projectType);
  };

  const isUndefinedColumnError = (err: any): boolean =>
    err?.code === '42703' || /column .* does not exist/i.test(String(err?.message || ''));

  try {
    return await runQuery(await getProjectColumns());
  } catch (err: any) {
    if (isUndefinedColumnError(err)) {
      console.warn('[listAgentCards] Query hit schema drift, retrying with refreshed columns', {
        message: err?.message,
        code: err?.code,
        detail: err?.detail,
        table: PROJECTS_TABLE,
      });
      resetProjectColumnsCache();
      try {
        return await runQuery(await getProjectColumns());
      } catch (retryErr: any) {
        if (isUndefinedColumnError(retryErr)) {
          console.warn('[listAgentCards] Schema drift persisted, returning empty project list', {
            message: retryErr?.message,
            code: retryErr?.code,
            detail: retryErr?.detail,
            table: PROJECTS_TABLE,
          });
          return [];
        }
        console.error('[listAgentCards] Query failed after schema refresh:', {
          message: retryErr?.message,
          code: retryErr?.code,
          detail: retryErr?.detail,
          table: PROJECTS_TABLE,
        });
        throw retryErr;
      }
    }

    console.error('[listAgentCards] Query failed:', {
      message: err?.message,
      code: err?.code,
      detail: err?.detail,
      table: PROJECTS_TABLE,
    });
    throw err;
  }
}

function isInternalProjectValue(...values: unknown[]): boolean {
  return values.some((value) => normalizeProjectKey(value) === 'admin');
}

export async function getProjectCard(projectId: string): Promise<ProjectCard | null> {
  const trimmed = String(projectId || '').trim();
  if (!trimmed) return null;

  const { clause, params } = projectLookup(trimmed);
  const { rows } = await pool.query(`SELECT * FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`, params);
  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status ?? null,
    hasAgentConfig: hasConfig(row),
    project_type: inferProjectType(row),
    isInternal: isInternalProjectValue(trimmed, row.id, row.code, row.name),
  };
}

export async function getProjectStateSnapshot(projectId: string): Promise<ProjectStateSnapshot> {
  const { ioSchema } = await loadProjectSchema(projectId);
  const state = normalizeState((ioSchema as any)[BUILDER_STATE_KEY]);
  const meta = normalizeProjectStateMeta((ioSchema as any)[BUILDER_STATE_META_KEY], state);
  return { state, meta };
}

export async function saveProjectState(
  projectId: string,
  state: ProjectState,
  options?: {
    expectedRevision?: string | null;
    onConflict?: 'throw' | 'return_current';
  },
): Promise<ProjectStateSnapshot & { applied: boolean }> {
  const nextState = normalizeState(state);
  const expectedRevision = String(options?.expectedRevision || '').trim() || null;
  try {
    const nextSchema = await writeProjectSchemaCas(projectId, (ioSchema) => {
      const currentState = normalizeState((ioSchema as any)[BUILDER_STATE_KEY]);
      const currentMeta = normalizeProjectStateMeta((ioSchema as any)[BUILDER_STATE_META_KEY], currentState);
      if (expectedRevision && currentMeta.revision !== expectedRevision) {
        throw new Error('builder_state_conflict');
      }
      const nextMeta: ProjectStateMeta = {
        revision: randomUUID(),
        savedAt: new Date().toISOString(),
      };
      return {
        ...ioSchema,
        [BUILDER_STATE_KEY]: nextState,
        [BUILDER_STATE_META_KEY]: nextMeta,
      };
    });
    const savedState = normalizeState((nextSchema as any)[BUILDER_STATE_KEY]);
    const savedMeta = normalizeProjectStateMeta((nextSchema as any)[BUILDER_STATE_META_KEY], savedState);
    return {
      state: savedState,
      meta: savedMeta,
      applied: true,
    };
  } catch (err) {
    if (options?.onConflict === 'return_current' && isProjectStateConflictError(err)) {
      const snapshot = await getProjectStateSnapshot(projectId);
      return { ...snapshot, applied: false };
    }
    throw err;
  }
}
