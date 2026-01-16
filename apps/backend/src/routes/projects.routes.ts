import { Router } from 'express';
import {
  getProjectState,
  saveProjectState,
  createProject,
  listAgentCards,
  getAssistAssignments,
} from '../services/agentBuilderStore';
import {
  getAgentConfig,
  saveAgentConfig,
} from '../services/agentBuilderStore';
import { runCypherOnGraph } from '../services/graphService';
import { runLLM } from '../llm/client';
import { createOpenRouterEmbedding } from '../llm/openrouterEmbeddings';
import { MODEL_REGISTRY, listModels } from '../llm/models.config';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { getLastTrace, getTraces } from '../services/ingestTrace';
const router = Router();
const GRAPH_NAME = 'graph_liq';
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity', max: 5 });

const DEFAULT_KG_LLM_MODEL_KEY = process.env.OPENROUTER_DEFAULT_KG_MODEL_KEY || 'kimi-k2-thinking';
const DEFAULT_EMBED_MODEL =
  process.env.OPENROUTER_DEFAULT_EMBED_MODEL || 'openai/text-embedding-3-small';
const DEFAULT_MAX_CHUNK_CHARS = Math.max(500, Number(process.env.KG_INGEST_MAX_CHARS ?? 4500));
const CHUNK_CHAR_TARGET = Math.min(
  DEFAULT_MAX_CHUNK_CHARS,
  Math.max(300, Number(process.env.KG_INGEST_CHARS ?? 1500)),
);
const CHUNK_CHAR_OVERLAP = Math.max(
  0,
  Math.min(Math.floor(CHUNK_CHAR_TARGET / 2), Number(process.env.KG_INGEST_OVERLAP ?? 200)),
);
const INGEST_ERROR_LOG: {
  projectId: string;
  doc_id: string;
  src: string | null;
  errors: { chunk_index?: number; stage: string; error: string }[];
  created_at: string;
}[] = [];
const INGEST_ERROR_LOG_MAX = 50;
const INGEST_DOC_LOG: {
  projectId: string;
  doc_id: string;
  src: string | null;
  created_at: string;
}[] = [];
const INGEST_DOC_LOG_MAX = 100;

// ============================================================================
// Phase 2: Canonicalization + Auto-Ingest Helpers
// ============================================================================

/**
 * Canonicalize Plan+Links into deterministic text format for ingestion.
 * Format:
 *   <PLAN>
 *   title: ...
 *   goal: ...
 *   tasks:
 *   - [status] (id: ...) deps: ... text: ...
 *   risks:
 *   - ...
 *   unknowns:
 *   - ...
 *   </PLAN>
 *   <LINKS>
 *   - title: ...
 *     type: ...
 *     input: ...
 *     status: ...
 *     notes: ...
 *     citations:
 *      - url: ... quote: ... location: ...
 *   </LINKS>
 */
function canonicalizePlanLinks(plan: any, links: any): string {
  const parts: string[] = [];
  parts.push('<PLAN>');
  
  if (plan && typeof plan === 'object') {
    if (plan.title) parts.push(`title: ${plan.title}`);
    if (plan.goal) parts.push(`goal: ${plan.goal}`);
    
    if (Array.isArray(plan.tasks) && plan.tasks.length > 0) {
      parts.push('tasks:');
      // Sort by id for deterministic ordering
      const sortedTasks = [...plan.tasks].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
      for (const t of sortedTasks) {
        const status = t.status || 'todo';
        const id = t.id || '';
        const deps = Array.isArray(t.deps) ? t.deps.join(',') : '';
        const text = t.text || '';
        parts.push(`- [${status}] (id: ${id}) deps: ${deps} text: ${text}`);
      }
    }
    
    if (Array.isArray(plan.risks) && plan.risks.length > 0) {
      parts.push('risks:');
      for (const r of plan.risks) {
        parts.push(`- ${r.text || r}`);
      }
    }
    
    if (Array.isArray(plan.unknowns) && plan.unknowns.length > 0) {
      parts.push('unknowns:');
      for (const u of plan.unknowns) {
        parts.push(`- ${u.text || u}`);
      }
    }
  }
  
  parts.push('</PLAN>');
  parts.push('');
  parts.push('<LINKS>');
  
  if (Array.isArray(links) && links.length > 0) {
    // Sort by id for deterministic ordering
    const sortedLinks = [...links].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
    for (const link of sortedLinks) {
      parts.push(`- title: ${link.title || ''}`);
      parts.push(`  type: ${link.type || ''}`);
      parts.push(`  input: ${link.input || ''}`);
      parts.push(`  status: ${link.status || ''}`);
      
      if (link.outputs) {
        if (link.outputs.notes) parts.push(`  notes: ${link.outputs.notes}`);
        if (Array.isArray(link.outputs.citations) && link.outputs.citations.length > 0) {
          parts.push('  citations:');
          for (const c of link.outputs.citations) {
            parts.push(`   - url: ${c.url || ''} quote: ${c.quote || ''} location: ${c.location || ''}`);
          }
        }
      }
    }
  }
  
  parts.push('</LINKS>');
  return parts.join('\n');
}

/**
 * Compute SHA1 hash of text for source_id generation.
 */
function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/**
 * Check if doc_id already exists in rag_chunks (idempotency guard).
 */
async function checkDocIdExists(docId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM ag_catalog.rag_chunks WHERE doc_id = $1 LIMIT 1',
      [docId]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('[idempotency] check failed:', err);
    return false;
  }
}

// ============================================================================
// Stage B: LLM Semantic Chunking
// ============================================================================

/**
 * LLM-based semantic chunking that produces chunks with semantic boundaries.
 * This enables better entity/relationship extraction for knowledge graphs.
 * 
 * Returns strict JSON with shape:
 * {
 *   "chunks": [
 *     {
 *       "chunk_index": 0,
 *       "title": "string",
 *       "text": "raw chunk content (no summarizing)",
 *       "language": "en|zh|mixed|other",
 *       "topics": ["string"],
 *       "confidence": 0.0
 *     }
 *   ]
 * }
 */
async function llmSemanticChunking(
  text: string,
  options: {
    chunkTarget: number;
    languageHint: string;
    llmModelKey: string;
    debugTrace?: any;
  }
): Promise<{
  chunks: Array<{
    chunk_index: number;
    title: string;
    text: string;
    language: string;
    topics: string[];
    confidence: number;
  }>;
  prompt_system: string;
  prompt_user_preview: string;
  prompt_user_sha1: string;
  raw_output_preview: string;
  raw_output_sha1: string;
}> {
  const { chunkTarget, languageHint, llmModelKey, debugTrace } = options;

  const system = `You are a strict JSON generator.

You MUST return ONLY valid JSON.
Do NOT wrap in markdown.
Do NOT include commentary.
Do NOT include trailing commas.
Do NOT include extra keys.
Do NOT return partial JSON.

If you cannot comply, return this exact JSON:
{"chunks":[]}

Schema (MUST match exactly):
{
  "chunks": [
    {
      "chunk_index": 0,
      "title": "",
      "text": ""
    }
  ]
}

Rules:
- "chunks" MUST be an array.
- Each chunk MUST include "chunk_index", "title", "text".
- chunk_index MUST be integers starting at 0.
- title MUST be <= 80 chars.
- text MUST be non-empty plain text.
- Output MUST be parseable by JSON.parse() with no cleanup.

Now extract chunks from this input text:`;

  const prompt = [
    'Split this text into semantic chunks.',
    '',
    'REQUIRED OUTPUT FORMAT (valid JSON only):',
    '{',
    '  "chunks": [',
    '    {',
    '      "chunk_index": 0,',
    '      "title": "Brief title",',
    '      "text": "EXACT original text from input - do not summarize or paraphrase",',
    `      "language": "${languageHint}",`,
    '      "topics": ["topic1", "topic2"],',
    '      "confidence": 0.9',
    '    }',
    '  ]',
    '}',
    '',
    'RULES:',
    '- Each chunk.text must contain EXACT original text (no summarizing)',
    `- Target ~${chunkTarget} characters per chunk (soft limit)`,
    '- Prioritize semantic boundaries over character count',
    '- You MUST include at least 1 chunk with non-empty text',
    '- Return ONLY the JSON object, nothing else',
    '',
    'Text to chunk:',
    '---',
    text,
    '---',
  ].join('\n');

  const promptUserSha1 = sha1(prompt);
  const promptUserPreview = prompt.slice(0, 2000);

  if (debugTrace) {
    debugTrace.model_key = llmModelKey;
    debugTrace.prompt_preview = prompt.slice(0, 300);
    debugTrace.prompt_user_sha1 = promptUserSha1;
  }

  console.log('[LLM chunking] model_key=%s prompt_sha1=%s', llmModelKey, promptUserSha1);
  console.log('[LLM chunking] prompt_preview (first 400 chars):', promptUserPreview.slice(0, 400));
  
  const llmRes = await runLLM(prompt, {
    modelKey: llmModelKey,
    system,
    temperature: 0,
    maxTokens: 4096,
    jsonMode: true,
  });

  const rawOutputText = String(llmRes.text || '');
  const rawOutputSha1 = sha1(rawOutputText);
  const rawOutputPreview = rawOutputText.slice(0, 4000);

  if (debugTrace) {
    debugTrace.raw_output_preview = rawOutputPreview;
    debugTrace.raw_output_sha1 = rawOutputSha1;
  }

  console.log('[LLM chunking] raw_output_sha1=%s raw_len=%d', rawOutputSha1, rawOutputText.length);
  console.log('[LLM chunking] raw_output_preview (first 400 chars):', rawOutputPreview.slice(0, 400));

  // Check for empty response first
  if (!llmRes.text || !llmRes.text.trim()) {
    console.error('[LLM chunking] empty response from model:', llmModelKey);
    throw new Error('LLM chunking returned empty response');
  }

  let parsed: any;
  let parseError: string | undefined;
  try {
    parsed = tryParseJsonLoose(llmRes.text);
  } catch (e: any) {
    parseError = e?.message || String(e);
  }
  
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chunks)) {
    const errorMsg = `chunking_invalid_json: LLM returned ${rawOutputText.length} chars but not valid JSON. Preview: ${rawOutputPreview.slice(0, 200)}`;
    console.error('[LLM chunking] invalid JSON. raw_len=%d preview=%s', rawOutputText.length, rawOutputPreview.slice(0, 200));
    
    // Store evidence in error object for trace capture
    const err: any = new Error(errorMsg);
    err.prompt_system = system;
    err.prompt_user_preview = promptUserPreview;
    err.prompt_user_sha1 = promptUserSha1;
    err.raw_output_preview = rawOutputPreview;
    err.raw_output_sha1 = rawOutputSha1;
    err.parse_error = parseError || 'JSON parse failed or missing chunks array';
    throw err;
  }

  // Validate chunks
  const chunks = parsed.chunks.map((c: any, idx: number): {
    chunk_index: number;
    title: string;
    text: string;
    language: string;
    topics: string[];
    confidence: number;
  } => ({
    chunk_index: typeof c.chunk_index === 'number' ? c.chunk_index : idx,
    title: typeof c.title === 'string' ? c.title : `Chunk ${idx}`,
    text: typeof c.text === 'string' ? c.text : '',
    language: typeof c.language === 'string' ? c.language : languageHint,
    topics: Array.isArray(c.topics) ? c.topics : [],
    confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
  }));

  if (chunks.length === 0 || chunks.every((c: any) => !c.text.trim())) {
    const rawLen = String(llmRes.text || '').length;
    console.error('[LLM chunking] parsed JSON but no valid chunks. raw_len=%d chunk_count=%d', rawLen, chunks.length);
    throw new Error(`chunking_invalid_json: LLM chunking produced no valid chunks (raw_len=${rawLen}, parsed_chunks=${chunks.length})`);
  }

  return { 
    chunks,
    prompt_system: system,
    prompt_user_preview: promptUserPreview,
    prompt_user_sha1: promptUserSha1,
    raw_output_preview: rawOutputPreview,
    raw_output_sha1: rawOutputSha1,
  };
}

async function buildRecentIngests(projectId: string, limit: number) {
  const recent = INGEST_DOC_LOG.filter((d) => d.projectId === projectId)
    .slice(-limit)
    .reverse();
  const docIds = recent.map((d) => d.doc_id);

  let counts: any[] = [];
  if (docIds.length) {
    const { rows } = await pool.query(
      `
        SELECT doc_id, COALESCE(src, '') AS src, MIN(created_at) AS created_at,
               COUNT(*) AS chunks,
               COUNT(DISTINCT emb.chunk_id) AS embeddings
        FROM ag_catalog.rag_chunks c
        LEFT JOIN ag_catalog.rag_embeddings emb ON emb.chunk_id = c.chunk_id
        WHERE doc_id = ANY($1)
        GROUP BY doc_id, src
      `,
      [docIds],
    );
    counts = rows;
  }

  const enriched = [];
  for (const base of recent) {
    const docId = base.doc_id;
    const match = counts.find((r) => (r as any).doc_id === docId);
    let entities = 0;
    let relations = 0;
    try {
      const [eRow] = await runCypherOnGraph(
        GRAPH_NAME,
        `
            MATCH (n:Entity { project_id: $projectId })
            WHERE n.source.doc_id = $docId
            RETURN count(n) AS c
          `,
        { projectId, docId },
      );
      entities = Number((eRow as any)?.c ?? 0);

      const [rRow] = await runCypherOnGraph(
        GRAPH_NAME,
        `
            MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId })
            WHERE r.source.doc_id = $docId
            RETURN count(r) AS c
          `,
        { projectId, docId },
      );
      relations = Number((rRow as any)?.c ?? 0);
    } catch {
      // ignore per-doc graph errors to keep list working
    }

    enriched.push({
      doc_id: docId,
      src: base.src || '',
      created_at: match ? (match as any).created_at : base.created_at,
      chunks: match ? Number((match as any).chunks || 0) : 0,
      embeddings: match ? Number((match as any).embeddings || 0) : 0,
      chunks_count: match ? Number((match as any).chunks || 0) : 0,
      embeddings_count: match ? Number((match as any).embeddings || 0) : 0,
      entities,
      relations,
    });
  }
  return enriched;
}

function normalizeInputText(raw: string, doNormalize: boolean) {
  const t = String(raw ?? '');
  if (!doNormalize) return t;
  return t.replace(/\r\n/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function splitDeterministicChunks(rawText: string, targetChars: number, overlap: number) {
  const text = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const chunks: string[] = [];
  let start = 0;
  const len = text.length;
  const step = Math.max(1, targetChars - overlap);

  while (start < len) {
    const end = Math.min(len, start + targetChars);
    const slice = text.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= len) break;
    start += step;
  }
  return chunks;
}

function tryParseJsonLoose(raw: string) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function commitKgBatch(projectId: string, entities: any[], relations: any[], provenance: any) {
  let entitiesUpserted = 0;
  let relationsUpserted = 0;
  
  console.log('[KG_INGEST] commitKgBatch start:', {
    projectId,
    graphName: GRAPH_NAME,
    entities_count: entities.length,
    relations_count: relations.length,
  });
  
  await runCypherOnGraph(GRAPH_NAME, 'MATCH (n) RETURN 1 LIMIT 1'); // ensure graph exists

  for (const e of entities) {
    if (!e || typeof e !== 'object') continue;
    const type = (e as any).type || 'Unknown';
    const name = (e as any).name || '';
    if (!name) continue;
    const attrs = (e as any).attrs || {};
    const confidence = Number((e as any).confidence ?? 0.5);
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
          etype: type,
          name,
          attrs,
          confidence,
          source: provenance || null,
        },
      );
      entitiesUpserted += 1;
    } catch (err: any) {
      console.error('[KG_INGEST] Entity upsert failed:', {
        entity: { type, name },
        error: err?.message,
      });
    }
  }

  for (const r of relations) {
    if (!r || typeof r !== 'object') continue;
    const from = (r as any).from || (r as any).fromName || {};
    const to = (r as any).to || (r as any).toName || {};
    const fromName = (from as any).name || '';
    const toName = (to as any).name || '';
    const fromType = (from as any).type || 'Unknown';
    const toType = (to as any).type || 'Unknown';
    const relTypeProp = (r as any).type || 'REL';
    if (!fromName || !toName) continue;
    const attrs = (r as any).attrs || {};
    const confidence = Number((r as any).confidence ?? 0.5);
    const cypher = `
      MATCH (a:Entity { project_id: $projectId, etype: $fromType, name: $fromName })
      MATCH (b:Entity { project_id: $projectId, etype: $toType, name: $toName })
      MERGE (a)-[r:REL { project_id: $projectId, rtype: $rtype }]->(b)
      ON CREATE SET r.attrs = $attrs, r.confidence = $confidence, r.created_at = datetime(), r.source = $source
      ON MATCH SET r.attrs = coalesce(r.attrs, {}) + $attrs
      RETURN r
    `;
    try {
      await runCypherOnGraph(GRAPH_NAME, cypher, {
        projectId,
        fromType,
        fromName,
        toType,
        toName,
        attrs,
        confidence,
        rtype: relTypeProp,
        source: provenance || null,
      });
      relationsUpserted += 1;
    } catch (err: any) {
      console.error('[KG_INGEST] Relation upsert failed:', {
        relation: { fromName, toName, type: relTypeProp },
        error: err?.message,
      });
    }
  }

  console.log('[KG_INGEST] commitKgBatch complete:', {
    projectId,
    entitiesUpserted,
    relationsUpserted,
  });

  return { entitiesUpserted, relationsUpserted };
}

// Expose model registry to frontend
router.get('/models', async (_req, res) => {
  try {
    const models = listModels();
    return res.json({ ok: true, models });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list models' });
  }
});

// Get last ingest trace for Dashboard
router.get('/:projectId/kg/last-trace', async (req, res) => {
  try {
    const { projectId } = req.params;
    const trace = getLastTrace(projectId);
    return res.json({ ok: true, trace });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to get last trace' });
  }
});

// Get ingest trace history
router.get('/:projectId/kg/traces', async (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = Number(req.query.limit) || 20;
    const traces = getTraces(projectId, limit);
    return res.json({ ok: true, traces });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to get traces' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const projects = await listAgentCards();
    return res.json(projects);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
  }
});

router.post('/', async (req, res) => {
  const { name, code } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  try {
    const project = await createProject(name, typeof code === 'string' ? code : null);
    return res.json(project);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to create project' });
  }
});

router.get('/:projectId/state', async (req, res) => {
  try {
    const state = await getProjectState(req.params.projectId);
    return res.json(state);
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to load state' });
  }
});

router.put('/:projectId/state', async (req, res) => {
  const projectId = req.params.projectId;
  try {
    const state = await saveProjectState(projectId, req.body || {});
    
    // Phase 2: Auto-ingest Plan+Links after state save
    let ingestResult: any = { skipped: false };
    try {
      const plan = (req.body || {}).plan;
      const links = (req.body || {}).links;
      
      // Only ingest if plan or links exist
      if (plan || links) {
        const canonicalText = canonicalizePlanLinks(plan, links);
        const sourceId = sha1(canonicalText);
        const docId = `state:${projectId}:${sourceId.slice(0, 12)}`;
        const src = 'state.plan_links';
        
        // Idempotency: skip if already ingested
        const exists = await checkDocIdExists(docId);
        if (exists) {
          ingestResult = { skipped: true, reason: 'already_ingested', doc_id: docId };
        } else {
          // Call internal ingest logic (reuse existing pipeline)
          // We'll extract the ingest logic into a helper function below
          ingestResult = await runIngestPipeline({
            projectId,
            doc_id: docId,
            src,
            text: canonicalText,
            llm_model: DEFAULT_KG_LLM_MODEL_KEY,
            embed_model: DEFAULT_EMBED_MODEL,
            options: {},
          });
        }
      }
    } catch (ingestErr: any) {
      console.error('[auto-ingest] failed:', ingestErr);
      ingestResult = { skipped: true, error: ingestErr?.message || 'ingest failed' };
    }
    
    return res.json({ ...state, ingest: ingestResult });
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to save state' });
  }
});

router.post('/:projectId/kg/query', async (req, res) => {
  const { cypher, params } = req.body || {};
  if (!cypher || typeof cypher !== 'string') {
    return res.status(400).json({ ok: false, error: 'cypher is required' });
  }
  if (!/project_id/i.test(cypher)) {
    return res.status(400).json({ ok: false, error: 'cypher must filter by project_id' });
  }
  try {
    const rows = await runCypherOnGraph(GRAPH_NAME, cypher, params);
    console.log('[KG_QUERY]', {
      projectId: req.params.projectId,
      graphName: GRAPH_NAME,
      cypher_preview: cypher.slice(0, 120),
      rows_returned: Array.isArray(rows) ? rows.length : 0,
    });
    return res.json({ ok: true, rows });
  } catch (err: any) {
    const status = (err?.message || '').toLowerCase().includes('age') ? 503 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'graph query failed' });
  }
});

router.post('/:projectId/kg/extract', async (req, res) => {
  const { text, source } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }
  const system = 'Extract entities and relations from the text. Return JSON with entities and relations. entities: [{tempId,type,name,attrs,confidence}], relations: [{fromTempId,toTempId,type,attrs,confidence}], provenance: {method:"llm_extract"}';
  try {
    const { text: llmText, model } = await runLLM(
      `${text}\n\nReturn STRICT JSON ONLY with shape {"entities":[{"type":"", "name":"", "confidence":0.0}],"relations":[{"from":{"type":"","name":""},"to":{"type":"","name":""},"type":"","confidence":0.0}],"provenance":{"method":"llm_extract"}}`,
      { modelKey: 'gpt-5-mini', system }
    );
    let parsed: any = null;
    try {
      parsed = JSON.parse(llmText);
    } catch {
      // fallback: try to extract JSON substring
      const match = llmText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ ok: false, error: 'LLM parse failed', raw: llmText ?? '' });
    }
    const now = new Date().toISOString();
    return res.json({
      ok: true,
      preview: {
        entities: Array.isArray((parsed as any).entities) ? (parsed as any).entities : [],
        relations: Array.isArray((parsed as any).relations) ? (parsed as any).relations : [],
        provenance: {
          ...(typeof (parsed as any).provenance === 'object' ? (parsed as any).provenance : {}),
          method: 'llm_extract',
          model,
          createdAt: now,
          source: source && typeof source === 'object' ? source : undefined,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'extract failed' });
  }
});

router.post('/:projectId/kg/commit', async (req, res) => {
  const { entities, relations, provenance } = req.body || {};
  if (!Array.isArray(entities) || !Array.isArray(relations)) {
    return res.status(400).json({ ok: false, error: 'entities and relations arrays required' });
  }
  const projectId = req.params.projectId;
  let entitiesUpserted = 0;
  let relationsUpserted = 0;
  try {
    await runCypherOnGraph(GRAPH_NAME, 'MATCH (n) RETURN 1 LIMIT 1'); // ensure graph exists
    for (const e of entities) {
      if (!e || typeof e !== 'object') continue;
      const type = (e as any).type || 'Unknown';
      const name = (e as any).name || '';
      if (!name) continue;
      const attrs = (e as any).attrs || {};
      const confidence = Number((e as any).confidence ?? 0.5);
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
          etype: type,
          name,
          attrs,
          confidence,
          source: provenance || null,
        },
      );
      entitiesUpserted += 1;
    }
    for (const r of relations) {
      if (!r || typeof r !== 'object') continue;
      const from = (r as any).from || (r as any).fromName || {};
      const to = (r as any).to || (r as any).toName || {};
      const fromName = (from as any).name || '';
      const toName = (to as any).name || '';
      const fromType = (from as any).type || 'Unknown';
      const toType = (to as any).type || 'Unknown';
      const relTypeProp = (r as any).type || 'REL';
      if (!fromName || !toName) continue;
      const attrs = (r as any).attrs || {};
      const confidence = Number((r as any).confidence ?? 0.5);
      const cypher = `
        MATCH (a:Entity { project_id: $projectId, etype: $fromType, name: $fromName })
        MATCH (b:Entity { project_id: $projectId, etype: $toType, name: $toName })
        MERGE (a)-[r:REL { project_id: $projectId, rtype: $rtype }]->(b)
        ON CREATE SET r.attrs = $attrs, r.confidence = $confidence, r.created_at = datetime(), r.source = $source
        ON MATCH SET r.attrs = coalesce(r.attrs, {}) + $attrs
        RETURN r
      `;
      await runCypherOnGraph(GRAPH_NAME, cypher, {
        projectId,
        fromType,
        fromName,
        toType,
        toName,
        attrs,
        confidence,
        rtype: relTypeProp,
        source: provenance || null,
      });
      relationsUpserted += 1;
    }
    return res.json({ ok: true, entities_upserted: entitiesUpserted, relations_upserted: relationsUpserted });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'commit failed' });
  }
});

// ============================================================================
// Phase 2: Extracted ingest pipeline (reusable for auto-ingest and manual)
// ============================================================================
export async function runIngestPipeline(params: {
  projectId: string;
  doc_id: string;
  src: string;
  text: string;
  llm_model?: string;
  embed_model?: string;
  options?: any;
  debug?: boolean;
  trace?: any;
}) {
  const { projectId, doc_id, src, text, llm_model, embed_model, options, debug, trace } = params;
  
  const debugTrace: any = debug ? {
    input: { text_length: text?.length || 0, projectId, doc_id, src },
    config: {},
    chunking: {},
    extraction: {},
    results: {},
  } : null;

  try {
    await getProjectState(projectId);
  } catch (err: any) {
    throw new Error(err?.message || 'project not found');
  }

  const llmModelKey = llm_model || DEFAULT_KG_LLM_MODEL_KEY;
  const embedModel = embed_model || DEFAULT_EMBED_MODEL;

  if (debugTrace) {
    debugTrace.config = { llmModelKey, embedModel };
  }

  if (!llm_model) console.log('[KG][ingest] default llm_model=%s (modelKey)', llmModelKey);
  if (!embed_model) console.log('[KG][ingest] default embed_model=%s (OpenRouter model id)', embedModel);
  console.log('[KG][ingest] using llm_model_key=%s embed_model=%s', llmModelKey, embedModel);

  const optChunkChars = Number(options?.chunk_chars) || CHUNK_CHAR_TARGET;
  const optOverlap = Number(options?.chunk_overlap) || CHUNK_CHAR_OVERLAP;
  const maxChunks = options && Number.isFinite(Number(options.max_chunks)) ? Number(options.max_chunks) : null;
  const chunkTarget = Math.max(300, Math.min(DEFAULT_MAX_CHUNK_CHARS, optChunkChars));
  const chunkOverlap = Math.max(0, Math.min(Math.floor(chunkTarget / 2), optOverlap));
  const languageHint =
    typeof options?.language_hint === 'string' && ['auto', 'en', 'zh', 'mixed'].includes(options.language_hint)
      ? options.language_hint
      : 'auto';
  const normalizedText = normalizeInputText(text, Boolean(options?.normalize_text));
  const useLlmChunking = options?.use_llm_chunking !== false; // default true
  const errors: { chunk_index?: number; stage: string; error: string }[] = [];

  // Stage B: LLM semantic chunking (primary method)
  let chunks: string[] = [];
  
  if (useLlmChunking) {
    // Resolve model to get provider details for logging
    let modelEntry;
    try {
      modelEntry = MODEL_REGISTRY[llmModelKey];
      if (!modelEntry) {
        throw new Error(`Unknown model key: ${llmModelKey}`);
      }
    } catch (err: any) {
      throw new Error(`model_not_configured: ${err.message}`);
    }
    
    console.log('[KG][chunking] model_key=%s provider=%s provider_model_id=%s', 
      llmModelKey, modelEntry.provider, modelEntry.id);
    
    const chunkStartTime = Date.now();
    try {
      const chunkingResult = await llmSemanticChunking(normalizedText, {
        chunkTarget,
        languageHint,
        llmModelKey: llmModelKey,
        debugTrace: debugTrace?.chunking,
      });
      chunks = chunkingResult.chunks.map((c: any) => c.text);
      console.log('[LLM chunking] produced %d semantic chunks', chunks.length);
      
      if (trace) {
        trace.step_states.chunking = {
          ok: true,
          t_ms: Date.now() - chunkStartTime,
          chunk_count: chunks.length,
          raw_len: normalizedText.length,
          model_key: llmModelKey,
          prompt_system: chunkingResult.prompt_system,
          prompt_user_preview: chunkingResult.prompt_user_preview,
          prompt_user_sha1: chunkingResult.prompt_user_sha1,
          raw_output_preview: chunkingResult.raw_output_preview,
          raw_output_sha1: chunkingResult.raw_output_sha1,
        };
      }
      
      if (debugTrace) {
        debugTrace.chunking.chunk_count = chunks.length;
        debugTrace.chunking.parse_result = 'ok';
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error('[LLM chunking] FAILED:', errorMsg);
      
      if (trace) {
        trace.step_states.chunking = {
          ok: false,
          t_ms: Date.now() - chunkStartTime,
          error: errorMsg,
          model_key: llmModelKey,
          prompt_system: err.prompt_system,
          prompt_user_preview: err.prompt_user_preview,
          prompt_user_sha1: err.prompt_user_sha1,
          raw_output_preview: err.raw_output_preview,
          raw_output_sha1: err.raw_output_sha1,
          parse_error: err.parse_error || (errorMsg.includes('invalid_json') ? errorMsg : undefined),
        };
      }
      
      if (debugTrace) {
        debugTrace.chunking.error = errorMsg;
      }

      // NO FALLBACK: chunking failure means ingest failure
      errors.push({ stage: 'chunking', error: errorMsg });
      throw new Error(`chunking_failed: ${errorMsg}`);
    }
  } else {
    // Deterministic chunking (optional preprocessing or explicit choice)
    const chunksAll = splitDeterministicChunks(normalizedText, chunkTarget, chunkOverlap);
    chunks = maxChunks && maxChunks > 0 ? chunksAll.slice(0, maxChunks) : chunksAll;
  }

  let chunksWritten = 0;
  let embeddingsWritten = 0;
  let entitiesUpserted = 0;
  let relationsUpserted = 0;

  console.log('[KG][embed] chunk_count=%d embedding_model=%s', chunks.length, embedModel);
  console.log('[KG][write] writing entities/relations...');

  const embedStartTime = Date.now();
  const writeStartTime = Date.now();

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    let chunkId: number | null = null;

    try {
      const { rows } = await pool.query(
        'INSERT INTO ag_catalog.rag_chunks (doc_id, src, chunk) VALUES ($1, $2, $3) RETURNING *',
        [doc_id, src ?? null, chunk],
      );
      const row = rows?.[0] || null;
      chunkId = Number((row as any)?.chunk_id ?? (row as any)?.id);
      if (!chunkId || Number.isNaN(chunkId)) throw new Error('insert did not return chunk_id');
      chunksWritten += 1;
    } catch (err: any) {
      errors.push({
        chunk_index: chunkIndex,
        stage: 'write_chunks',
        error: `chunk insert failed: ${err?.message || String(err)}`,
      });
      continue;
    }

    try {
      let embedding: number[] | null = null;
      try {
        embedding = await createOpenRouterEmbedding(chunk, embedModel);
      } catch (err: any) {
        errors.push({ chunk_index: chunkIndex, stage: 'embed', error: err?.message || String(err) });
      }

      if (embedding) {
        try {
          const volume = Math.max(0, Math.min(1, chunk.length / chunkTarget));
          await pool.query(
            'SELECT api.ingest_embedding($1::bigint, $2::text, $3::vector, $4::real, $5::real)',
            [chunkId, embedModel, JSON.stringify(embedding), volume, 1.0],
          );
          embeddingsWritten += 1;
        } catch (err: any) {
          errors.push({
            chunk_index: chunkIndex,
            stage: 'write_embeddings',
            error: err?.message || String(err),
          });
        }
      }
    } catch (err: any) {
      errors.push({ chunk_index: chunkIndex, stage: 'embed', error: err?.message || String(err) });
    }

    let parsed: any = null;
    let llmModelId = '';
    try {
      const system =
        'Extract KG entities and relations from the provided text chunk. Return STRICT JSON ONLY. No markdown. Keep entity names in original language. Relationship labels in English if possible.';
      const prompt = [
        'Return STRICT JSON ONLY with shape:',
        '{"entities":[{"type":"", "name":"", "attrs":{}, "confidence":0.0}], "relations":[{"type":"", "from":{"type":"","name":""}, "to":{"type":"","name":""}, "attrs":{}, "confidence":0.0}], "provenance":{"method":"llm_extract"}}',
        '',
        `Language hint: ${languageHint}`,
        'Text chunk:',
        chunk,
      ].join('\n');

      const llmRes = await runLLM(prompt, {
        modelKey: llmModelKey,
        system,
        temperature: 0,
        maxTokens: 2048,
      });
      llmModelId = llmRes.model;
      console.log('[KG][ingest] extraction provider=%s model=%s', llmRes.provider, llmModelId);

      parsed = tryParseJsonLoose(llmRes.text);
      if (!parsed || typeof parsed !== 'object') {
        console.error('[KG][ingest] extraction invalid JSON, raw response (first 500 chars):', llmRes.text.slice(0, 500));
        throw new Error('extraction_invalid_json');
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      
      // Fail fast on config errors
      if (errorMsg.includes('provider_key_missing') || errorMsg.includes('model_not_configured')) {
        throw new Error(`extraction_config_error: ${errorMsg}`);
      }
      
      errors.push({ chunk_index: chunkIndex, stage: 'extract', error: errorMsg });
      continue;
    }

    try {
      const ents = Array.isArray((parsed as any).entities) ? (parsed as any).entities : [];
      const relsFromRelations = Array.isArray((parsed as any).relations) ? (parsed as any).relations : [];
      const relsFromRelationships = Array.isArray((parsed as any).relationships) ? (parsed as any).relationships : [];
      const rels = relsFromRelations.length ? relsFromRelations : relsFromRelationships;

      // Check for empty extraction (debugging mode)
      if (ents.length === 0 && rels.length === 0) {
        const errorMsg = `extraction_empty: chunk ${chunkIndex} produced 0 entities and 0 relations`;
        console.warn('[KG][ingest]', errorMsg);
        errors.push({ chunk_index: chunkIndex, stage: 'extract_empty', error: errorMsg });
        continue;
      }

      const provenance = {
        ...(typeof (parsed as any).provenance === 'object' ? (parsed as any).provenance : {}),
        doc_id,
        src: src ?? null,
        chunk_index: chunkIndex,
        llm_model_key: llmModelKey,
        llm_model_id: llmModelId,
        embed_model: embedModel,
        chunk_id: chunkId,
        createdAt: new Date().toISOString(),
        language_hint: languageHint,
      };

      const committed = await commitKgBatch(projectId, ents, rels, provenance);
      entitiesUpserted += committed.entitiesUpserted;
      relationsUpserted += committed.relationsUpserted;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      
      // Check for AGE-specific errors
      if (errorMsg.includes('name constant') || errorMsg.includes('ag_catalog')) {
        console.error('[KG][ingest] AGE write failed:', errorMsg);
        errors.push({ chunk_index: chunkIndex, stage: 'age_write_failed', error: errorMsg });
      } else {
        errors.push({ chunk_index: chunkIndex, stage: 'write_graph', error: errorMsg });
      }
    }
  }

  if (debugTrace) {
    debugTrace.results = {
      chunks_written: chunksWritten,
      embeddings_written: embeddingsWritten,
      entities_upserted: entitiesUpserted,
      relations_upserted: relationsUpserted,
      first_error: errors.length > 0 ? errors[0].error : null,
    };
  }

  const response = {
    ok: true,
    doc_id,
    src: src ?? null,
    chunks_written: chunksWritten,
    embeddings_written: embeddingsWritten,
    entities_upserted: entitiesUpserted,
    relations_upserted: relationsUpserted,
    errors,
    ...(debugTrace ? { debug_trace: debugTrace } : {}),
  };

  // keep a small in-memory log of ingest errors for quick visibility
  if (errors.length) {
    INGEST_ERROR_LOG.push({
      projectId,
      doc_id,
      src: src ?? null,
      errors,
      created_at: new Date().toISOString(),
    });
    while (INGEST_ERROR_LOG.length > INGEST_ERROR_LOG_MAX) INGEST_ERROR_LOG.shift();
  }

  INGEST_DOC_LOG.push({
    projectId,
    doc_id,
    src: src ?? null,
    created_at: new Date().toISOString(),
  });
  while (INGEST_DOC_LOG.length > INGEST_DOC_LOG_MAX) INGEST_DOC_LOG.shift();

  console.log('[KG][write] done entities=%d relations=%d', entitiesUpserted, relationsUpserted);
  
  if (trace) {
    trace.step_states.embed = {
      ok: embeddingsWritten > 0,
      t_ms: Date.now() - embedStartTime,
      vectors_count: embeddingsWritten,
    };
    trace.step_states.write = {
      ok: true,
      t_ms: Date.now() - writeStartTime,
      entity_count: entitiesUpserted,
      relation_count: relationsUpserted,
    };
  }
  
  console.log('[KG_INGEST]', {
    projectId,
    graphName: GRAPH_NAME,
    doc_id,
    src: src ?? null,
    entities_upserted: entitiesUpserted,
    relations_upserted: relationsUpserted,
    chunks_written: chunksWritten,
    embeddings_written: embeddingsWritten,
    errors_count: errors.length,
  });

  return response;
}

export async function ingestChatTurnInternal(params: {
  projectId: string;
  doc_id: string;
  src: string;
  textToIngest: string;
  user_text?: string;
  assistant_text?: string;
  llm_model?: string;
  debug?: boolean;
  trace?: any;
}) {
  const { projectId, doc_id, src, textToIngest, llm_model, debug, trace } = params;
  let response: any;
  try {
    response = await runIngestPipeline({
      projectId,
      doc_id,
      src,
      text: textToIngest,
      llm_model,
      options: {},
      debug,
      trace,
    });
  } catch (err: any) {
    console.error('[KG_INGEST_ERR]', err?.stack ? err.stack.split('\n')[0] : err?.message || err);
    response = { ok: false, error: 'kg_ingest_failed', message: err?.message || 'chat ingest failed' };
  }

  // No fallback - broken fallback is worse than none
  return response;
}

router.post('/:projectId/kg/ingest', async (req, res) => {
  const projectId = req.params.projectId;
  let { doc_id, src, text, llm_model, embed_model, options } = req.body || {};

  if (!projectId || typeof projectId !== 'string') {
    return res.status(400).json({ ok: false, error: 'projectId is required' });
  }

  // Validate: model key must NOT contain '/' (provider IDs not allowed)
  if (llm_model && llm_model.includes('/')) {
    return res.status(400).json({ 
      ok: false, 
      error: 'invalid_model_key_format', 
      message: `Model key cannot be a provider ID (got: ${llm_model}). Use internal keys like 'kimi-k2-thinking'.` 
    });
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }
  
  // Phase 2: Backend defaults for doc_id and src (if missing)
  if (!doc_id || typeof doc_id !== 'string' || !doc_id.trim()) {
    const textHash = sha1(text);
    doc_id = `ingest:${projectId}:${textHash.slice(0, 12)}`;
    console.log('[ingest] auto-generated doc_id=%s', doc_id);
  }
  if (!src || typeof src !== 'string' || !src.trim()) {
    src = 'ingest.adhoc';
    console.log('[ingest] auto-generated src=%s', src);
  }
  
  // Phase 2: Idempotency check
  const exists = await checkDocIdExists(doc_id);
  if (exists) {
    return res.json({
      ok: true,
      skipped: true,
      reason: 'already_ingested',
      doc_id,
      src,
      chunks_written: 0,
      embeddings_written: 0,
      entities_upserted: 0,
      relations_upserted: 0,
      errors: [],
    });
  }

  try {
    const debug = Boolean(req.body.debug);
    const response = await runIngestPipeline({
      projectId,
      doc_id,
      debug,
      src,
      text,
      llm_model,
      embed_model,
      options,
    });
    return res.json(response);
  } catch (err: any) {
    console.error('[KG_INGEST_ERR]', err?.stack ? err.stack.split('\n')[0] : err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'ingest failed' });
  }
});

router.post('/:projectId/kg/ingest_chat_turn', async (req, res) => {
  const projectId = req.params.projectId;
  const { turn_id, user_text, assistant_text, src, llm_model } = req.body || {};

  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'projectId is required' });
  }

  // Combine user and assistant text for ingestion
  const textToIngest = [
    user_text ? `User: ${user_text}` : null,
    assistant_text ? `Assistant: ${assistant_text}` : null,
  ].filter(Boolean).join('\n\n');

  if (!textToIngest.trim()) {
    return res.status(400).json({ ok: false, error: 'No text to ingest' });
  }

  // Generate doc_id from turn_id or hash
  const doc_id = turn_id || `chat:${projectId}:${sha1(textToIngest).slice(0, 12)}`;
  const finalSrc = src || 'chat.auto';

  // Check if already ingested
  const exists = await checkDocIdExists(doc_id);
  if (exists) {
    return res.json({
      ok: true,
      skipped: true,
      reason: 'already_ingested',
      doc_id,
      chunks_written: 0,
      embeddings_written: 0,
      entities_upserted: 0,
      relations_upserted: 0,
    });
  }

  try {
    const response = await ingestChatTurnInternal({
      projectId,
      doc_id,
      src: finalSrc,
      textToIngest,
      user_text,
      assistant_text,
      llm_model,
    });
    return res.status(response?.ok === false ? 200 : 200).json(response);
  } catch (err: any) {
    console.error('[KG_INGEST_ERR]', err?.stack ? err.stack.split('\n')[0] : err?.message || err);
    return res.status(200).json({ ok: false, error: 'kg_ingest_failed', message: err?.message || 'chat ingest failed' });
  }
});

router.get('/:projectId/kg/ingests', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required' });
  try {
    const enriched = await buildRecentIngests(projectId, 10);
    return res.json({ ok: true, rows: enriched });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list ingests' });
  }
});

router.get('/:projectId/kg/recent', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required' });
  try {
    const enriched = await buildRecentIngests(projectId, 25);
    return res.json({ ok: true, rows: enriched });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list recent ingests' });
  }
});

router.get('/:projectId/kg/summary', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required' });

  try {
    const docIds = INGEST_DOC_LOG.filter((d) => d.projectId === projectId).map((d) => d.doc_id);
    let docs = docIds.length;
    let chunks = 0;
    let embeddings = 0;
    if (docIds.length) {
      const countsSql = `
        SELECT
          COUNT(DISTINCT doc_id) AS docs,
          COUNT(*) AS chunks
        FROM ag_catalog.rag_chunks
        WHERE doc_id = ANY($1)
      `;
      const embedsSql = `
        SELECT COUNT(*) AS embeddings FROM ag_catalog.rag_embeddings WHERE chunk_id IN (
          SELECT chunk_id FROM ag_catalog.rag_chunks WHERE doc_id = ANY($1)
        )
      `;
      const countsRow = (await pool.query(countsSql, [docIds])).rows?.[0];
      docs = Number((countsRow as any)?.docs || docs);
      chunks = Number((countsRow as any)?.chunks || 0);
      const embedsRow = (await pool.query(embedsSql, [docIds])).rows?.[0];
      embeddings = Number((embedsRow as any)?.embeddings || 0);
    }

    let entities = 0;
    let relations = 0;
    let topEntities: any[] = [];
    let topRelTypes: any[] = [];
    try {
      const [eRow] = await runCypherOnGraph(
        GRAPH_NAME,
        `
          MATCH (n:Entity { project_id: $projectId })
          RETURN count(n) AS c
        `,
        { projectId },
      );
      entities = Number((eRow as any)?.c || 0);

      const [rRow] = await runCypherOnGraph(
        GRAPH_NAME,
        `
          MATCH (:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(:Entity { project_id: $projectId })
          RETURN count(r) AS c
        `,
        { projectId },
      );
      relations = Number((rRow as any)?.c || 0);

      const topEntRows = await runCypherOnGraph(
        GRAPH_NAME,
        `
          MATCH (n:Entity { project_id: $projectId })
          RETURN n.etype AS type, n.name AS name, count(*) AS c
          ORDER BY c DESC
          LIMIT 25
        `,
        { projectId },
      );
      topEntities = topEntRows.map((r: any) => ({
        type: r.type,
        name: r.name,
        count: Number(r.c || 0),
      }));

      const topRelRows = await runCypherOnGraph(
        GRAPH_NAME,
        `
          MATCH (:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(:Entity { project_id: $projectId })
          RETURN r.rtype AS type, count(*) AS c
          ORDER BY c DESC
          LIMIT 25
        `,
        { projectId },
      );
      topRelTypes = topRelRows.map((r: any) => ({
        type: r.type,
        count: Number(r.c || 0),
      }));
    } catch (err: any) {
      console.log('[KG][summary] graph summary error', err?.message || err);
    }

    return res.json({
      ok: true,
      totals: { docs, chunks, embeddings, entities, relations },
      top_entities: topEntities,
      top_rel_types: topRelTypes,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to load summary' });
  }
});

router.get('/:projectId/kg/errors', async (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required' });
  const rows = INGEST_ERROR_LOG.filter((e) => e.projectId === projectId).slice(-10).reverse();
  return res.json({ ok: true, rows });
});

router.get('/:projectId/agent', async (req, res) => {
  try {
    const cfg = await getAgentConfig(req.params.projectId);
    return res.json(cfg);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to load agent config' });
  }
});

router.put('/:projectId/agent', async (req, res) => {
  try {
    console.log('[SAVE_AGENT] projectId=%s body=%o', req.params.projectId, req.body);
    const saved = await saveAgentConfig({ ...(req.body || {}), id: req.params.projectId });
    console.log('[SAVE_AGENT] success, returning agent config');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ ok: true, agent: saved });
  } catch (err: any) {
    console.error('[SAVE_AGENT] error:', err?.message || err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ ok: false, error: err?.message || 'failed to save agent config' });
  }
});

router.get('/:projectId/runtime-config', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { assist_main_agent_id, assist_kg_ingest_agent_id } = await getAssistAssignments(projectId);
    
    // Resolve assist main agent
    let assistMainModel = { provider: 'unknown', model_key: 'not_configured' };
    if (assist_main_agent_id) {
      try {
        const assistAgent = await getAgentConfig(assist_main_agent_id);
        if (assistAgent?.agent_model) {
          const modelEntry = MODEL_REGISTRY[assistAgent.agent_model];
          if (modelEntry) {
            assistMainModel = { provider: modelEntry.provider, model_key: assistAgent.agent_model };
          } else {
            assistMainModel = { provider: 'unknown', model_key: assistAgent.agent_model };
          }
        }
      } catch (err) {
        console.warn('[RUNTIME_CONFIG] failed to resolve assist main agent:', err);
      }
    }
    
    // Resolve KG ingest agent
    let kgIngestModel = { provider: 'unknown', model_key: 'not_configured' };
    if (assist_kg_ingest_agent_id) {
      try {
        const kgAgent = await getAgentConfig(assist_kg_ingest_agent_id);
        if (kgAgent?.agent_model) {
          const modelEntry = MODEL_REGISTRY[kgAgent.agent_model];
          if (modelEntry) {
            kgIngestModel = { provider: modelEntry.provider, model_key: kgAgent.agent_model };
          } else {
            kgIngestModel = { provider: 'unknown', model_key: kgAgent.agent_model };
          }
        }
      } catch (err) {
        console.warn('[RUNTIME_CONFIG] failed to resolve KG ingest agent:', err);
      }
    }
    
    // KG chunking model = KG ingest model (no hidden routing)
    const kgChunkingModel = kgIngestModel;
    
    // Embedding model (hardcoded default for now)
    const embedModel = { provider: 'openrouter', model_key: DEFAULT_EMBED_MODEL };
    
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      ok: true,
      projectId,
      assist_main_agent: assistMainModel,
      kg_ingest_agent: kgIngestModel,
      kg_chunking_model: kgChunkingModel,
      embed_model: embedModel,
    });
  } catch (err: any) {
    console.error('[RUNTIME_CONFIG] error:', err?.message || err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ ok: false, error: err?.message || 'failed to load runtime config' });
  }
});

export default router;
