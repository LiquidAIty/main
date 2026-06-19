// Smallest source-backed KnowGraph record write + read-back. KnowGraph store is Neo4j
// (same backend as kgNeo4jSink). This stores ONE `:KnowGraphSourceRecord` per static
// source chunk, keyed by project_id + source_ref (queryable), with the normalized
// extraction (entities/relations/categories/assertions) as JSON properties — symmetric
// to the ThinkGraph :SlmGraphRecord pattern but in Neo4j. The Neo4j runner is injectable
// so the write/read contract is unit-testable without a live DB. No fake success.
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';

export type KnowGraphSourceRecord = {
  projectId: string;
  sourceRef: string;
  sourceType: 'static_source_chunk';
  title?: string;
  url?: string;
  textHash?: string;
  entities: Array<{ id?: string; label: string; type: string; confidence?: number | null; evidence?: string }>;
  relations: Array<{ from: string; to: string; type: string; confidence?: number | null; evidence?: string }>;
  categories?: string[];
  assertions?: Array<{ subject?: string; predicate?: string; object?: string; evidence?: string; confidence?: number | null }>;
  sourceRefs: Array<{ ref: string; kind?: string }>;
  confidence?: number | null;
  uncertainty?: string[];
  createdBy: 'slmGraphWorker' | 'staticKnowGraphProbe';
};

export type StoredKnowGraphSourceRecord = {
  projectId: string;
  sourceRef: string;
  sourceType: string;
  title: string;
  url: string;
  textHash: string;
  entities: KnowGraphSourceRecord['entities'];
  relations: KnowGraphSourceRecord['relations'];
  categories: string[];
  assertions: NonNullable<KnowGraphSourceRecord['assertions']>;
  sourceRefs: KnowGraphSourceRecord['sourceRefs'];
  confidence: number | null;
  uncertainty: string[];
  createdBy: string;
};

export type KnowGraphWriteResult =
  | { ok: true; sourceRef: string }
  | { ok: false; reason: 'knowgraph_write_failed'; error: string };

export type KnowGraphReadResult =
  | { ok: true; record: StoredKnowGraphSourceRecord }
  | { ok: false; reason: 'not_found' | 'knowgraph_query_failed'; error?: string };

/** Executes a Cypher statement against KnowGraph (Neo4j) and returns rows as objects. */
export type Neo4jRunner = (cypher: string, params: Record<string, unknown>) => Promise<Record<string, any>[]>;

let driver: Driver | null = null;
function getDriver(): Driver {
  if (driver) return driver;
  const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || 'changeme';
  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return driver;
}

/** Close the shared Neo4j driver (so a short-lived script process can exit cleanly). */
export async function closeKnowGraphDriver(): Promise<void> {
  if (driver) {
    const d = driver;
    driver = null;
    await d.close();
  }
}

/** Default runner: a real Neo4j session. Throws if Neo4j is unreachable/auth fails. */
const defaultRun: Neo4jRunner = async (cypher, params) => {
  const d = getDriver();
  await d.verifyConnectivity();
  const database = String(process.env.NEO4J_DATABASE || '').trim();
  const session = d.session(database ? { database } : undefined);
  try {
    const res = await session.run(cypher, params);
    return res.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
};

function jsonArr(value: unknown): any[] {
  try {
    const v = JSON.parse(String(value ?? '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter((v) => v.trim().length > 0) : [];
}

const WRITE_CYPHER = `
  MERGE (s:KnowGraphSourceRecord { project_id: $projectId, source_ref: $sourceRef })
  SET s.source_type = $sourceType,
      s.title = $title,
      s.url = $url,
      s.text_hash = $textHash,
      s.entities_json = $entitiesJson,
      s.relations_json = $relationsJson,
      s.categories = $categories,
      s.assertions_json = $assertionsJson,
      s.source_refs_json = $sourceRefsJson,
      s.confidence = $confidence,
      s.uncertainty = $uncertainty,
      s.created_by = $createdBy,
      s.updated_at = datetime(),
      s.created_at = coalesce(s.created_at, datetime())
  RETURN s.source_ref AS source_ref
`;

/** Write one source-backed KnowGraph record to Neo4j. Honest failure on DB/auth error. */
export async function writeKnowGraphSourceRecord(
  record: KnowGraphSourceRecord,
  deps: { run?: Neo4jRunner } = {},
): Promise<KnowGraphWriteResult> {
  const projectId = String(record.projectId || '').trim();
  const sourceRef = String(record.sourceRef || '').trim();
  if (!projectId || !sourceRef) {
    return { ok: false, reason: 'knowgraph_write_failed', error: 'projectId_and_sourceRef_required' };
  }
  const run = deps.run ?? defaultRun;
  try {
    await run(WRITE_CYPHER, {
      projectId,
      sourceRef,
      sourceType: record.sourceType,
      title: String(record.title ?? ''),
      url: String(record.url ?? ''),
      textHash: String(record.textHash ?? ''),
      entitiesJson: JSON.stringify(Array.isArray(record.entities) ? record.entities : []),
      relationsJson: JSON.stringify(Array.isArray(record.relations) ? record.relations : []),
      categories: strList(record.categories),
      assertionsJson: JSON.stringify(Array.isArray(record.assertions) ? record.assertions : []),
      sourceRefsJson: JSON.stringify(Array.isArray(record.sourceRefs) ? record.sourceRefs : []),
      confidence: typeof record.confidence === 'number' ? record.confidence : null,
      uncertainty: strList(record.uncertainty),
      createdBy: record.createdBy,
    });
    return { ok: true, sourceRef };
  } catch (err: any) {
    return { ok: false, reason: 'knowgraph_write_failed', error: err?.message || String(err) };
  }
}

const READ_CYPHER = `
  MATCH (s:KnowGraphSourceRecord { project_id: $projectId, source_ref: $sourceRef })
  RETURN s.project_id AS project_id, s.source_ref AS source_ref, s.source_type AS source_type,
         s.title AS title, s.url AS url, s.text_hash AS text_hash,
         s.entities_json AS entities_json, s.relations_json AS relations_json,
         s.categories AS categories, s.assertions_json AS assertions_json,
         s.source_refs_json AS source_refs_json,
         s.confidence AS confidence, s.uncertainty AS uncertainty, s.created_by AS created_by
  LIMIT 1
`;

/** Read back one KnowGraph source record by projectId + sourceRef. Honest results. */
export async function readKnowGraphSourceRecord(
  query: { projectId: string; sourceRef: string },
  deps: { run?: Neo4jRunner } = {},
): Promise<KnowGraphReadResult> {
  const projectId = String(query.projectId || '').trim();
  const sourceRef = String(query.sourceRef || '').trim();
  if (!projectId || !sourceRef) {
    return { ok: false, reason: 'not_found' };
  }
  const run = deps.run ?? defaultRun;
  let rows: Record<string, any>[];
  try {
    rows = await run(READ_CYPHER, { projectId, sourceRef });
  } catch (err: any) {
    return { ok: false, reason: 'knowgraph_query_failed', error: err?.message || String(err) };
  }
  const row = rows[0];
  if (!row) {
    return { ok: false, reason: 'not_found' };
  }
  const confidenceNum = Number(row.confidence);
  return {
    ok: true,
    record: {
      projectId: String(row.project_id ?? ''),
      sourceRef: String(row.source_ref ?? ''),
      sourceType: String(row.source_type ?? ''),
      title: String(row.title ?? ''),
      url: String(row.url ?? ''),
      textHash: String(row.text_hash ?? ''),
      entities: jsonArr(row.entities_json),
      relations: jsonArr(row.relations_json),
      categories: strList(row.categories),
      assertions: jsonArr(row.assertions_json),
      sourceRefs: jsonArr(row.source_refs_json),
      confidence: Number.isFinite(confidenceNum) ? confidenceNum : null,
      uncertainty: strList(row.uncertainty),
      createdBy: String(row.created_by ?? ''),
    },
  };
}
