// @graph entity: PlanWiki
// @graph role: planning-surface
// @graph relates_to: ThinkGraph, KnowGraph
// @graph depends_on: Postgres
// @graph feeds_to: Magentic-One Runtime
import { pool } from '../db/pool';

// Current persisted PlanWiki storage is intentionally human-facing.
export type Message = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  text: string;
  turnId: string | null;
  createdAt: string;
};

export type PlanWiki = {
  id: string;
  projectId: string;
  anchor: string;
  whatChanged: string[];
  openQuestions: string[];
  sources: string[];
  deltaSummary: string;
  status: 'draft' | 'grounded' | 'revised';
  turnId: string | null;
  lastUserMessage: string;
  updatedAt: string;
};

export async function saveMessage(
  projectId: string,
  role: 'user' | 'assistant',
  text: string,
  turnId: string | null = null,
): Promise<Message> {
  const id = `msg:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO ag_catalog.messages (id, project_id, role, text, turn_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, projectId, role, text, turnId, createdAt],
  );

  return { id, projectId, role, text, turnId, createdAt };
}

export async function getMessages(projectId: string, limit = 100): Promise<Message[]> {
  const result = await pool.query(
    `SELECT id, project_id, role, text, turn_id, created_at
     FROM ag_catalog.messages
     WHERE project_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [projectId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    text: row.text,
    turnId: row.turn_id,
    createdAt: row.created_at,
  }));
}

export async function savePlanWiki(
  projectId: string,
  data: Omit<PlanWiki, 'id' | 'projectId' | 'updatedAt'>,
): Promise<PlanWiki> {
  const id = `plan:${projectId}`;
  const updatedAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO ag_catalog.plan_wiki (id, project_id, anchor, what_changed, open_questions, sources, delta_summary, status, turn_id, last_user_message, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       anchor = EXCLUDED.anchor,
       what_changed = EXCLUDED.what_changed,
       open_questions = EXCLUDED.open_questions,
       sources = EXCLUDED.sources,
       delta_summary = EXCLUDED.delta_summary,
       status = EXCLUDED.status,
       turn_id = EXCLUDED.turn_id,
       last_user_message = EXCLUDED.last_user_message,
       updated_at = EXCLUDED.updated_at`,
    [
      id,
      projectId,
      data.anchor,
      JSON.stringify(data.whatChanged),
      JSON.stringify(data.openQuestions),
      JSON.stringify(data.sources),
      data.deltaSummary,
      data.status,
      data.turnId,
      data.lastUserMessage,
      updatedAt,
    ],
  );

  return { id, projectId, ...data, updatedAt };
}

export async function getPlanWiki(projectId: string): Promise<PlanWiki | null> {
  const result = await pool.query(
    `SELECT id, project_id, anchor, what_changed, open_questions, sources, delta_summary, status, turn_id, last_user_message, updated_at
     FROM ag_catalog.plan_wiki
     WHERE project_id = $1`,
    [projectId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    projectId: row.project_id,
    anchor: row.anchor,
    whatChanged: JSON.parse(row.what_changed || '[]'),
    openQuestions: JSON.parse(row.open_questions || '[]'),
    sources: JSON.parse(row.sources || '[]'),
    deltaSummary: row.delta_summary,
    status: row.status,
    turnId: row.turn_id,
    lastUserMessage: row.last_user_message,
    updatedAt: row.updated_at,
  };
}
