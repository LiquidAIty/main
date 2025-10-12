import neo4j from 'neo4j-driver';
import type { Driver, Session } from 'neo4j-driver';

// Singleton driver - reuse connection across app
let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'changeme';
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// Helper: upsert entity node
export async function upsertEntity(params: {
  id: string;
  labels: string[];
  properties?: Record<string, unknown>;
}): Promise<void> {
  const session: Session = getNeo4jDriver().session();
  try {
    const labelStr = params.labels.map(l => `:${l}`).join('');
    const props = { ...params.properties, id: params.id, updatedAt: new Date().toISOString() };
    await session.run(
      `MERGE (n${labelStr} {id: $id}) SET n = $props`,
      { id: params.id, props }
    );
  } finally {
    await session.close();
  }
}

// Helper: upsert relationship
export async function upsertRelation(params: {
  sourceId: string;
  targetId: string;
  type: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const session: Session = getNeo4jDriver().session();
  try {
    const props = { ...params.properties, createdAt: new Date().toISOString() };
    await session.run(
      `MATCH (a {id: $sourceId}), (b {id: $targetId})
       MERGE (a)-[r:\`${params.type}\`]->(b)
       SET r = $props`,
      { sourceId: params.sourceId, targetId: params.targetId, props }
    );
  } finally {
    await session.close();
  }
}

// Helper: upsert time-series point
export async function upsertTimeSeriesPoint(params: {
  nodeId: string;
  timestamp: number;
  value: number;
  source?: string;
}): Promise<void> {
  const session: Session = getNeo4jDriver().session();
  try {
    await session.run(
      `MATCH (n {id: $nodeId})
       MERGE (n)-[:HAS_SIGNAL]->(s:Signal {nodeId: $nodeId})
       ON CREATE SET s.points = []
       SET s.points = s.points + [{t: $t, v: $v, source: $source}]`,
      { nodeId: params.nodeId, t: params.timestamp, v: params.value, source: params.source || 'manual' }
    );
  } finally {
    await session.close();
  }
}

// Helper: upsert vector embedding
export async function upsertVector(params: {
  nodeId: string;
  embedding: number[];
}): Promise<void> {
  const session: Session = getNeo4jDriver().session();
  try {
    await session.run(
      `MATCH (n {id: $nodeId})
       SET n.embedding = $embedding`,
      { nodeId: params.nodeId, embedding: params.embedding }
    );
  } finally {
    await session.close();
  }
}

// Helper: fetch time-series points
export async function getTimeSeriesPoints(nodeId: string, limit = 100): Promise<Array<{ t: number; v: number; source?: string }>> {
  const session: Session = getNeo4jDriver().session();
  try {
    const result = await session.run(
      `MATCH (n {id: $nodeId})-[:HAS_SIGNAL]->(s:Signal)
       RETURN s.points as points`,
      { nodeId }
    );
    if (result.records.length === 0) return [];
    const points = (result.records[0].get('points') as Array<{ t: number; v: number; source?: string }> | undefined) ?? [];
    return points.slice(-limit);
  } finally {
    await session.close();
  }
}

export async function pingNeo4j(): Promise<'up' | 'down'> {
  const session = getNeo4jDriver().session();
  try {
    const result = await session.run('RETURN 1 AS ok');
    const ok = result.records[0]?.get('ok') === 1;
    return ok ? 'up' : 'down';
  } catch (error) {
    console.warn('[Neo4j] connectivity check failed:', error);
    return 'down';
  } finally {
    await session.close();
  }
}

export default { getNeo4jDriver, ping: pingNeo4j };
