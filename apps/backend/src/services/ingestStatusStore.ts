import { pool } from '../db/pool';

export interface IngestStatus {
  id: string;
  project_id: string;
  timestamp: Date;
  status: 'ok' | 'error';
  model_key: string;
  chunk_count?: number;
  entity_count?: number;
  relation_count?: number;
  error_message?: string;
  doc_id?: string;
  src?: string;
}

/**
 * Store ingest status for Dashboard display
 */
export async function storeIngestStatus(status: Omit<IngestStatus, 'id' | 'timestamp'>): Promise<IngestStatus> {
  const id = `ingest_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const timestamp = new Date();

  // Create table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ag_catalog.kg_ingest_log (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL,
      model_key TEXT,
      chunk_count INTEGER,
      entity_count INTEGER,
      relation_count INTEGER,
      error_message TEXT,
      doc_id TEXT,
      src TEXT
    )
  `);

  await pool.query(
    `INSERT INTO ag_catalog.kg_ingest_log 
     (id, project_id, timestamp, status, model_key, chunk_count, entity_count, relation_count, error_message, doc_id, src)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      status.project_id,
      timestamp,
      status.status,
      status.model_key,
      status.chunk_count || null,
      status.entity_count || null,
      status.relation_count || null,
      status.error_message || null,
      status.doc_id || null,
      status.src || null,
    ]
  );

  return { id, timestamp, ...status };
}

/**
 * Get last N ingest statuses for a project
 */
export async function getIngestHistory(projectId: string, limit: number = 10): Promise<IngestStatus[]> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ag_catalog.kg_ingest_log 
       WHERE project_id = $1 
       ORDER BY timestamp DESC 
       LIMIT $2`,
      [projectId, limit]
    );
    return rows;
  } catch (err: any) {
    // Table might not exist yet
    if (err.code === '42P01') {
      return [];
    }
    throw err;
  }
}

/**
 * Get last ingest status for a project
 */
export async function getLastIngestStatus(projectId: string): Promise<IngestStatus | null> {
  const history = await getIngestHistory(projectId, 1);
  return history[0] || null;
}

