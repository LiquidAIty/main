// Generic scoped Cypher-over-AGE runner. ThinkGraph moved to the Engraphis-v2
// Python authority (thinkGraphStore.ts never reads/writes AGE); the sole live
// caller of this file is kg.routes.ts's project-scoped KnowGraph canvas-read
// path (runKgQuery enforces `$projectId` scoping before calling in).
import { pool } from '../db/pool';

async function ensureAgeExtension() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS age');
}

export async function ensureGraph(graphName: string): Promise<void> {
  if (!graphName?.trim()) {
    throw new Error('graph name is required');
  }
  if (!/^[A-Za-z0-9_]+$/.test(graphName)) {
    throw new Error('invalid graph name');
  }

  await ensureAgeExtension();

  try {
    // AGE requires graph name as literal identifier, not parameter
    await pool.query(`SELECT ag_catalog.create_graph('${graphName}')`);
  } catch (err: any) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('already exists')) {
      return;
    }
    throw err;
  }
}

export async function runCypherOnGraph(
  graphName: string,
  cypher: string,
  params?: Record<string, unknown>
): Promise<unknown[]> {
  if (!graphName?.trim()) {
    throw new Error('graph name is required');
  }
  if (!/^[A-Za-z0-9_]+$/.test(graphName)) {
    throw new Error('invalid graph name');
  }
  if (!cypher?.trim()) {
    throw new Error('cypher is required');
  }

  await ensureGraph(graphName);

  // AGE rejects trailing semicolons inside cypher()
  const cleaned = cypher.trim().replace(/;$/, '');

  // Prevent $$ injection in Cypher query
  if (cleaned.includes('$$')) {
    throw new Error('cypher query cannot contain $$');
  }

  // CRITICAL: Both graphName AND cypher must be literals for AGE
  // AGE expects: ag_catalog.cypher('graph_name', $$ MATCH ... $$, $1)
  // Using $$ for the Cypher query prevents "dollar-quoted string constant" error
  const sql = params
    ? `SELECT * FROM ag_catalog.cypher('${graphName}', $$ ${cleaned} $$, $1) AS (row agtype)`
    : `SELECT * FROM ag_catalog.cypher('${graphName}', $$ ${cleaned} $$) AS (row agtype)`;

  const res = await pool.query(
    sql,
    params ? [JSON.stringify(params)] : []
  );
  return res.rows.map((r) => r.row);
}
