import { Router } from 'express';
import {
  getProjectState,
  saveProjectState,
  createProject,
  listAgentCards,
  getAssistAssignments,
  setAssistAssignments,
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
import { captureProbability } from '../lib/receiptCapture';
import { resolveKgIngestAgent } from '../services/resolveAgents';
import { runKgQuery } from './v2/query';
const router = Router();
const GRAPH_NAME = 'graph_liq';
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity', max: 5 });

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
  } catch (err: any) {
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
    provider: string;
    providerModelId: string;
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
  const { chunkTarget, languageHint, llmModelKey, provider, providerModelId, debugTrace } = options;

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

  if (!provider || !providerModelId) {
    throw new Error('kg_ingest_model_resolution_failed: missing provider data');
  }
  const useStructuredOutput = provider === 'openai';
  
  // Define strict JSON schema for OpenAI structured output
  const chunkSchema = {
    type: 'object',
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chunk_index: { type: 'integer' },
            title: { type: 'string', maxLength: 80 },
            text: { type: 'string', minLength: 1 },
            language: { type: 'string' },
            topics: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number', minimum: 0, maximum: 1 }
          },
          required: ['chunk_index', 'title', 'text'],
          additionalProperties: false
        }
      }
    },
    required: ['chunks'],
    additionalProperties: false
  };
  
  const llmRes = await runLLM(prompt, {
    modelKey: llmModelKey,
    system,
    ...(llmModelKey.startsWith('gpt-5')
      ? { maxTokens: 4096 }
      : { temperature: 0, maxTokens: 4096 }
    ),
    ...(useStructuredOutput ? {
      jsonSchema: { name: 'semantic_chunks', schema: chunkSchema, strict: true }
    } : {
      jsonMode: true
    })
  });

  const rawOutputText = String(llmRes.text || '');
  const rawOutputSha1 = sha1(rawOutputText);
  const rawOutputPreview = rawOutputText.slice(0, 4000);

  if (debugTrace) {
    debugTrace.raw_output_preview = rawOutputPreview;
    debugTrace.raw_output_sha1 = rawOutputSha1;
  }

  console.log('[LLM chunking] raw_output_sha1=%s raw_len=%d provider=%s', rawOutputSha1, rawOutputText.length, provider);
  console.log('[LLM chunking] raw_output_preview (first 400 chars):', rawOutputPreview.slice(0, 400));

  let parsed: any = null;
  let parseError: string | null = null;
  
  try {
    parsed = JSON.parse(rawOutputText);
  } catch (err: any) {
    parseError = `JSON parse failed: ${err.message}`;
    console.error('[LLM chunking] invalid JSON. raw_len=%d preview=%s error=%s', rawOutputText.length, rawOutputText.slice(0, 200), parseError);
    
    if (debugTrace) {
      debugTrace.parse_error = parseError;
    }
    
    // Store evidence in error object for trace capture
    const error: any = new Error(`chunking_invalid_json: LLM returned ${rawOutputText.length} chars but not valid JSON. Preview: ${rawOutputText.slice(0, 200)}`);
    error.prompt_system = system;
    error.prompt_user_preview = promptUserPreview;
    error.prompt_user_sha1 = promptUserSha1;
    error.raw_output_preview = rawOutputPreview;
    error.raw_output_sha1 = rawOutputSha1;
    error.parse_error = parseError;
    throw error;
  }
  
  // Validate schema
  if (!parsed || typeof parsed !== 'object') {
    parseError = 'Response is not an object';
    if (debugTrace) debugTrace.parse_error = parseError;
    throw new Error(`chunking_invalid_schema: ${parseError}`);
  }
  
  if (!Array.isArray(parsed.chunks)) {
    parseError = 'Missing or invalid "chunks" array';
    if (debugTrace) debugTrace.parse_error = parseError;
    throw new Error(`chunking_invalid_schema: ${parseError}`);
  }
  
  // Validate each chunk
  for (let i = 0; i < parsed.chunks.length; i++) {
    const chunk = parsed.chunks[i];
    if (typeof chunk !== 'object' || chunk === null) {
      parseError = `Chunk ${i} is not an object`;
      if (debugTrace) debugTrace.parse_error = parseError;
      throw new Error(`chunking_invalid_schema: ${parseError}`);
    }
    if (typeof chunk.chunk_index !== 'number') {
      parseError = `Chunk ${i} missing or invalid chunk_index`;
      if (debugTrace) debugTrace.parse_error = parseError;
      throw new Error(`chunking_invalid_schema: ${parseError}`);
    }
    if (typeof chunk.title !== 'string') {
      parseError = `Chunk ${i} missing or invalid title`;
      if (debugTrace) debugTrace.parse_error = parseError;
      throw new Error(`chunking_invalid_schema: ${parseError}`);
    }
    if (typeof chunk.text !== 'string' || chunk.text.length === 0) {
      parseError = `Chunk ${i} missing or empty text`;
      if (debugTrace) debugTrace.parse_error = parseError;
      throw new Error(`chunking_invalid_schema: ${parseError}`);
    }
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

  // No fallback - fail explicitly if chunks are empty or invalid
  if (chunks.length === 0 || chunks.every((c: any) => !c.text.trim())) {
    const error: any = new Error(`chunking_empty_result: LLM returned ${chunks.length} chunks but all empty/invalid`);
    error.provider = provider;
    error.model_key = llmModelKey;
    error.provider_model_id = providerModelId;
    error.raw_output_preview = rawOutputPreview;
    error.raw_output_sha1 = rawOutputSha1;
    console.error('[KG][chunking] FAILED - empty chunks. provider=%s model=%s raw_output_length=%d', provider, llmModelKey, rawOutputText.length);
    throw error;
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

router.get('/models', async (req, res) => {
  try {
    const models = listModels();
    
    // Group by provider
    const grouped: Record<string, Array<{key: string; label: string; providerModelId: string}>> = {
      openai: [],
      openrouter: []
    };
    
    models.forEach(m => {
      grouped[m.provider].push({
        key: m.key,
        label: m.label,
        providerModelId: m.id
      });
    });
    
    return res.json(grouped);
  } catch (err: any) {
    console.error('Error listing models:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to list models' });
  }
});

router.get('/list', async (req, res) => {
  try {
    const projectType = req.query.project_type as 'assist' | 'agent' | undefined;
    const cards = await listAgentCards(null, projectType);
    return res.json({ ok: true, projects: cards });
  } catch (err: any) {
    console.error('[projects/list] error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
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
  const { name, code, project_type } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  const projectType = (project_type === 'assist' || project_type === 'agent') ? project_type : 'agent';
  try {
    const project = await createProject(name, typeof code === 'string' ? code : null, projectType);
    return res.json(project);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to create project' });
  }
});

router.get('/:projectId/config', async (req, res) => {
  const projectId = req.params.projectId;
  const agentType = (req.query.agent_type || '').toString().trim();

  if (!agentType || !['llm_chat', 'kg_ingest'].includes(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }

  try {
    const assignments = await getAssistAssignments(projectId);
    const agentId =
      agentType === 'llm_chat'
        ? assignments.assist_main_agent_id
        : assignments.assist_kg_ingest_agent_id;

    if (!agentId) {
      return res
        .status(409)
        .json({ ok: false, error: 'missing_agent_assignment', agent_type: agentType });
    }

    const { rows } = await pool.query(
      `SELECT agent_id, model, provider, temperature, max_tokens, prompt_template
       FROM ag_catalog.project_agents
       WHERE project_id = $1 AND agent_id = $2 AND is_active = true
       LIMIT 1`,
      [projectId, agentId],
    );

    const agentRow = rows[0];
    if (!agentRow) {
      return res.status(404).json({ ok: false, error: 'agent_not_found', agent_id: agentId });
    }

    const missing: string[] = [];
    if (!agentRow.provider) missing.push('provider');
    if (!agentRow.model) missing.push('model');
    if (agentRow.temperature == null) missing.push('temperature');
    if (agentRow.max_tokens == null) missing.push('max_tokens');
    if (!agentRow.prompt_template) missing.push('prompt_template');

    if (missing.length) {
      return res
        .status(409)
        .json({ ok: false, error: 'missing_config', missing, agent_type: agentType });
    }

    return res.json({
      ok: true,
      config: {
        agent_id: agentRow.agent_id,
        agent_type: agentType,
        provider: agentRow.provider,
        model_key: agentRow.model,
        temperature: agentRow.temperature,
        max_tokens: agentRow.max_tokens,
        prompt_template: agentRow.prompt_template,
      },
    });
  } catch (err: any) {
    console.error('Get project config failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to get project config' });
  }
});

router.get('/:projectId/assist/assignments', async (req, res) => {
  try {
    const assignments = await getAssistAssignments(req.params.projectId);
    return res.json({ ok: true, assignments });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_load_assignments' });
  }
});

router.put('/:projectId/assist/assignments', async (req, res) => {
  const assistProjectId = req.params.projectId;
  
  // Build patch object with only fields that are explicitly provided
  const patch: Record<string, any> = {};
  
  if (Object.prototype.hasOwnProperty.call(req.body, 'assist_main_agent_id')) {
    patch.assist_main_agent_id = req.body.assist_main_agent_id;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'assist_kg_ingest_agent_id')) {
    patch.assist_kg_ingest_agent_id = req.body.assist_kg_ingest_agent_id;
  }

  // Validation: Ensure IDs are valid UUIDs if provided
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Object.prototype.hasOwnProperty.call(patch, 'assist_main_agent_id') && patch.assist_main_agent_id) {
    if (!uuidRegex.test(patch.assist_main_agent_id)) {
      console.error('[ASSIGNMENTS] Invalid UUID format for assist_main_agent_id:', patch.assist_main_agent_id);
      return res.status(400).json({ ok: false, error: 'invalid_uuid_format', field: 'assist_main_agent_id' });
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'assist_kg_ingest_agent_id') && patch.assist_kg_ingest_agent_id) {
    if (!uuidRegex.test(patch.assist_kg_ingest_agent_id)) {
      console.error('[ASSIGNMENTS] Invalid UUID format for assist_kg_ingest_agent_id:', patch.assist_kg_ingest_agent_id);
      return res.status(400).json({ ok: false, error: 'invalid_uuid_format', field: 'assist_kg_ingest_agent_id' });
    }
  }

  // Check if patch is empty
  const updatedFields = Object.keys(patch);
  if (updatedFields.length === 0) {
    console.error('[ASSIGNMENTS] No fields provided in request body');
    return res.status(400).json({ ok: false, error: 'assignments_empty_patch' });
  }

  console.log('[ASSIGNMENTS] PUT request received:', {
    assistProjectId,
    updatedFields,
    payload: patch,
  });

  try {
    const assignments = await setAssistAssignments(assistProjectId, patch);

    console.log('[ASSIGNMENTS] DB update successful:', {
      assistProjectId,
      updatedFields,
      assignments,
    });

    return res.json({ ok: true, assignments });
  } catch (err: any) {
    console.error('[ASSIGNMENTS] DB update failed:', {
      assistProjectId,
      updatedFields,
      error: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({ ok: false, error: err?.message || 'failed_to_save_assignments' });
  }
});

router.put('/:projectId/config', async (req, res) => {
  const projectId = req.params.projectId;
  const {
    agent_type: rawAgentType,
    model_key,
    provider,
    temperature,
    max_tokens,
    prompt_template,
  } = req.body || {};

  const agentType = typeof rawAgentType === 'string' ? rawAgentType.trim() : '';
  if (!agentType || !['llm_chat', 'kg_ingest'].includes(agentType)) {
    return res.status(400).json({ ok: false, error: 'invalid_agent_type' });
  }

  const missing: string[] = [];
  if (!provider) missing.push('provider');
  if (!model_key) missing.push('model_key');
  if (temperature == null) missing.push('temperature');
  if (max_tokens == null) missing.push('max_tokens');
  if (!prompt_template || !prompt_template.toString().trim()) missing.push('prompt_template');

  if (missing.length) {
    return res.status(400).json({ ok: false, error: 'invalid_config', missing, agent_type: agentType });
  }

  try {
    const assignments = await getAssistAssignments(projectId);
    const agentId =
      agentType === 'llm_chat'
        ? assignments.assist_main_agent_id
        : assignments.assist_kg_ingest_agent_id;

    if (!agentId) {
      return res
        .status(409)
        .json({ ok: false, error: 'missing_agent_assignment', agent_type: agentType });
    }

    console.log(
      '[SAVE_CONFIG] projectId=%s agent_type=%s agent_id=%s model_key=%s provider=%s',
      projectId,
      agentType,
      agentId,
      model_key,
      provider,
    );

    const { rowCount } = await pool.query(
      `UPDATE ag_catalog.project_agents
       SET provider = $3,
           model = $4,
           temperature = $5,
           max_tokens = $6,
           prompt_template = $7
       WHERE project_id = $1 AND agent_id = $2 AND is_active = true`,
      [projectId, agentId, provider ?? null, model_key ?? null, temperature ?? null, max_tokens ?? null, prompt_template ?? null],
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'agent_not_found', agent_id: agentId });
    }

    return res.json({ ok: true, agent_id: agentId, agent_type: agentType });
  } catch (err) {
    console.error('[SAVE_CONFIG] error for projectId=%s agent_type=%s:', projectId, agentType, err);
    return res.status(500).json({ ok: false, error: 'internal_error', message: 'Failed to save configuration' });
  }
});

router.delete('/:projectId', async (req, res) => {
  const projectId = req.params.projectId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete related data first (only project_agents has project_id FK)
    await client.query('DELETE FROM ag_catalog.project_agents WHERE project_id = $1', [projectId]);
    
    // Delete the project itself (projects table uses 'id' as PK)
    const result = await client.query('DELETE FROM ag_catalog.projects WHERE id = $1 RETURNING id', [projectId]);
    
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Project not found' });
    }
    
    await client.query('COMMIT');
    return res.json({ ok: true, deleted: projectId });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Delete project failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to delete project' });
  } finally {
    client.release();
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
  try {
    const { cypher, params } = req.body || {};
    const rows = await runKgQuery({
      graphName: GRAPH_NAME,
      projectId: req.params.projectId,
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
  const { projectId, doc_id, src, text, embed_model, options, debug, trace } = params;
  
  const debugTrace: any = debug ? {
    input: { text_length: text?.length || 0, projectId, doc_id, src },
    config: {},
    chunking: {},
    extraction: {},
    results: {},
  } : null;

  // Build meta info early
  const meta: any = {
    raw_len: text?.length || 0,
    provider: 'unresolved',
    model: 'unresolved',
    projectId,
    doc_id,
    src,
  };

  try {
    await getProjectState(projectId);
  } catch (err: any) {
    console.log('[KG_INGEST_META] project not found:', meta);
    throw new Error(err?.message || 'project not found');
  }

  // Resolve KG ingest agent from DB
  let llmModelKey: string;
  let kgAgentId: string | null = null;
  let kgProvider: string | null = null;
  let kgProviderModelId: string | null = null;
  let kgSystemPrompt = '';
  
  try {
    const resolved = await resolveKgIngestAgent(projectId);
    if (!resolved) {
      console.log('[KG_INGEST_META] agent resolution failed:', meta);
      throw new Error('kg_ingest_agent_not_configured: No KG ingest agent found for project');
    }
    llmModelKey = resolved.modelKey;
    kgAgentId = resolved.agent.agent_id;
    kgProvider = resolved.provider;
    kgProviderModelId = resolved.providerModelId;
    kgSystemPrompt = resolved.systemPrompt || '';

    // Update meta with resolved values
    meta.provider = kgProvider || 'unknown';
    meta.model = llmModelKey || 'unknown';
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.error('[KG_RESOLVE] Resolution failed:', { projectId, error: errorMsg });
    
    // Standardize error response
    let error_code = 'kg_ingest_resolution_failed';
    let message = errorMsg;
    
    if (errorMsg.includes('kg_ingest_agent_missing_assist_assignment')) {
      error_code = 'kg_ingest_agent_missing_assist_assignment';
      message = `KG ingest agent not assigned for project ${projectId}. Assign a KG Ingest agent in Agent Builder.`;
    } else if (errorMsg.includes('kg_ingest_prompt_missing')) {
      error_code = 'kg_ingest_prompt_missing';
      message = `KG ingest agent missing prompt_template for project ${projectId}`;
    } else if (errorMsg.includes('kg_ingest_model_missing')) {
      error_code = 'kg_ingest_model_missing';
      message = `KG ingest agent missing model configuration for project ${projectId}`;
    } else if (errorMsg.includes('invalid_model_key_format')) {
      error_code = 'invalid_model_key_format';
      message = errorMsg;
    } else if (errorMsg.includes('kg_ingest_model_resolution_failed')) {
      error_code = 'kg_ingest_model_resolution_failed';
      message = errorMsg;
    }
    
    throw { error_code, message, projectId, meta };
  }

  const embedModel = embed_model || DEFAULT_EMBED_MODEL;

  if (debugTrace) {
    debugTrace.config = { llmModelKey, embedModel, kgAgentId };
  }

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
    const chunkStartTime = Date.now();
    try {
      console.log('[RUNTIME_MODEL] role=kg_chunking projectId=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s', projectId, kgAgentId, kgProvider, llmModelKey, kgProviderModelId);
      // llmSemanticChunking will force OpenAI internally for structured JSON
      const chunkingResult = await llmSemanticChunking(normalizedText, {
        chunkTarget,
        languageHint,
        llmModelKey,
        provider: kgProvider || '',
        providerModelId: kgProviderModelId || '',
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
      const system = kgSystemPrompt;
      
      const prompt = [
        'Return STRICT JSON ONLY with shape:',
        '{"entities":[{"type":"", "name":"", "attrs":{}, "confidence":0.0}], "relations":[{"type":"", "from":{"type":"","name":""}, "to":{"type":"","name":""}, "attrs":{}, "confidence":0.0}], "provenance":{"method":"llm_extract"}}',
        '',
        `Language hint: ${languageHint}`,
        'Text chunk:',
        chunk,
      ].join('\n');

      console.log('[RUNTIME_MODEL] role=kg_extract   projectId=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s', projectId, kgAgentId, kgProvider, llmModelKey, kgProviderModelId);

      const llmRes = await runLLM(prompt, {
        modelKey: llmModelKey,
        system,
        temperature: 0,
        maxTokens: 2048,
      });
      llmModelId = llmRes.model;

      // Capture probability (fire-and-forget)
      void captureProbability({
        projectId,
        outputText: llmRes.text
      }).catch(err => console.error('[KG_INGEST] probability capture failed:', err));

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
    meta, // Include meta in successful response
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
    meta,
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
  
  // Build meta info early, before config resolution
  const meta = {
    raw_len: textToIngest?.length || 0,
    provider: 'unresolved',
    model: 'unresolved',
    projectId,
    doc_id,
    src,
  };
  
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
    console.log('[KG_INGEST_META] failure meta:', meta);
    
    // Handle standardized error objects
    if (err.error_code) {
      response = {
        ok: false,
        error_code: err.error_code,
        message: err.message,
        projectId: err.projectId,
        meta: err.meta || meta,
      };
    } else {
      // Fallback for unexpected errors
      response = {
        ok: false,
        error_code: 'kg_ingest_failed',
        message: err?.message || 'chat ingest failed',
        projectId,
        meta,
      };
    }
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
  const { turn_id, user_text, assistant_text, src } = req.body || {};

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

  // Use V2 ingest pipeline
  try {
    console.log('[KG_V2][route] using V2 chunker for ingest_chat_turn');
    // Import V2 functions
    const { chunkTextStrictJSON, extractKgFromChunks } = await import('./v2/chunking.js');
    const { getAssistAssignments } = await import('../services/agentBuilderStore.js');
    const { resolveKgIngestAgent } = await import('../services/resolveAgents.js');
    
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

    const rawLen = textToIngest.length;
    console.log('[KG_V2][ingest] start projectId=%s doc_id=%s src=%s raw_len=%d', projectId, doc_id, finalSrc, rawLen);

    let chunkMeta: any = null;
    let chunks: { chunk_id: string; text: string; start: number; end: number }[] = [];

    if (!errors.length && modelKey && systemPrompt) {
      try {
        console.log(
          '[KG_V2][ingest] using model=%s prompt_len=%d',
          modelKey,
          systemPrompt.length,
        );
        const chunked = await chunkTextStrictJSON({
          modelKey: modelKey as string,
          text: textToIngest,
          systemPrompt: systemPrompt ?? undefined,
        });
        chunks = chunked.chunks;
        chunkMeta = chunked.meta;
        console.log('[KG_V2][chunk] chunks=%d token_param=%s temperature_param=%s',
          chunks.length,
          chunkMeta?.token_param || 'unknown',
          chunkMeta?.temperature_param || 'unknown'
        );
      } catch (err: any) {
        const code = err?.code || 'chunking_failed';
        console.error(
          '[KG_V2][chunk] failed provider=%s model=%s error=%s',
          provider || 'unknown',
          modelKey || 'unknown',
          err?.message || err,
        );
        errors.push(code);
        errorMessages.push(err?.message || String(err));
      }
    }

    if (chunks.length === 0 && errors.length === 0) {
      errors.push('chunking_invalid_json');
      errorMessages.push('chunking returned 0 chunks');
    }

    // Insert chunks into DB
    let chunksWritten = 0;
    for (const chunk of chunks) {
      try {
        await pool.query(
          'INSERT INTO ag_catalog.rag_chunks (doc_id, src, chunk) VALUES ($1, $2, $3)',
          [doc_id, finalSrc, chunk.text],
        );
        chunksWritten += 1;
      } catch (err: any) {
        console.error('[KG_V2][ingest] chunk insert failed:', err?.message || err);
      }
    }

    const provenance = {
      doc_id,
      src: finalSrc,
      method: 'kg_v2_ingest',
      createdAt: new Date().toISOString(),
    };

    // Extract entities and relationships
    let entitiesWritten = 0;
    let relationshipsWritten = 0;
    let entities: any[] = [];
    let relationships: any[] = [];

    let extractMeta: any = null;
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

    // Upsert to graph
    if (entities.length || relationships.length) {
      const entityLookup = new Map(entities.map((e: any) => [e.id, e]));
      
      // Simple entity upsert
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
              source: { ...provenance, evidence_chunk_ids: e.evidence_chunk_ids },
            },
          );
          entitiesWritten += 1;
        } catch (err: any) {
          console.error('[KG_V2][ingest] entity upsert failed:', err?.message || err);
        }
      }

      // Simple relationship upsert
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
              source: { ...provenance, evidence_chunk_ids: r.evidence_chunk_ids },
            },
          );
          relationshipsWritten += 1;
        } catch (err: any) {
          console.error('[KG_V2][ingest] relation upsert failed:', err?.message || err);
        }
      }
      
      console.log('[KG_V2][graph] upserts ok');
    }

    console.log('[KG_V2][ingest] done ok=%s chunks=%d entities=%d rels=%d',
      errors.length === 0,
      chunksWritten,
      entitiesWritten,
      relationshipsWritten,
    );

    const errorCode = errors.length ? errors[0] : null;
    const errorMessage = errorMessages.length ? errorMessages.join('; ') : null;

    // Meta logging for diagnostics
    const requestId = extractMeta?.request_id || chunkMeta?.request_id || null;
    const elapsedMs = extractMeta?.elapsed_ms || chunkMeta?.elapsed_ms || null;
    const finishReason = extractMeta?.finish_reason || chunkMeta?.finish_reason || null;
    const usage = extractMeta?.usage || chunkMeta?.usage || null;
    const providerForLog = provider ?? null;
    const modelKeyForLog = modelKey ?? null;
    
    const usageSummary = (() => {
      if (!usage || typeof usage !== 'object') return null;
      const summary: Record<string, number> = {};
      if (typeof usage.prompt_tokens === 'number') summary.prompt = usage.prompt_tokens;
      if (typeof usage.completion_tokens === 'number') summary.completion = usage.completion_tokens;
      if (typeof usage.total_tokens === 'number') summary.total = usage.total_tokens;
      if (typeof usage.input_tokens === 'number') summary.input = usage.input_tokens;
      if (typeof usage.output_tokens === 'number') summary.output = usage.output_tokens;
      return Object.keys(summary).length ? JSON.stringify(summary) : null;
    })();
    
    console.log(
      '[KG_V2][ingest][meta] projectId=%s doc_id=%s raw_len=%d provider=%s model=%s request_id=%s elapsed_ms=%s finish=%s usage=%s',
      projectId,
      doc_id,
      rawLen,
      providerForLog || 'unknown',
      modelKeyForLog || 'unknown',
      requestId || 'n/a',
      elapsedMs ?? 'n/a',
      finishReason || 'n/a',
      usageSummary || 'n/a',
    );

    return res.status(errors.length === 0 ? 200 : 409).json({
      ok: errors.length === 0,
      error_code: errorCode,
      error_message: errorMessage,
      counts: {
        chunks: chunksWritten,
        entities: entitiesWritten,
        rels: relationshipsWritten,
      },
    });
  } catch (err: any) {
    console.error('[KG_V2][ingest] unexpected error:', err);
    return res.status(500).json({ ok: false, error: 'kg_ingest_failed', message: err?.message || 'ingest failed' });
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
      entities = Number((eRow as any)?.c ?? 0);

      const [rRow] = await runCypherOnGraph(
        GRAPH_NAME,
        `
          MATCH (:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(:Entity { project_id: $projectId })
          RETURN count(r) AS c
        `,
        { projectId },
      );
      relations = Number((rRow as any)?.c ?? 0);

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
    const response = { ok: true, agent: saved };
    return res.status(response?.ok === false ? 200 : 200).json(response);
  } catch (err: any) {
    console.error('[SAVE_AGENT] error:', err?.message || err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      ok: false,
      error: 'save_agent_failed',
      message: err?.message || 'failed to save agent config',
    });
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
