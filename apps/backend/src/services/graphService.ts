import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
  max: 5,
});

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

// Backward-compatible helper (some routes import runCypher)
export async function runCypher(
  graphName: string,
  cypher: string,
  params?: Record<string, unknown>
): Promise<unknown[]> {
  return runCypherOnGraph(graphName, cypher, params);
}

export async function addDocNode(projectId: string, id: string, title: string) {
  if (!id?.trim()) {
    throw new Error('id is required');
  }
  if (!title?.trim()) {
    throw new Error('title is required');
  }

  const cypher = `
    CREATE (d:Doc {id: $id, title: $title})
    RETURN d
  `;
  const params = { id, title };
  const [row] = await runCypherOnGraph(projectId, cypher, params);
  return row;
}

export async function addRelation(
  projectId: string,
  fromId: string,
  toId: string,
  relType: string
) {
  if (!fromId?.trim() || !toId?.trim()) {
    throw new Error('fromId and toId are required');
  }

  const safeRel = (relType || 'REL')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '') || 'REL';

  const cypher = `
    MATCH (a {id: $fromId}), (b {id: $toId})
    CREATE (a)-[r:${safeRel}]->(b)
    RETURN r
  `;
  const params = { fromId, toId };
  const [row] = await runCypherOnGraph(projectId, cypher, params);
  return row;
}
