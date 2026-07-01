import { Router } from 'express';
import { pool } from '../db/pool';
import { runCypherOnGraph } from '../services/graphService';
import { runKgQuery } from './query';


const router = Router({ mergeParams: true });
const GRAPH_NAME = 'graph_liq';
const DEFAULT_SEED_LIMIT = 220;
const DEFAULT_EXPAND_LIMIT = 120;
const MAX_QUERY_LIMIT = 1000;
const KG_VIEW_SEED_CYPHER = `
  MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId })
  WHERE ($typeFilter IS NULL OR toLower(coalesce(a.etype, 'unknown')) = $typeFilter OR toLower(coalesce(b.etype, 'unknown')) = $typeFilter)
    AND ($sinceTs IS NULL OR coalesce(r.created_at, a.created_at, b.created_at) >= $sinceTs)
    AND ($minConfidence IS NULL OR coalesce(r.confidence, 0.0) >= $minConfidence)
  RETURN {
    a_id: id(a),
    a_name: coalesce(a.name, toString(id(a))),
    a_type: coalesce(a.etype, 'unknown'),
    a_ts: coalesce(a.created_at, r.created_at, b.created_at),
    a_doc_id: coalesce(a.source.doc_id, a.source.docId, r.source.doc_id, r.source.docId),
    r_type: coalesce(r.rtype, 'related_to'),
    r_weight: coalesce(r.weight, r.confidence, 0.5),
    r_confidence: coalesce(r.confidence, r.weight, 0.5),
    r_ts: coalesce(r.created_at, a.created_at, b.created_at),
    r_doc_id: coalesce(r.source.doc_id, r.source.docId, a.source.doc_id, b.source.doc_id),
    r_snippet: coalesce(r.source.snippet, r.attrs.snippet),
    b_id: id(b),
    b_name: coalesce(b.name, toString(id(b))),
    b_type: coalesce(b.etype, 'unknown'),
    b_ts: coalesce(b.created_at, r.created_at, a.created_at),
    b_doc_id: coalesce(b.source.doc_id, b.source.docId, r.source.doc_id, r.source.docId)
  } AS row
  ORDER BY coalesce(r.created_at, a.created_at, b.created_at) DESC
  LIMIT toInteger($limit)
`;
const KG_VIEW_EXPAND_CYPHER = `
  MATCH (n:Entity { project_id: $projectId })
  WHERE id(n) = toInteger($nodeId)
  MATCH (n)-[r:REL { project_id: $projectId }]-(m:Entity { project_id: $projectId })
  WHERE ($typeFilter IS NULL OR toLower(coalesce(n.etype, 'unknown')) = $typeFilter OR toLower(coalesce(m.etype, 'unknown')) = $typeFilter)
    AND ($sinceTs IS NULL OR coalesce(r.created_at, n.created_at, m.created_at) >= $sinceTs)
    AND ($minConfidence IS NULL OR coalesce(r.confidence, 0.0) >= $minConfidence)
  RETURN {
    a_id: id(n),
    a_name: coalesce(n.name, toString(id(n))),
    a_type: coalesce(n.etype, 'unknown'),
    a_ts: coalesce(n.created_at, r.created_at, m.created_at),
    a_doc_id: coalesce(n.source.doc_id, n.source.docId, r.source.doc_id, r.source.docId),
    r_type: coalesce(r.rtype, 'related_to'),
    r_weight: coalesce(r.weight, r.confidence, 0.5),
    r_confidence: coalesce(r.confidence, r.weight, 0.5),
    r_ts: coalesce(r.created_at, n.created_at, m.created_at),
    r_doc_id: coalesce(r.source.doc_id, r.source.docId, n.source.doc_id, m.source.doc_id),
    r_snippet: coalesce(r.source.snippet, r.attrs.snippet),
    b_id: id(m),
    b_name: coalesce(m.name, toString(id(m))),
    b_type: coalesce(m.etype, 'unknown'),
    b_ts: coalesce(m.created_at, r.created_at, n.created_at),
    b_doc_id: coalesce(m.source.doc_id, m.source.docId, r.source.doc_id, r.source.docId)
  } AS row
  ORDER BY coalesce(r.created_at, n.created_at, m.created_at) DESC
  LIMIT toInteger($limit)
`;

async function getMissingLogColumns() {
  const required = [
    'project_id',
    'ts',
    'ok',
    'doc_id',
    'src',
    'raw_len',
    'chunks',
    'entities',
    'rels',
    'error_code',
    'error_message',
    'provider',
    'model_key',
    'request_id',
    'elapsed_ms',
    'finish_reason',
    'usage',
  ];
  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'ag_catalog' AND table_name = 'kg_ingest_log'`,
  );
  const existing = new Set(rows.map((r: any) => String(r.column_name)));
  return required.filter((c) => !existing.has(c));
}

function parseCountValue(row: unknown): number {
  if (typeof row === 'number' && Number.isFinite(row)) {
    return row;
  }
  if (typeof row === 'string') {
    const asNum = Number(row);
    if (Number.isFinite(asNum)) {
      return asNum;
    }
    try {
      const parsed = JSON.parse(row);
      if (typeof parsed?.c === 'number' && Number.isFinite(parsed.c)) {
        return parsed.c;
      }
      const parsedNum = Number(parsed);
      if (Number.isFinite(parsedNum)) {
        return parsedNum;
      }
    } catch {
      // ignore parse errors; fall through to 0
    }
  }
  if (row && typeof row === 'object') {
    const maybeC = Number((row as any).c);
    if (Number.isFinite(maybeC)) {
      return maybeC;
    }
  }
  return 0;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseLimit(value: unknown, fallback: number): number {
  const raw = parseOptionalNumber(value);
  if (raw == null) return fallback;
  const intVal = Math.floor(raw);
  if (!Number.isFinite(intVal) || intVal <= 0) return fallback;
  return Math.min(intVal, MAX_QUERY_LIMIT);
}

type MergedGraphEntity = {
  id: string;
  label: string;
  type: string;
};

type MergedGraphRelationship = {
  id: string;
  from: string;
  to: string;
  type: string;
};

type MergedGraphPayload = {
  entities: MergedGraphEntity[];
  relationships: MergedGraphRelationship[];
};

function asGraphRowObject(raw: unknown): Record<string, any> | null {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!parsed || typeof parsed !== 'object') return null;
  if ((parsed as any).row && typeof (parsed as any).row === 'object') {
    return (parsed as any).row as Record<string, any>;
  }
  return parsed as Record<string, any>;
}

function normalizeAgeRowsToMergedGraph(rows: unknown[]): MergedGraphPayload {
  const entityMap = new Map<string, MergedGraphEntity>();
  const relationships: MergedGraphRelationship[] = [];

  const ensureEntity = (idRaw: unknown, labelRaw: unknown, typeRaw: unknown) => {
    const id = String(idRaw ?? '').trim();
    if (!id) return;
    if (entityMap.has(id)) return;
    entityMap.set(id, {
      id,
      label: String(labelRaw ?? '').trim() || id,
      type: String(typeRaw ?? '').trim() || 'Entity',
    });
  };

  const pushRelationship = (idRaw: unknown, fromRaw: unknown, toRaw: unknown, typeRaw: unknown, idx: number) => {
    const from = String(fromRaw ?? '').trim();
    const to = String(toRaw ?? '').trim();
    if (!from || !to) return;
    const type = String(typeRaw ?? '').trim() || 'REL';
    const id = String(idRaw ?? '').trim() || `age:${from}:${type}:${to}:${idx}`;
    relationships.push({ id, from, to, type });
  };

  const extractNodeId = (obj: any): string => {
    if (!obj || typeof obj !== 'object') return '';
    if (obj.id != null) return String(obj.id);
    if (obj._id != null) return String(obj._id);
    if (obj.vid != null) return String(obj.vid);
    return '';
  };

  rows.forEach((rawRow, idx) => {
    const row = asGraphRowObject(rawRow);
    if (!row) return;

    if (row.a_id != null && row.b_id != null) {
      ensureEntity(row.a_id, row.a_name, row.a_type ?? row.a_etype ?? row.a_category);
      ensureEntity(row.b_id, row.b_name, row.b_type ?? row.b_etype ?? row.b_category);
      pushRelationship(row.r_id ?? row.edge_id, row.a_id, row.b_id, row.r_type ?? row.rel_type, idx);
      return;
    }

    if (row.a && row.b) {
      const aId = extractNodeId(row.a);
      const bId = extractNodeId(row.b);
      const aProps = (row.a as any)?.properties || row.a;
      const bProps = (row.b as any)?.properties || row.b;
      ensureEntity(aId, aProps?.name ?? aProps?.label, aProps?.etype ?? aProps?.type);
      ensureEntity(bId, bProps?.name ?? bProps?.label, bProps?.etype ?? bProps?.type);
      pushRelationship(row.r?.id ?? row.r_id ?? row.edge_id, aId, bId, row.r?.rtype ?? row.r?.type ?? row.rtype, idx);
    }
  });

  return {
    entities: Array.from(entityMap.values()),
    relationships,
  };
}

function readGraphRecordProjectId(value: any): string {
  if (!value || typeof value !== 'object') return '';
  const props =
    (value as any).properties ??
    (value as any).props ??
    (value as any).metadata ??
    value;
  return String((props as any)?.project_id ?? (props as any)?.projectId ?? '').trim();
}

function normalizeKnowgraphServiceGraph(projectId: string, payload: any): MergedGraphPayload {
  type ScopedMergedGraphEntity = MergedGraphEntity & { projectId: string };
  type ScopedMergedGraphRelationship = MergedGraphRelationship & { projectId: string };
  const rawEntities = Array.isArray(payload?.entities)
    ? payload.entities
    : Array.isArray(payload?.nodes)
      ? payload.nodes
      : [];
  const rawRelationships = Array.isArray(payload?.relationships) ? payload.relationships : [];

  if (!rawEntities.length && !rawRelationships.length) {
    return { entities: [], relationships: [] };
  }

  const scopedEntities: ScopedMergedGraphEntity[] = rawEntities
    .map((e: any) => ({
      id: String(e?.id ?? '').trim(),
      label: String(e?.label ?? e?.name ?? e?.title ?? e?.id ?? '').trim(),
      type: String(e?.type ?? e?.labels?.[0] ?? 'NeoEntity').trim() || 'NeoEntity',
      projectId: readGraphRecordProjectId(e),
    }))
    .filter((e: ScopedMergedGraphEntity) => e.id && e.projectId === projectId);

  const scopedEntityIds = new Set(scopedEntities.map((entity: ScopedMergedGraphEntity) => entity.id));
  const scopedRelationships: MergedGraphRelationship[] = rawRelationships
    .map((r: any, idx: number) => ({
      id: String(r?.id ?? `neo:rel:${idx}`).trim(),
      from: String(r?.from ?? r?.startId ?? '').trim(),
      to: String(r?.to ?? r?.endId ?? '').trim(),
      type: String(r?.type ?? 'RELATED_TO').trim() || 'RELATED_TO',
      projectId: readGraphRecordProjectId(r),
    }))
    .filter(
      (r: ScopedMergedGraphRelationship) =>
        r.from &&
        r.to &&
        r.projectId === projectId &&
        scopedEntityIds.has(r.from) &&
        scopedEntityIds.has(r.to),
    )
    .map((relationship: ScopedMergedGraphRelationship) => {
      const { projectId: _projectId, ...scopedRelationship } = relationship;
      return scopedRelationship;
    });

  return {
    entities: scopedEntities.map((entity: ScopedMergedGraphEntity) => {
      const { projectId: _projectId, ...scopedEntity } = entity;
      return scopedEntity;
    }),
    relationships: scopedRelationships,
  };
}

async function fetchKnowgraphViaService(projectId: string): Promise<MergedGraphPayload> {
  const baseUrl = String(process.env.KNOWGRAPH_URL || 'http://localhost:8001').replace(/\/+$/, '');
  const url = `${baseUrl}/graph?project_id=${encodeURIComponent(projectId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`knowgraph_service_http_${res.status}`);
  }
  const payload = await res.json();
  const normalized = normalizeKnowgraphServiceGraph(projectId, payload);
  const rawEntityCount = Array.isArray(payload?.entities)
    ? payload.entities.length
    : Array.isArray(payload?.nodes)
      ? payload.nodes.length
      : 0;
  const rawRelationshipCount = Array.isArray(payload?.relationships) ? payload.relationships.length : 0;
  if ((rawEntityCount > 0 || rawRelationshipCount > 0) && normalized.entities.length === 0 && normalized.relationships.length === 0) {
    throw new Error('knowgraph_service_unscoped_payload');
  }
  return normalized;
}

async function fetchKnowgraphViaNeo4j(projectId: string): Promise<MergedGraphPayload> {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !user || !password) {
    throw new Error('knowgraph_neo4j_env_missing');
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = process.env.NEO4J_DATABASE || undefined;
  const session = driver.session(database ? { database } : undefined);

  try {
    const nodeResult = await session.run(
      `
        MATCH (n)
        WHERE coalesce(n.project_id, '') = $projectId
        RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props
      `,
      { projectId },
    );

    const relResult = await session.run(
      `
        MATCH (a)-[r]->(b)
        WHERE coalesce(a.project_id, '') = $projectId
          AND coalesce(b.project_id, '') = $projectId
          AND coalesce(r.project_id, '') = $projectId
        RETURN elementId(r) AS id,
               type(r) AS type,
               elementId(a) AS startId,
               elementId(b) AS endId
      `,
      { projectId },
    );

    const neoEntities: MergedGraphEntity[] = nodeResult.records.map((record: any) => {
      const originalId = String(record.get('id'));
      const labels = Array.isArray(record.get('labels')) ? (record.get('labels') as string[]) : [];
      const props = (record.get('props') || {}) as Record<string, unknown>;
      const label = String(props.name ?? props.title ?? props.id ?? originalId);
      return {
        id: `neo:${originalId}`,
        label,
        type: String(labels[0] || 'NeoEntity'),
      };
    });

    const neoRelationships: MergedGraphRelationship[] = relResult.records.map((record: any) => {
      const originalRelId = String(record.get('id'));
      const startId = String(record.get('startId'));
      const endId = String(record.get('endId'));
      const relType = String(record.get('type') || 'RELATED_TO');
      return {
        id: `neo:${originalRelId}`,
        from: `neo:${startId}`,
        to: `neo:${endId}`,
        type: relType,
      };
    });

    return {
      entities: neoEntities,
      relationships: neoRelationships,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

async function fetchKnowgraphMergedGraph(projectId: string): Promise<MergedGraphPayload> {
  try {
    return await fetchKnowgraphViaService(projectId);
  } catch (serviceErr: any) {
    // No /graph route yet is expected; fall back to direct Neo4j.
    return await fetchKnowgraphViaNeo4j(projectId).catch((neoErr: any) => {
      const serviceMsg = serviceErr?.message || String(serviceErr);
      const neoMsg = neoErr?.message || String(neoErr);
      throw new Error(`knowgraph_merge_failed service=${serviceMsg} neo=${neoMsg}`);
    });
  }
}

async function buildMergedAgeAndNeoGraph(projectId: string, rows: unknown[]): Promise<MergedGraphPayload> {
  const ageGraph = normalizeAgeRowsToMergedGraph(rows);
  let neoGraph: MergedGraphPayload = { entities: [], relationships: [] };

  try {
    neoGraph = await fetchKnowgraphMergedGraph(projectId);
  } catch (err: any) {
    console.warn('[KG_V2][QUERY] knowgraph merge skipped:', err?.message || err);
  }

  return {
    entities: [...ageGraph.entities, ...neoGraph.entities],
    relationships: [...ageGraph.relationships, ...neoGraph.relationships],
  };
}

router.get('/query', async (req, res) => {
  const projectId = String((req.params as any).projectId || '');
  const mode = String((req.query as any)?.query || '').trim().toUpperCase();
  const rawCypher = parseOptionalString((req.query as any)?.cypher);

  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId is required' });
  }

  let cypher = rawCypher || '';
  const queryParams: Record<string, unknown> = { projectId };

  if (mode === 'SEED' || mode === 'EXPAND') {
    const typeFilter = parseOptionalString((req.query as any)?.type);
    const sinceTs = parseOptionalString((req.query as any)?.sinceTs);
    const minConfidence = parseOptionalNumber((req.query as any)?.minConfidence);
    const limit = parseLimit(
      (req.query as any)?.limit,
      mode === 'SEED' ? DEFAULT_SEED_LIMIT : DEFAULT_EXPAND_LIMIT,
    );

    queryParams.limit = limit;
    queryParams.typeFilter = typeFilter ? typeFilter.toLowerCase() : null;
    queryParams.sinceTs = sinceTs;
    queryParams.minConfidence = minConfidence;

    if (mode === 'EXPAND') {
      const nodeId = parseOptionalString((req.query as any)?.nodeId);
      if (!nodeId) {
        return res.status(400).json({ ok: false, error: 'nodeId is required for EXPAND query' });
      }
      queryParams.nodeId = nodeId;
    }

    cypher = mode === 'SEED' ? KG_VIEW_SEED_CYPHER : KG_VIEW_EXPAND_CYPHER;
  }

  if (!cypher) {
    return res.status(400).json({ ok: false, error: 'query preset or cypher is required' });
  }

  console.log(
    '[KG_V2][QUERY][GET] projectId=%s mode=%s qlen=%d',
    projectId,
    mode || 'raw',
    cypher.length,
  );

  try {
    const rows = await runKgQuery({
      graphName: GRAPH_NAME,
      projectId,
      cypher,
      queryParams,
    });
    const mergedGraph = await buildMergedAgeAndNeoGraph(projectId, rows);
    return res.json({ ok: true, mode: mode || null, cypher, rows, ...mergedGraph });
  } catch (err: any) {
    const status =
      err?.status ??
      ((err?.message || '').toLowerCase().includes('age') ? 503 : 500);
    return res.status(status).json({ ok: false, error: err?.message || 'graph query failed' });
  }
});

router.post('/query', async (req, res) => {
  const { cypher, params } = req.body || {};
  const projectId = String((req.params as any).projectId || '');

  console.log('[KG_V2][QUERY] projectId=%s qlen=%d', projectId, typeof cypher === 'string' ? cypher.length : 0);

  try {
    const rows = await runKgQuery({
      graphName: GRAPH_NAME,
      projectId,
      cypher,
      queryParams: params,
    });
    const mergedGraph = await buildMergedAgeAndNeoGraph(projectId, rows);
    return res.json({ ok: true, rows, ...mergedGraph });
  } catch (err: any) {
    const status =
      err?.status ??
      ((err?.message || '').toLowerCase().includes('age') ? 503 : 500);
    return res.status(status).json({ ok: false, error: err?.message || 'graph query failed' });
  }
});



router.get('/status', async (req, res) => {
  const projectId = String((req.params as any).projectId || '');
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId is required' });
  }

  try {
    const missing = await getMissingLogColumns();
    if (missing.length) {
      return res.status(500).json({
        ok: false,
        error_code: 'kg_ingest_log_schema_mismatch',
        message: `Missing columns on ag_catalog.kg_ingest_log: ${missing.join(', ')}. Run db/migrations/20260120_kg_ingest_log.sql`,
      });
    }
  } catch (err: any) {
    console.warn('[KG_V2][status] schema check failed:', err?.message || err);
  }

  let chunks = 0;
  let entities = 0;
  let rels = 0;
  let lastIngest: any = null;
  let totalRows = 0;

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM ag_catalog.rag_chunks
       WHERE doc_id LIKE $1`,
      [`%:${projectId}:%`],
    );
    chunks = Number(rows?.[0]?.c ?? 0);
  } catch (err: any) {
    console.warn('[KG_V2][status] chunk count failed:', err?.message || err);
  }

  try {
    const [eRow] = await runCypherOnGraph(
      GRAPH_NAME,
      'MATCH (n:Entity { project_id: $projectId }) RETURN count(n) AS c',
      { projectId },
    );
    entities = parseCountValue(eRow);

    const [rRow] = await runCypherOnGraph(
      GRAPH_NAME,
      `MATCH (:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(:Entity { project_id: $projectId })
       RETURN count(r) AS c`,
      { projectId },
    );
    rels = parseCountValue(rRow);
  } catch (err: any) {
    console.warn('[KG_V2][status] graph count failed:', err?.message || err);
  }

  try {
    const totals = await pool.query(
      `SELECT
         COUNT(*)::int AS total_rows,
         COALESCE(SUM(chunks), 0)::int AS chunks,
         COALESCE(SUM(entities), 0)::int AS entities,
         COALESCE(SUM(rels), 0)::int AS rels
       FROM ag_catalog.kg_ingest_log
       WHERE project_id = $1`,
      [projectId],
    );
    chunks = Number(totals.rows?.[0]?.chunks ?? 0);
    entities = Number(totals.rows?.[0]?.entities ?? 0);
    rels = Number(totals.rows?.[0]?.rels ?? 0);
    totalRows = Number(totals.rows?.[0]?.total_rows ?? 0);
  } catch (err: any) {
    console.warn('[KG_V2][status] totals lookup failed:', err?.message || err);
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, ts, ok, error_code, error_message, chunks, entities, rels, provider, model_key, request_id, elapsed_ms
       FROM ag_catalog.kg_ingest_log
       WHERE project_id = $1
       ORDER BY ts DESC
       LIMIT 1`,
      [projectId],
    );
    if (rows?.length) {
      lastIngest = rows[0];
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.warn('[KG_V2][status] ingest log lookup failed:', msg);
    if (msg.includes('kg_ingest_log') && msg.includes('does not exist')) {
      return res.status(500).json({
        ok: false,
        error_code: 'kg_ingest_log_missing',
        message: 'Run db/migrations/20260120_kg_ingest_log.sql to create ag_catalog.kg_ingest_log',
      });
    }
  }

  return res.json({
    ok: true,
    totals: { chunks, entities, rels },
    last_ingest: lastIngest
      ? {
          id: lastIngest.id,
          ts: lastIngest.ts,
          last_ts: lastIngest.ts,
          ok: lastIngest.ok,
          error_code: lastIngest.error_code,
          error_message: lastIngest.error_message,
          chunks: Number(lastIngest.chunks ?? 0),
          entities: Number(lastIngest.entities ?? 0),
          rels: Number(lastIngest.rels ?? 0),
          provider: lastIngest.provider,
          model_key: lastIngest.model_key,
          request_id: lastIngest.request_id,
          elapsed_ms: lastIngest.elapsed_ms,
        }
      : null,
    last_ts: lastIngest?.ts ?? null,
    last_ok: lastIngest?.ok ?? null,
    last_error_code: lastIngest?.error_code ?? null,
    last_error_message: lastIngest?.error_message ?? null,
    total_rows: totalRows,
  });
});

export default router;
