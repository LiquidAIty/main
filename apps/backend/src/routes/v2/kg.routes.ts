import { Router } from 'express';
import { pool } from '../../db/pool';
import { createHash } from 'crypto';
import { resolveKgIngestAgent, resolveNeo4jAgent, resolveResearchAgent } from '../../services/resolveAgents';
import { runCypherOnGraph } from '../../services/graphService';
import { chunkTextStrictJSON, extractKgFromChunks, type KgEntity, type KgRelationship, type LlmMeta } from './chunking';
import { runKgQuery } from './query';
import { syncKgToNeo4j } from '../../services/v2/kgNeo4jSink';
import { normalizeResearchTargetPacket, runResearchIngest } from '../../services/research/researchService';
import {
  enqueueKgIngestJob,
  registerKgIngestWorker,
  type KgIngestQueueJob,
} from '../../services/v2/kgIngestQueue';

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
const inflightDocs = new Set<string>();
function formatUsage(usage: any) {
  if (!usage || typeof usage !== 'object') return null;
  const summary: Record<string, number> = {};
  if (typeof usage.prompt_tokens === 'number') summary.prompt = usage.prompt_tokens;
  if (typeof usage.completion_tokens === 'number') summary.completion = usage.completion_tokens;
  if (typeof usage.total_tokens === 'number') summary.total = usage.total_tokens;
  if (typeof usage.input_tokens === 'number') summary.input = usage.input_tokens;
  if (typeof usage.output_tokens === 'number') summary.output = usage.output_tokens;
  return Object.keys(summary).length ? JSON.stringify(summary) : null;
}

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

function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

function buildDocId(projectId: string, turnId: string | null, text: string): string {
  if (turnId) {
    return `chat:${projectId}:${turnId}`;
  }
  return `chat:${projectId}:${sha1(text).slice(0, 12)}`;
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

function normalizeKnowgraphServiceGraph(payload: any): MergedGraphPayload {
  if (payload && Array.isArray(payload.entities) && Array.isArray(payload.relationships)) {
    return {
      entities: payload.entities
        .map((e: any) => ({
          id: String(e?.id ?? '').trim(),
          label: String(e?.label ?? e?.name ?? e?.title ?? e?.id ?? '').trim(),
          type: String(e?.type ?? e?.labels?.[0] ?? 'NeoEntity').trim() || 'NeoEntity',
        }))
        .filter((e: MergedGraphEntity) => e.id),
      relationships: payload.relationships
        .map((r: any, idx: number) => ({
          id: String(r?.id ?? `neo:rel:${idx}`).trim(),
          from: String(r?.from ?? r?.startId ?? '').trim(),
          to: String(r?.to ?? r?.endId ?? '').trim(),
          type: String(r?.type ?? 'RELATED_TO').trim() || 'RELATED_TO',
        }))
        .filter((r: MergedGraphRelationship) => r.from && r.to),
    };
  }
  return { entities: [], relationships: [] };
}

async function fetchKnowgraphViaService(projectId: string): Promise<MergedGraphPayload> {
  const baseUrl = String(process.env.KNOWGRAPH_URL || 'http://localhost:8001').replace(/\/+$/, '');
  const url = `${baseUrl}/graph?project_id=${encodeURIComponent(projectId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`knowgraph_service_http_${res.status}`);
  }
  const payload = await res.json();
  return normalizeKnowgraphServiceGraph(payload);
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

async function insertChunks(docId: string, src: string, chunks: { text: string }[]) {
  let written = 0;
  for (const chunk of chunks) {
    const text = String(chunk.text ?? '').trim();
    if (!text) continue;
    try {
      const result = await pool.query(
        'INSERT INTO ag_catalog.rag_chunks (doc_id, src, chunk) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [docId, src, text],
      );
      if ((result.rowCount ?? 0) > 0) {
        written += 1;
      }
    } catch (err: any) {
      console.error('[KG_V2][ingest] chunk insert failed:', err?.message || err);
    }
  }
  return written;
}

async function upsertEntities(
  projectId: string,
  entities: KgEntity[],
  provenanceBase: Record<string, unknown>,
) {
  let written = 0;
  for (const e of entities) {
    if (!e?.name) continue;
    const createdAt =
      typeof provenanceBase.createdAt === 'string'
        ? String(provenanceBase.createdAt)
        : new Date().toISOString();
    try {
      await runCypherOnGraph(
        GRAPH_NAME,
        `
          MERGE (n:Entity { project_id: $projectId, etype: $etype, name: $name })
          SET n.attrs = $attrs
          SET n.confidence = $confidence
          SET n.source = $source
          SET n.created_at = coalesce(n.created_at, $createdAt)
          RETURN n
        `,
        {
          projectId,
          etype: e.type || 'Unknown',
          name: e.name,
          attrs: { aliases: e.aliases, evidence_chunk_ids: e.evidence_chunk_ids },
          confidence: 0.5,
          source: { ...provenanceBase, evidence_chunk_ids: e.evidence_chunk_ids },
          createdAt,
        },
      );
      written += 1;
    } catch (err: any) {
      console.error('[KG_V2][ingest] entity upsert failed:', err?.message || err);
    }
  }
  return written;
}

async function upsertRelationships(
  projectId: string,
  relationships: KgRelationship[],
  entityLookup: Map<string, KgEntity>,
  provenanceBase: Record<string, unknown>,
) {
  let written = 0;
  for (const r of relationships) {
    if (!r?.from || !r?.to) continue;
    const fromEntity = entityLookup.get(r.from);
    const toEntity = entityLookup.get(r.to);
    if (!fromEntity || !toEntity) continue;
    const createdAt =
      typeof provenanceBase.createdAt === 'string'
        ? String(provenanceBase.createdAt)
        : new Date().toISOString();
    try {
      await runCypherOnGraph(
        GRAPH_NAME,
        `
          MATCH (a:Entity { project_id: $projectId, etype: $fromType, name: $fromName })
          MATCH (b:Entity { project_id: $projectId, etype: $toType, name: $toName })
          MERGE (a)-[rel:REL { project_id: $projectId, rtype: $rtype }]->(b)
          SET rel.attrs = $attrs
          SET rel.confidence = $confidence
          SET rel.source = $source
          SET rel.created_at = coalesce(rel.created_at, $createdAt)
          RETURN rel
        `,
        {
          projectId,
          fromType: fromEntity.type || 'Unknown',
          fromName: fromEntity.name,
          toType: toEntity.type || 'Unknown',
          toName: toEntity.name,
          rtype: r.type || 'REL',
          attrs: { evidence_chunk_ids: r.evidence_chunk_ids },
          confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
          source: { ...provenanceBase, evidence_chunk_ids: r.evidence_chunk_ids },
          createdAt,
        },
      );
      written += 1;
    } catch (err: any) {
      console.error('[KG_V2][ingest] relation upsert failed:', err?.message || err);
    }
  }
  return written;
}

async function verifyGraphCounts(projectId: string) {
  try {
    const [nodeRow] = await runCypherOnGraph(
      GRAPH_NAME,
      'MATCH (n:Entity { project_id: $projectId }) RETURN count(n) AS c',
      { projectId },
    );
    const [edgeRow] = await runCypherOnGraph(
      GRAPH_NAME,
      'MATCH ()-[r:REL { project_id: $projectId }]->() RETURN count(r) AS c',
      { projectId },
    );
    console.log('[KG_V2][VERIFY]', {
      projectId,
      node_count: parseCountValue(nodeRow),
      edge_count: parseCountValue(edgeRow),
    });
  } catch (err: any) {
    console.warn('[KG_V2][VERIFY] failed:', err?.message || err);
  }
}

async function runQueuedIngestJob(job: KgIngestQueueJob) {
  const projectId = job.projectId;
  const docId = job.doc_id;
  const finalSrc = job.src;
  const textToIngest = `Q:
${String(job.user_text ?? '').trim()}

A:
${String(job.assistant_text ?? '').trim()}`.trim();

  if (inflightDocs.has(docId)) {
    console.log('[KG_V2][WORK] done', {
      projectId,
      doc_id: docId,
      ok: true,
      chunks: 0,
      entities: 0,
      rels: 0,
      skipped: 'inflight',
    });
    return;
  }

  inflightDocs.add(docId);
  let aborted = false;
  let chunksWritten = 0;
  let entitiesWritten = 0;
  let relationshipsWritten = 0;
  let neo4jEntitiesWritten = 0;
  let neo4jRelationshipsWritten = 0;
  let neo4jStatus: string | null = null;

  try {
    let resolved = null;
    let neo4jResolved = null;
    try {
      resolved = await resolveKgIngestAgent(projectId, '/api/v2/projects/:projectId/kg/ingest_chat_turn');
    } catch (err: any) {
      const code = err?.message || 'kg_ingest_resolve_failed';
      console.warn('[KG_V2][ingest] resolve failed:', code);
      resolved = { error_code: code };
    }
    try {
      neo4jResolved = await resolveNeo4jAgent(projectId, '/api/v2/projects/:projectId/kg/ingest_chat_turn');
    } catch (err: any) {
      const code = err?.message || 'neo4j_resolve_failed';
      console.warn('[KG_V2][ingest] neo4j resolve failed:', code);
      neo4jResolved = null;
    }

    const errors: string[] = [];
    const errorMessages: string[] = [];
    if (!resolved || (resolved as any).error_code) {
      const code = (resolved as any)?.error_code || 'kg_ingest_agent_missing';
      errors.push(code);
      errorMessages.push(code);
    }

    const provider = resolved?.provider ?? null;
    const modelKey = resolved?.modelKey ?? null;
    const providerModelId = resolved?.providerModelId ?? null;
    const systemPrompt = resolved?.systemPrompt ?? null;
    const agentId = resolved?.agentId ?? null;
    const responseFormat = (resolved as any)?.responseFormat ?? null;
    const topP = (resolved as any)?.topP ?? null;
    const previousResponseId = (resolved as any)?.previousResponseId ?? null;
    const temperature = (resolved as any)?.temperature ?? null;
    const maxTokens = (resolved as any)?.maxTokens ?? null;

    const neo4jAgentProvider = neo4jResolved?.provider ?? null;
    const neo4jAgentModelKey = neo4jResolved?.modelKey ?? null;
    const neo4jAgentProviderModelId = neo4jResolved?.providerModelId ?? null;
    const neo4jAgentSystemPrompt = neo4jResolved?.systemPrompt ?? null;
    const neo4jAgentId = neo4jResolved?.agentId ?? null;
    const neo4jAgentResponseFormat = (neo4jResolved as any)?.responseFormat ?? null;
    const neo4jAgentTopP = (neo4jResolved as any)?.topP ?? null;
    const neo4jAgentPreviousResponseId = (neo4jResolved as any)?.previousResponseId ?? null;
    const neo4jAgentTemperature = (neo4jResolved as any)?.temperature ?? null;
    const neo4jAgentMaxTokens = (neo4jResolved as any)?.maxTokens ?? null;

    console.log('[KG_V2][WORK] start', {
      projectId,
      doc_id: docId,
      agent_id: agentId,
      thinkgraph_model: modelKey,
      neo4j_agent_id: neo4jAgentId,
      neo4j_model: neo4jAgentModelKey,
      neo4j_provider: neo4jAgentProvider,
      model: modelKey,
    });

    if (!errors.length && !modelKey) {
      errors.push('kg_ingest_model_missing');
      errorMessages.push('kg_ingest model_key missing');
    }
    if (!errors.length && !provider) {
      errors.push('kg_ingest_provider_missing');
      errorMessages.push('kg_ingest provider missing');
    }
    if (!errors.length && !providerModelId) {
      errors.push('kg_ingest_provider_model_id_missing');
      errorMessages.push('kg_ingest provider_model_id missing');
    }
    if (!errors.length && !systemPrompt) {
      errors.push('kg_ingest_prompt_missing');
      errorMessages.push('kg_ingest prompt_template missing');
    }
    if (!errors.length && typeof maxTokens !== 'number') {
      errors.push('kg_ingest_max_tokens_missing');
      errorMessages.push('kg_ingest max_output_tokens missing');
    }
    if (errors.length) {
      console.error('[KG_V2][ingest] config error for projectId=%s: %s', projectId, errorMessages.join('; '));
    }

    const rawLen = textToIngest.length;
    let chunkMeta: LlmMeta | null = null;
    let extractMeta: LlmMeta | null = null;
    let lastError: any = null;
    let chunks: { chunk_id: string; text: string; start: number; end: number }[] = [];

    if (!errors.length && modelKey && systemPrompt && typeof maxTokens === 'number') {
      try {
        console.log(
          '[RUNTIME_MODEL] route=/api/v2/projects/:projectId/kg/ingest_chat_turn projectId=%s agentType=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s',
          projectId,
          'kg_ingest',
          agentId ?? 'null',
          provider ?? 'null',
          modelKey ?? 'null',
          providerModelId ?? 'null',
        );
        console.log(
          '[THINKGRAPH_INGEST] projectId=%s documentId=%s agentType=kg_ingest agentId=%s provider=%s model=%s',
          projectId,
          docId,
          agentId ?? 'null',
          provider ?? 'null',
          providerModelId ?? modelKey ?? 'null',
        );
        const chunked = await chunkTextStrictJSON({
          modelKey: modelKey as string,
          provider: provider as string,
          providerModelId: providerModelId as string,
          text: textToIngest,
          systemPrompt: systemPrompt ?? undefined,
          responseFormat: responseFormat ?? undefined,
          temperature: typeof temperature === 'number' ? temperature : undefined,
          topP: typeof topP === 'number' ? topP : undefined,
          previousResponseId: typeof previousResponseId === 'string' ? previousResponseId : undefined,
          maxTokens,
        });
        chunks = chunked.chunks;
        chunkMeta = chunked.meta;
      } catch (err: any) {
        if (err?.code === 'openai_request_aborted' || err?.code === 'provider_request_aborted') {
          aborted = true;
        } else {
          const code = err?.code || 'chunking_failed';
          lastError = err;
          errors.push(code);
          errorMessages.push(err?.message || String(err));
        }
      }
    }

    if (aborted && errors.length === 0) {
      errors.push('provider_request_aborted');
      errorMessages.push('provider request aborted');
    }
    if (!aborted && chunks.length === 0 && errors.length === 0) {
      errors.push('chunking_invalid_json');
      errorMessages.push('chunking returned 0 chunks');
    }

    if (!aborted) {
      chunksWritten = await insertChunks(docId, finalSrc, chunks);
    }

    const provenance = {
      doc_id: docId,
      src: finalSrc,
      method: 'kg_v2_ingest',
      createdAt: new Date().toISOString(),
    };

    let entities: KgEntity[] = [];
    let relationships: KgRelationship[] = [];
    let neo4jEntities: KgEntity[] = [];
    let neo4jRelationships: KgRelationship[] = [];
    let neo4jExtractMeta: LlmMeta | null = null;
    if (!aborted && !errors.length && chunks.length > 0 && modelKey && systemPrompt && typeof maxTokens === 'number') {
      try {
        const extracted = await extractKgFromChunks({
          modelKey: modelKey as string,
          provider: provider as string,
          providerModelId: providerModelId as string,
          chunks,
          systemPrompt: systemPrompt ?? undefined,
          responseFormat: responseFormat ?? undefined,
          temperature: typeof temperature === 'number' ? temperature : undefined,
          topP: typeof topP === 'number' ? topP : undefined,
          previousResponseId: typeof previousResponseId === 'string' ? previousResponseId : undefined,
          maxTokens,
        });
        entities = extracted.entities;
        relationships = extracted.relationships;
        neo4jEntities = extracted.entities;
        neo4jRelationships = extracted.relationships;
        extractMeta = extracted.meta;
      } catch (err: any) {
        if (err?.code === 'openai_request_aborted' || err?.code === 'provider_request_aborted') {
          aborted = true;
          if (errors.length === 0) {
            errors.push('provider_request_aborted');
            errorMessages.push('provider request aborted');
          }
        } else {
          const code = err?.code || 'extract_failed';
          lastError = err;
          errors.push(code);
          errorMessages.push(err?.message || String(err));
        }
      }
    }

    const hasNeo4jAgentConfig =
      !!neo4jAgentProvider &&
      !!neo4jAgentModelKey &&
      !!neo4jAgentProviderModelId &&
      !!neo4jAgentSystemPrompt &&
      typeof neo4jAgentMaxTokens === 'number';

    if (!aborted && !errors.length && hasNeo4jAgentConfig && chunks.length > 0) {
      try {
        console.log(
          '[RUNTIME_MODEL] route=/api/v2/projects/:projectId/kg/ingest_chat_turn projectId=%s agentType=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s',
          projectId,
          'neo4j',
          neo4jAgentId,
          neo4jAgentProvider,
          neo4jAgentModelKey,
          neo4jAgentProviderModelId,
        );
        console.log(
          '[NEO4J_EXTRACT] projectId=%s documentId=%s agentType=neo4j agentId=%s provider=%s model=%s',
          projectId,
          docId,
          neo4jAgentId ?? 'null',
          neo4jAgentProvider ?? 'null',
          neo4jAgentProviderModelId ?? neo4jAgentModelKey ?? 'null',
        );
        const extractedForNeo4j = await extractKgFromChunks({
          modelKey: neo4jAgentModelKey as string,
          provider: neo4jAgentProvider as string,
          providerModelId: neo4jAgentProviderModelId as string,
          chunks,
          systemPrompt: neo4jAgentSystemPrompt ?? undefined,
          responseFormat: neo4jAgentResponseFormat ?? undefined,
          temperature: typeof neo4jAgentTemperature === 'number' ? neo4jAgentTemperature : undefined,
          topP: typeof neo4jAgentTopP === 'number' ? neo4jAgentTopP : undefined,
          previousResponseId:
            typeof neo4jAgentPreviousResponseId === 'string' ? neo4jAgentPreviousResponseId : undefined,
          maxTokens: neo4jAgentMaxTokens as number,
        });
        neo4jEntities = extractedForNeo4j.entities;
        neo4jRelationships = extractedForNeo4j.relationships;
        neo4jExtractMeta = extractedForNeo4j.meta;
      } catch (err: any) {
        console.warn('[KG_V2][NEO4J] neo4j agent extraction failed, using thinkgraph output:', err?.message || err);
      }
    }

    if (!aborted && errors.length === 0 && (entities.length || relationships.length)) {
      const entityLookup = new Map(entities.map((e) => [e.id, e]));
      entitiesWritten = await upsertEntities(projectId, entities, provenance);
      relationshipsWritten = await upsertRelationships(projectId, relationships, entityLookup, provenance);

      try {
        const neo4j = await syncKgToNeo4j({
          projectId,
          entities: neo4jEntities,
          relationships: neo4jRelationships,
          provenance,
        });
        neo4jEntitiesWritten = neo4j.entities;
        neo4jRelationshipsWritten = neo4j.rels;
        neo4jStatus = neo4j.enabled ? 'ok' : neo4j.reason || 'disabled';
      } catch (err: any) {
        neo4jStatus = 'error';
        console.warn('[KG_V2][NEO4J] dual-write failed:', err?.message || err);
      }
    }

    const requestId = neo4jExtractMeta?.request_id || extractMeta?.request_id || chunkMeta?.request_id || null;
    const elapsedMs = neo4jExtractMeta?.elapsed_ms || extractMeta?.elapsed_ms || chunkMeta?.elapsed_ms || null;
    const finishReason =
      neo4jExtractMeta?.finish_reason || extractMeta?.finish_reason || chunkMeta?.finish_reason || null;
    const usage = neo4jExtractMeta?.usage || extractMeta?.usage || chunkMeta?.usage || null;
    const providerForLog = neo4jExtractMeta?.provider ?? provider ?? null;
    const modelKeyForLog = neo4jExtractMeta ? (neo4jAgentModelKey ?? modelKey ?? null) : (modelKey ?? null);
    const errorCode = errors.length ? errors[0] : null;
    const errorMessage = errorMessages.length ? errorMessages.join('; ') : null;

    try {
      await pool.query(
        `INSERT INTO ag_catalog.kg_ingest_log
          (project_id, doc_id, src, raw_len, chunks, entities, rels, ok, error_code, error_message, provider, model_key, request_id, elapsed_ms, finish_reason, usage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          projectId,
          docId,
          finalSrc,
          rawLen,
          chunksWritten,
          entitiesWritten,
          relationshipsWritten,
          errors.length === 0,
          errorCode,
          errorMessage,
          providerForLog,
          modelKeyForLog,
          requestId,
          elapsedMs,
          finishReason,
          usage,
        ],
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[KG_V2][ingest] failed to write ingest log:', msg);
    }

    await verifyGraphCounts(projectId);

    const usageSummary = formatUsage(usage);
    console.log(
      '[KG_V2][ingest][meta] projectId=%s doc_id=%s raw_len=%d provider=%s model=%s request_id=%s elapsed_ms=%s finish=%s usage=%s',
      projectId,
      docId,
      rawLen,
      providerForLog || 'unknown',
      modelKeyForLog || 'unknown',
      requestId || 'n/a',
      elapsedMs ?? 'n/a',
      finishReason || 'n/a',
      usageSummary || 'n/a',
    );
    console.log('[KG_V2][WORK] done', {
      projectId,
      doc_id: docId,
      ok: errors.length === 0,
      chunks: chunksWritten,
      entities: entitiesWritten,
      rels: relationshipsWritten,
      neo4j_entities: neo4jEntitiesWritten,
      neo4j_rels: neo4jRelationshipsWritten,
      neo4j: neo4jStatus,
      error: errors.length ? (lastError?.message || errorCode) : null,
    });
  } finally {
    inflightDocs.delete(docId);
  }
}

registerKgIngestWorker(async (job) => {
  await runQueuedIngestJob(job);
});

async function runResearchPacketForProject(projectId: string, rawBody: any, fallbackTurnId?: string | null) {
  const packet = normalizeResearchTargetPacket(projectId, {
    ...(rawBody && typeof rawBody === 'object' ? rawBody : {}),
    turnId:
      rawBody?.turnId ??
      rawBody?.turn_id ??
      fallbackTurnId ??
      '',
  });

  if (!packet.projectId) {
    throw new Error('research_project_id_required');
  }
  if (!packet.turnId) {
    throw new Error('research_turn_id_required');
  }
  if (!packet.query) {
    throw new Error('research_query_required');
  }

  const resolved = await resolveResearchAgent(projectId, '/api/v2/projects/:projectId/kg/research');
  if (!resolved) {
    throw new Error('research_agent_not_configured');
  }

  console.log(
    '[RUNTIME_MODEL] route=/api/v2/projects/:projectId/kg/research projectId=%s agentType=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s',
    projectId,
    'research_agent',
    resolved.agentId,
    resolved.provider,
    resolved.modelKey,
    resolved.providerModelId,
  );
  console.log(
    '[RESEARCH_AGENT] projectId=%s turnId=%s query=%s agentType=research_agent agentId=%s provider=%s model=%s',
    projectId,
    packet.turnId,
    packet.query,
    resolved.agentId,
    resolved.provider,
    resolved.providerModelId,
  );

  return runResearchIngest(packet, resolved);
}

router.post('/ingest_chat_turn', async (req, res) => {
  const projectId = String((req.params as any).projectId || '');
  const { turn_id, user_text, assistant_text, src, mode, research_target } = req.body || {};

  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId is required' });
  }
  if (!String(user_text ?? '').trim() && !String(assistant_text ?? '').trim()) {
    return res.status(400).json({ ok: false, error: 'No text to ingest' });
  }

  const docId = buildDocId(projectId, typeof turn_id === 'string' ? turn_id : null, `${user_text ?? ''}${assistant_text ?? ''}`);
  const finalSrc = typeof src === 'string' && src.trim() ? src.trim() : 'chat.auto';
  const finalMode = typeof mode === 'string' && mode.trim() ? mode.trim() : 'unknown';

  console.log('[KG_V2][ENQUEUE]', {
    projectId,
    doc_id: docId,
    src: finalSrc,
    mode: finalMode,
  });

  const queued = enqueueKgIngestJob({
    projectId,
    doc_id: docId,
    src: finalSrc,
    mode: finalMode,
    user_text: String(user_text ?? ''),
    assistant_text: String(assistant_text ?? ''),
  });

  let autoResearchStarted = false;
  if (research_target && typeof research_target === 'object') {
    autoResearchStarted = true;
    void runResearchPacketForProject(projectId, research_target, typeof turn_id === 'string' ? turn_id : docId)
      .then((result) => {
        console.log('[KG_V2][RESEARCH][AUTO] ok', {
          projectId,
          turn_id: result.turn_id,
          query: result.query,
          ingested_document_count: result.ingested_document_count,
        });
      })
      .catch((err: any) => {
        console.warn('[KG_V2][RESEARCH][AUTO] failed', {
          projectId,
          turn_id: turn_id || docId,
          error: err?.message || String(err),
        });
      });
  }

  return res.status(202).json({
    ok: true,
    queued: queued.queued,
    doc_id: docId,
    src: finalSrc,
    research_started: autoResearchStarted,
  });
});

router.post('/research', async (req, res) => {
  const projectId = String((req.params as any).projectId || '').trim();
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId is required' });
  }

  try {
    const result = await runResearchPacketForProject(projectId, req.body || {});
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'research_ingest_failed',
    });
  }
});

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

