import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import type { AgentCard } from '../types/agentBuilder';

export type ProjectCard = AgentCard & {
  isInternal: boolean;
};

// Projects table lives in ag_catalog schema in your DB
const PROJECTS_TABLE = 'ag_catalog.projects';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeProjectKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) {
    return { clause: 'id = $1', params: [projectId] };
  }
  // Fall back to slug/code lookup when a non-UUID id (e.g., "default") is provided
  return { clause: 'code = $1', params: [projectId] };
}

export async function createProject(
  name: string,
  code?: string | null,
  projectType: 'assist' | 'agent' = 'agent',
  ownerUserId?: string | null,
): Promise<AgentCard> {
  const ownerId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
  // Prisma User ids are CUID strings; only project ids use UUIDs. The route
  // resolves this value from the authenticated session before it reaches the
  // store, so requiring UUID syntax here rejects every normal signed-in user.
  if (!ownerId) throw new Error('project_owner_required');
  const projectId = randomUUID();
  const projectCode = code?.trim() || null;

  const { rows } = await pool.query(
    `INSERT INTO ${PROJECTS_TABLE}
       (id, name, code, status, agent_tools, agent_io_schema, agent_permissions, owner_user_id, project_type)
     VALUES ($1, $2, $3, 'active', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, $4, $5)
     RETURNING id, name, code, status, project_type`,
    [projectId, name, projectCode, ownerId, projectType],
  );
  const row = rows[0];
  if (!row) throw new Error('project_create_failed');
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status ?? null,
    project_type: row.project_type,
  };
}

export async function listAgentCards(userId?: string | null, projectType?: 'assist' | 'agent' | null): Promise<AgentCard[]> {
  const params: string[] = [];
  const clauses: string[] = [];
  if (userId) {
    params.push(userId);
    clauses.push(`owner_user_id = $${params.length}`);
  }
  if (projectType) {
    params.push(projectType);
    clauses.push(`project_type = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, name, code, status, project_type
     FROM ${PROJECTS_TABLE}
     ${where}
     ORDER BY updated_at DESC`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status ?? null,
    project_type: row.project_type,
  }));
}

function isInternalProjectValue(...values: unknown[]): boolean {
  return values.some((value) => normalizeProjectKey(value) === 'admin');
}

export async function getProjectCard(projectId: string): Promise<ProjectCard | null> {
  const trimmed = String(projectId || '').trim();
  if (!trimmed) return null;

  const { clause, params } = projectLookup(trimmed);
  const { rows } = await pool.query(
    `SELECT id, name, code, status, project_type FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params,
  );
  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status ?? null,
    project_type: row.project_type,
    isInternal: isInternalProjectValue(trimmed, row.id, row.code, row.name),
  };
}
