import { Router } from 'express';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { getAssistAssignments } from '../../services/agentBuilderStore';
import { resolveKgIngestAgent } from '../../services/resolveAgents';
import { runCypherOnGraph } from '../../services/graphService';
import { chunkTextStrictJSON, extractKgFromChunks, type KgEntity, type KgRelationship, type LlmMeta } from './chunking';
import { runKgQuery } from './query';

const router = Router({ mergeParams: true });
const GRAPH_NAME = 'graph_liq';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
  max: 5,
});

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

async function insertChunks(docId: string, src: string, chunks: { text: string }[]) {
  let written = 0;
  for (const chunk of chunks) {
    const text = String(chunk.text ?? '').trim();
    if (!text) continue;
    try {
      await pool.query(
        'INSERT INTO ag_catalog.rag_chunks (doc_id, src, chunk) VALUES ($1, $2, $3)',
        [docId, src, text],
      );
      written += 1;
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
    try {
      await runCypherOnGraph(
        GRAPH_NAME,
        `
          MERGE (n:Entity { project_id: $projectId, etype: $etype, name: $name })
          ON CREATE SET n.attrs = $attrs, n.confidence = $confidence, n.created_at = datetime(), n.source = $source
          ON MATCH SET n.attrs = coalesce(n.attrs, {}) + $attrs
          RETURN n
        `,
        {
          projectId,
          etype: e.type || 'Unknown',
          name: e.name,
          attrs: { aliases: e.aliases, evidence_chunk_ids: e.evidence_chunk_ids },
          confidence: 0.5,
          source: { ...provenanceBase, evidence_chunk_ids: e.evidence_chunk_ids },
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
    try {
      await runCypherOnGraph(
        GRAPH_NAME,
        `
          MATCH (a:Entity { project_id: $projectId, etype: $fromType, name: $fromName })
          MATCH (b:Entity { project_id: $projectId, etype: $toType, name: $toName })
          MERGE (a)-[rel:REL { project_id: $projectId, rtype: $rtype }]->(b)
          ON CREATE SET rel.attrs = $attrs, rel.confidence = $confidence, rel.created_at = datetime(), rel.source = $source
          ON MATCH SET rel.attrs = coalesce(rel.attrs, {}) + $attrs
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
        },
      );
      written += 1;
    } catch (err: any) {
      console.error('[KG_V2][ingest] relation upsert failed:', err?.message || err);
    }
  }
  return written;
}

router.post('/ingest_chat_turn', async (req, res) => {
  const projectId = String((req.params as any).projectId || '');
  const { turn_id, user_text, assistant_text, src } = req.body || {};

  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId is required' });
  }

  if (!String(user_text ?? '').trim() && !String(assistant_text ?? '').trim()) {
    return res.status(400).json({ ok: false, error: 'No text to ingest' });
  }

  const assignments = await getAssistAssignments(projectId).catch(() => ({
    assist_main_agent_id: null,
    assist_kg_ingest_agent_id: null,
  }));

  let resolved = null;
  if (assignments.assist_kg_ingest_agent_id) {
    try {
      resolved = await resolveKgIngestAgent(projectId);
    } catch (err: any) {
      const code = err?.message || 'kg_ingest_resolve_failed';
      console.warn('[KG_V2][ingest] resolve failed:', code);
      resolved = { error_code: code };
    }
  }

  const docId = buildDocId(projectId, typeof turn_id === 'string' ? turn_id : null, `${user_text ?? ''}${assistant_text ?? ''}`);
  const finalSrc = typeof src === 'string' && src.trim() ? src.trim() : 'chat.auto';

  const errors: string[] = [];
  const errorMessages: string[] = [];
  if (!assignments.assist_kg_ingest_agent_id) {
    errors.push('kg_ingest_agent_missing_assist_assignment');
    errorMessages.push('assist_kg_ingest_agent_id not set for project');
  } else if (!resolved || (resolved as any).error_code) {
    const code = (resolved as any)?.error_code || 'kg_ingest_agent_missing';
    errors.push(code);
    errorMessages.push(code);
  }

  const provider = resolved?.provider ?? null;
  const modelKey = resolved?.modelKey ?? null;
  const systemPrompt = resolved?.systemPrompt ?? null;
  const agentId = resolved?.agentId ?? null;

  if (!errors.length && provider !== 'openai') {
    errors.push(`kg_ingest_provider_not_openai:${provider}`);
    errorMessages.push(`kg_ingest provider must be openai (got ${provider})`);
  }
  if (!errors.length && !modelKey) {
    errors.push('kg_ingest_model_missing');
    errorMessages.push('kg_ingest model_key missing');
  }
  if (!errors.length && !systemPrompt) {
    errors.push('kg_ingest_prompt_missing');
    errorMessages.push('kg_ingest prompt_template missing');
  }
  if (errors.length) {
    console.error('[KG_V2][ingest] config error for projectId=%s: %s', projectId, errorMessages.join('; '));
  }

  console.log('[KG_V2][ingest] start projectId=%s doc_id=%s src=%s', projectId, docId, finalSrc);

  const textToIngest = `Q:
${String(user_text ?? '').trim()}

A:
${String(assistant_text ?? '').trim()}`.trim();
  const rawLen = textToIngest.length;

  let chunkMeta: LlmMeta | null = null;
  let extractMeta: LlmMeta | null = null;
  let chunks: { chunk_id: string; text: string; start: number; end: number }[] = [];

  if (!errors.length && modelKey && systemPrompt) {
    try {
      console.log(
        '[KG_V2][ingest] using agent_id=%s prompt_len=%d model=%s',
        agentId || 'unknown',
        systemPrompt.length,
        modelKey,
      );
      const chunked = await chunkTextStrictJSON({
        modelKey: modelKey as string,
        text: textToIngest,
        systemPrompt: systemPrompt ?? undefined,
      });
      chunks = chunked.chunks;
      chunkMeta = chunked.meta;
      // chunkingRawLen = chunked.meta.raw_len || 0; // Not used, we use rawLen from textToIngest
      console.log('[KG_V2][chunk] chunks=%d', chunks.length);
    } catch (err: any) {
      const code = err?.code || 'chunking_failed';
      console.error('[KG_V2][chunk] failed:', err?.message || err);
      errors.push(code);
      errorMessages.push(err?.message || String(err));
    }
  }

  if (chunks.length === 0 && errors.length === 0) {
    errors.push('chunking_invalid_json');
    errorMessages.push('chunking returned 0 chunks');
  }

  const chunksWritten = await insertChunks(docId, finalSrc, chunks);
  const provenance = {
    doc_id: docId,
    src: finalSrc,
    method: 'kg_v2_ingest',
    createdAt: new Date().toISOString(),
  };

  let entitiesWritten = 0;
  let relationshipsWritten = 0;
  let entities: KgEntity[] = [];
  let relationships: KgRelationship[] = [];

  if (!errors.length && chunks.length > 0 && modelKey && systemPrompt) {
    try {
      const extracted = await extractKgFromChunks({
        modelKey: modelKey as string,
        chunks,
        systemPrompt: systemPrompt ?? undefined,
      });
      entities = extracted.entities;
      relationships = extracted.relationships;
      extractMeta = extracted.meta;
      console.log('[KG_V2][extract] entities=%d rels=%d', entities.length, relationships.length);
    } catch (err: any) {
      const code = err?.code || 'extract_failed';
      console.error('[KG_V2][extract] failed:', err?.message || err);
      errors.push(code);
      errorMessages.push(err?.message || String(err));
    }
  }

  if (entities.length || relationships.length) {
    const entityLookup = new Map(entities.map((e) => [e.id, e]));
    entitiesWritten = await upsertEntities(projectId, entities, provenance);
    relationshipsWritten = await upsertRelationships(projectId, relationships, entityLookup, provenance);
    console.log('[KG_V2][graph] upserts ok');
  }

  let ingestId: string | null = null;
  const requestId = extractMeta?.request_id || chunkMeta?.request_id || null;
  const elapsedMs = extractMeta?.elapsed_ms || chunkMeta?.elapsed_ms || null;
  const finishReason = extractMeta?.finish_reason || chunkMeta?.finish_reason || null;
  const usage = extractMeta?.usage || chunkMeta?.usage || null;
  const providerForLog = provider ?? null;
  const modelKeyForLog = modelKey ?? null;

  try {
    // main ingest flow already ran; always attempt to log below
  } finally {
    const errorCode = errors.length ? errors[0] : null;
    const errorMessage = errorMessages.length ? errorMessages.join('; ') : null;
    try {
      const { rows } = await pool.query(
        `INSERT INTO ag_catalog.kg_ingest_log
          (project_id, doc_id, src, raw_len, chunks, entities, rels, ok, error_code, error_message, provider, model_key, request_id, elapsed_ms, finish_reason, usage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
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
      ingestId = rows?.[0]?.id ?? null;
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[KG_V2][ingest] failed to write ingest log:', msg);
      if (msg.includes('kg_ingest_log') && msg.includes('does not exist')) {
        errors.push('kg_ingest_log_missing');
        errorMessages.push('kg_ingest_log table missing');
      }
    }
  }

  console.log(
    '[KG_V2][ingest] done ok=%s chunks=%d entities=%d rels=%d',
    errors.length === 0,
    chunksWritten,
    entitiesWritten,
    relationshipsWritten,
  );

  const usageSummary = formatUsage(usage);
  
  // SUCCESS LOG SIGNATURE CHECKLIST
  // raw_len > 0: ${chunkingRawLen > 0}
  // resolvedKgAgent: ${agentId ? 'present' : 'missing'}
  // prompt_len > 0: ${systemPrompt ? systemPrompt.length > 0 : false}
  // chunks > 0: ${chunksWritten > 0}
  // entities/rels > 0: ${entitiesWritten > 0 || relationshipsWritten > 0}
  // ok: ${errors.length === 0}
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

  const errorCode = errors.length ? errors[0] : null;
  const errorMessage = errorMessages.length ? errorMessages.join('; ') : null;

  const isConfigError =
    errorCode &&
    (errorCode.startsWith('kg_ingest_prompt_missing') ||
      errorCode.startsWith('kg_ingest_model_missing') ||
      errorCode.startsWith('kg_ingest_provider_not_openai') ||
      errorCode.startsWith('kg_ingest_agent_missing_assist_assignment') ||
      errorCode.startsWith('kg_ingest_agent_missing'));
  const status = errors.length === 0 ? 200 : isConfigError ? 409 : 502;

  return res.status(status).json({
    ok: errors.length === 0,
    ingest_id: ingestId,
    error_code: errorCode,
    error_message: errorMessage,
    counts: {
      chunks: chunksWritten,
      entities: entitiesWritten,
      rels: relationshipsWritten,
    },
  });
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
    return res.json({ ok: true, rows });
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
    entities = Number((eRow as any)?.c ?? 0);

    const [rRow] = await runCypherOnGraph(
      GRAPH_NAME,
      `MATCH (:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(:Entity { project_id: $projectId })
       RETURN count(r) AS c`,
      { projectId },
    );
    rels = Number((rRow as any)?.c ?? 0);
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
