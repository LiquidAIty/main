// @graph entity: MessageStore
// @graph role: chat-message-persistence
// @graph depends_on: Postgres
import { pool } from '../db/pool';

export type Message = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  text: string;
  turnId: string | null;
  createdAt: string;
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
