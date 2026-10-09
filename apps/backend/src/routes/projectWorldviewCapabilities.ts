import { pool } from '../db/pool';

export type ProjectWorldviewCapability = {
  capabilityId: string;
  enabled: boolean;
  controlledBy: 'user' | 'main';
  lastOrigin: 'user' | 'main' | 'worldview_card';
  mainReason: string | null;
  updatedAt: string | null;
};

type QueryResult = { rows: any[] };
type QueryLike = (sql: string, values?: unknown[]) => Promise<QueryResult>;

export type ProjectWorldviewCapabilityStore = {
  list(projectId: string): Promise<ProjectWorldviewCapability[]>;
  set(
    projectId: string,
    capabilityId: string,
    actor: 'user' | 'worldview_card',
    enabled: boolean,
  ): Promise<ProjectWorldviewCapability>;
};

function projectCapability(row: any): ProjectWorldviewCapability {
  const userEnabled = typeof row.user_enabled === 'boolean' ? row.user_enabled : null;
  const mainEnabled = typeof row.main_enabled === 'boolean' ? row.main_enabled : null;
  if (userEnabled === null && mainEnabled === null) {
    throw new Error('project_worldview_capability_state_invalid');
  }
  if (!['user', 'main', 'worldview_card'].includes(row.last_origin)) {
    throw new Error('project_worldview_capability_origin_invalid');
  }
  return {
    capabilityId: String(row.capability_id),
    enabled: userEnabled ?? mainEnabled ?? true,
    controlledBy: userEnabled !== null ? 'user' : 'main',
    lastOrigin: row.last_origin,
    mainReason: row.main_reason == null ? null : String(row.main_reason),
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at == null ? null : String(row.updated_at)),
  };
}

export function createProjectWorldviewCapabilityStore(
  query: QueryLike = pool.query.bind(pool),
): ProjectWorldviewCapabilityStore {
  return {
    async list(projectId) {
      const result = await query(
        `SELECT capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at
         FROM ag_catalog.project_worldview_capabilities
         WHERE project_id=$1
         ORDER BY capability_id`,
        [projectId],
      );
      return result.rows.map(projectCapability);
    },
    async set(projectId, capabilityId, actor, enabled) {
      const result = await query(
        `INSERT INTO ag_catalog.project_worldview_capabilities
           (project_id, capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at)
         VALUES ($1,$2,NULL,NULL,$3,$4,NOW())
         ON CONFLICT (project_id, capability_id) DO UPDATE SET
           user_enabled=EXCLUDED.user_enabled,
           last_origin=EXCLUDED.last_origin,
           updated_at=NOW()
         RETURNING capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at`,
        [projectId, capabilityId, enabled, actor],
      );
      if (result.rows.length !== 1) {
        throw new Error('project_worldview_capability_write_failed');
      }
      return projectCapability(result.rows[0]);
    },
  };
}
