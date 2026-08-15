import neo4j from 'neo4j-driver';
import type { Driver, Session } from 'neo4j-driver';

// ============================================================================
// KNOWGRAPH CONNECTOR (Neo4j)
// ============================================================================
// Minimal health-check connector. KnowGraph routes use neo4j-driver directly
// for query operations; this module only provides connectivity verification.
// ============================================================================

let driver: Driver | null = null;

function getNeo4jDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = String(process.env.NEO4J_PASSWORD || '').trim();
    if (!password) {
      throw new Error('missing_required_config: NEO4J_PASSWORD');
    }
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export async function pingNeo4j(): Promise<'up' | 'down'> {
  let session: Session | null = null;
  try {
    session = getNeo4jDriver().session();
    const result = await session.run('RETURN 1 AS ok');
    const ok = Number(result.records[0]?.get('ok')) === 1;
    return ok ? 'up' : 'down';
  } catch (error) {
    console.warn('[Neo4j] connectivity check failed:', error);
    return 'down';
  } finally {
    await session?.close();
  }
}
