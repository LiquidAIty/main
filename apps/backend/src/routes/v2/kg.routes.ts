import { Router } from 'express';
import { pool } from '../../db/pool';
import { createHash } from 'crypto';
import { resolveKgIngestAgent } from '../../services/resolveAgents';
import { runCypherOnGraph } from '../../services/graphService';
import { chunkTextStrictJSON, extractKgFromChunks, type KgEntity, type KgRelationship, type LlmMeta } from './chunking';
import { runKgQuery } from './query';
import {
  enqueueKgIngestJob,
  registerKgIngestWorker,
  type KgIngestQueueJob,
} from '../../services/v2/kgIngestQueue';

const router = Router({ mergeParams: true });
const GRAPH_NAME = 'graph_liq';
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
      node_count: Number((nodeRow as any)?.c ?? 0),
      edge_count: Number((edgeRow as any)?.c ?? 0),
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

  try {
    let resolved = null;
    try {
      resolved = await resolveKgIngestAgent(projectId, '/api/v2/projects/:projectId/kg/ingest_chat_turn');
    } catch (err: any) {
      const code = err?.message || 'kg_ingest_resolve_failed';
      console.warn('[KG_V2][ingest] resolve failed:', code);
      resolved = { error_code: code };
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
    const systemPrompt = resolved?.systemPrompt ?? null;
    const agentId = resolved?.agentId ?? null;
    const responseFormat = (resolved as any)?.responseFormat ?? null;
    const topP = (resolved as any)?.topP ?? null;
    const previousResponseId = (resolved as any)?.previousResponseId ?? null;
    const temperature = (resolved as any)?.temperature ?? null;
    const maxTokens = (resolved as any)?.maxTokens ?? null;

    console.log('[KG_V2][WORK] start', {
      projectId,
      doc_id: docId,
      agent_id: agentId,
      model: modelKey,
    });

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
        const chunked = await chunkTextStrictJSON({
          modelKey: modelKey as string,
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
        if (err?.code === 'openai_request_aborted') {
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
      errors.push('openai_request_aborted');
      errorMessages.push('openai request aborted');
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
    if (!aborted && !errors.length && chunks.length > 0 && modelKey && systemPrompt && typeof maxTokens === 'number') {
      try {
        const extracted = await extractKgFromChunks({
          modelKey: modelKey as string,
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
        extractMeta = extracted.meta;
      } catch (err: any) {
        if (err?.code === 'openai_request_aborted') {
          aborted = true;
          if (errors.length === 0) {
            errors.push('openai_request_aborted');
            errorMessages.push('openai request aborted');
          }
        } else {
          const code = err?.code || 'extract_failed';
          lastError = err;
          errors.push(code);
          errorMessages.push(err?.message || String(err));
        }
      }
    }

    if (!aborted && (entities.length || relationships.length)) {
      const entityLookup = new Map(entities.map((e) => [e.id, e]));
      entitiesWritten = await upsertEntities(projectId, entities, provenance);
      relationshipsWritten = await upsertRelationships(projectId, relationships, entityLookup, provenance);
    }

    const requestId = extractMeta?.request_id || chunkMeta?.request_id || null;
    const elapsedMs = extractMeta?.elapsed_ms || chunkMeta?.elapsed_ms || null;
    const finishReason = extractMeta?.finish_reason || chunkMeta?.finish_reason || null;
    const usage = extractMeta?.usage || chunkMeta?.usage || null;
    const providerForLog = provider ?? null;
    const modelKeyForLog = modelKey ?? null;
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
      error: errors.length ? (lastError?.message || errorCode) : null,
    });
  } finally {
    inflightDocs.delete(docId);
  }
}

registerKgIngestWorker(async (job) => {
  await runQueuedIngestJob(job);
});

router.post('/ingest_chat_turn', async (req, res) => {
  const projectId = String((req.params as any).projectId || '');
  const { turn_id, user_text, assistant_text, src, mode } = req.body || {};

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

  return res.status(202).json({
    ok: true,
    queued: queued.queued,
    doc_id: docId,
    src: finalSrc,
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

