import { resolveModel } from '../../llm/models.config';
import { safeFetch } from '../../security/safeFetch';
import {
  buildResponsesInput,
  buildResponsesPayload,
  extractResponsesFinishReason,
  extractResponsesText,
} from '../../llm/responses';

export type KgChunk = {
  chunk_id: string;
  text: string;
  start: number;
  end: number;
};

export type KgEntity = {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  evidence_chunk_ids: string[];
};

export type KgRelationship = {
  from: string;
  to: string;
  type: string;
  evidence_chunk_ids: string[];
  confidence: number;
};

const CHUNK_TEXT_MAX = 2000;
const MAX_ENTITIES = 50;
const MAX_RELATIONSHIPS = 80;

const DEFAULT_KG_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'kg_extract',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chunk_id: { type: 'string' },
            text: { type: 'string' },
            start: { type: 'number' },
            end: { type: 'number' },
          },
          required: ['chunk_id', 'text', 'start', 'end'],
        },
      },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            name: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'type', 'name', 'aliases', 'evidence_chunk_ids'],
        },
      },
      relations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            type: { type: 'string' },
            evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
          },
          required: ['from', 'to', 'type', 'evidence_chunk_ids', 'confidence'],
        },
      },
    },
    required: ['chunks', 'entities', 'relations'],
  },
};

export type LlmMeta = {
  provider: 'openai';
  model_key: string;
  model_id: string;
  request_id?: string;
  finish_reason?: string | null;
  usage?: any;
  elapsed_ms: number;
  raw_len: number;
  preview_len: number;
};

function createTypedError(code: string, message: string, details?: Record<string, unknown>) {
  const err: any = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

function clampText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function slug(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function getOpenAiConfig(modelKey: string) {
  const model = resolveModel(modelKey);
  if (model.provider !== 'openai') {
    throw createTypedError(
      'kg_ingest_provider_not_openai',
      `kg_ingest provider must be openai (got ${model.provider})`,
    );
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw createTypedError('provider_key_missing', 'OPENAI_API_KEY missing');
  }
  const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const allowHosts = (process.env.ALLOW_HOSTS_OPENAI || 'api.openai.com')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return { modelId: model.id, apiKey, base, allowHosts };
}

async function callOpenAiJsonSchema(opts: {
  modelKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
  logTag: string;
  emptyCode: string;
  responseFormat?: any;
  temperature?: number | null;
  topP?: number | null;
  previousResponseId?: string | null;
}) {
  const {
    modelKey,
    system,
    prompt,
    maxTokens,
    logTag,
    emptyCode,
    responseFormat,
    temperature,
    topP,
    previousResponseId,
  } = opts;
  const cfg = getOpenAiConfig(modelKey);
  const url = `${cfg.base.replace(/\/+$/, '')}/responses`;
  const started = Date.now();
  const input = buildResponsesInput(system, prompt);
  const requestBody: any = buildResponsesPayload({
    model: cfg.modelId,
    input,
    response_format: responseFormat ?? DEFAULT_KG_RESPONSE_FORMAT,
    temperature: typeof temperature === 'number' ? temperature : undefined,
    top_p: typeof topP === 'number' ? topP : undefined,
    max_output_tokens: maxTokens,
    previous_response_id: previousResponseId ?? undefined,
  });

  console.log(`[KG_V2][${logTag}] request`, {
    model: cfg.modelId,
    max_output_tokens: maxTokens,
    body_keys: Object.keys(requestBody),
  });

  const rawTimeout =
    process.env.KG_INGEST_REQUEST_TIMEOUT_MS ??
    process.env.REQUEST_TIMEOUT_MS ??
    90000;
  const parsedTimeout = Number(rawTimeout);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 1000
    ? parsedTimeout
    : 90000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await safeFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      timeoutMs: 0,
      signal: controller.signal,
      allowHosts: cfg.allowHosts,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (err?.name === 'AbortError' || msg.toLowerCase().includes('aborted')) {
      throw createTypedError('openai_request_aborted', 'OpenAI request aborted');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const elapsed_ms = Date.now() - started;
  const request_id = res.headers.get('x-request-id') || res.headers.get('request-id') || '';
  const rawText = await res.text().catch(() => '');
  let raw: any = {};
  try {
    raw = rawText ? JSON.parse(rawText) : {};
  } catch {
    raw = rawText;
  }
  if (!res.ok) {
    console.error(`[KG_V2][${logTag}] openai error`, {
      status: res.status,
      request_id,
      elapsed_ms,
      error: raw?.error,
    });
    throw createTypedError('openai_request_failed', `OpenAI request failed (${res.status})`);
  }

  // Debug response shape
  console.log('[KG_V2][response-shape] keys:', Object.keys(raw));
  console.log('[KG_V2][response-shape] has_output:', Array.isArray(raw?.output));
  console.log('[KG_V2][response-shape] output_len:', Array.isArray(raw?.output) ? raw.output.length : 0);

  const finish_reason = extractResponsesFinishReason(raw);
  const usage = raw?.usage ?? null;
  if (usage) {
    console.log(`[KG_V2][${logTag}] usage`, {
      prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
    });
  }
  const rawContent = extractResponsesText(raw);
  const branch = rawContent.trim().length > 0 ? 'content' : 'none';
  const preview = String(rawContent || JSON.stringify(raw)).slice(0, 200);
  const raw_len = typeof rawContent === 'string' ? rawContent.length : 0;
  const preview_len = preview.length;

  console.log(`[KG_V2][${logTag}] output_branch=%s raw_len=%d`, branch, raw_len);
  console.log(`[KG_V2][${logTag}] response_meta`, {
    request_id,
    finish_reason,
    elapsed_ms,
    content_len: String(rawContent || '').length,
    raw_len,
  });

  if (!rawContent || !String(rawContent).trim()) {
    console.error(`[KG_V2][${logTag}] empty output`, {
      provider: 'openai',
      model: cfg.modelId,
      max_output_tokens: maxTokens,
      finish_reason,
      usage,
      request_id,
      elapsed_ms,
      preview_len,
    });
    throw createTypedError(emptyCode, 'OpenAI returned empty output', {
      provider: 'openai',
      model: cfg.modelId,
      finish_reason,
      usage,
      request_id,
      elapsed_ms,
    });
  }

  return {
    content: String(rawContent),
    meta: {
      provider: 'openai',
      model_key: modelKey,
      model_id: cfg.modelId,
      request_id,
      finish_reason,
      usage,
      elapsed_ms,
      raw_len,
      preview_len,
    } as LlmMeta,
  };
}

export async function chunkTextStrictJSON(opts: {
  modelKey: string;
  text: string;
  systemPrompt?: string;
  responseFormat?: any;
  temperature?: number | null;
  topP?: number | null;
  previousResponseId?: string | null;
  maxTokens: number;
}) {
  const baseSystem = 'Return strict JSON only. Output MUST match the schema.';
  const system = opts.systemPrompt ? `${opts.systemPrompt}\n\n${baseSystem}` : baseSystem;
  const prompt = [
    'Split the input into semantic chunks.',
    'Return JSON with keys: chunks, entities, relations.',
    'Each chunk must include chunk_id, text, start, end.',
    'If no chunks can be produced, return {"chunks": [], "entities": [], "relations": []}.',
    '',
    'Input:',
    opts.text,
  ].join('\n');

  const { content, meta } = await callOpenAiJsonSchema({
    modelKey: opts.modelKey,
    system,
    prompt,
    maxTokens: opts.maxTokens,
    logTag: 'chunk',
    emptyCode: 'chunking_empty_output',
    responseFormat: opts.responseFormat,
    temperature: opts.temperature ?? null,
    topP: opts.topP ?? null,
    previousResponseId: opts.previousResponseId ?? null,
  });

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    console.error('[KG_V2][chunk] invalid json', {
      model: opts.modelKey,
      error: err?.message || err,
      preview: content.slice(0, 200),
    });
    throw createTypedError('chunking_invalid_json', 'Chunking returned invalid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chunks)) {
    console.error('[KG_V2][chunk] invalid json shape', {
      model: opts.modelKey,
      preview: content.slice(0, 200),
      hasChunks: Array.isArray(parsed?.chunks),
    });
    throw createTypedError('chunking_invalid_json', 'Chunking returned invalid JSON shape: expected { chunks: [...] }');
  }

  const chunks = parsed.chunks
    .slice(0, 20)
    .map((c: any, idx: number) => {
      const chunk_id = typeof c?.chunk_id === 'string' ? c.chunk_id : `c${idx + 1}`;
      const text = clampText(String(c?.text ?? ''), CHUNK_TEXT_MAX);
      const start = typeof c?.start === 'number' ? c.start : 0;
      const end = typeof c?.end === 'number' ? c.end : start + text.length;
      return { chunk_id, text, start, end };
    })
    .filter((c: KgChunk) => c.text.trim().length > 0);

  if (!chunks.length) {
    throw createTypedError('chunking_invalid_json', 'Chunking returned no chunks');
  }

  return { chunks, meta };
}

export async function extractKgFromChunks(opts: {
  modelKey: string;
  chunks: KgChunk[];
  docId?: string;
  systemPrompt?: string;
  responseFormat?: any;
  temperature?: number | null;
  topP?: number | null;
  previousResponseId?: string | null;
  maxTokens: number;
}) {
  const chunkIds = opts.chunks.map((c) => c.chunk_id);
  const chunkBlock = opts.chunks
    .map((c) => `(${c.chunk_id}) ${c.text}`)
    .join('\n\n')
    .slice(0, 10000);

  const baseSystem = 'Return strict JSON only. Output MUST match the schema.';
  const system = opts.systemPrompt ? `${opts.systemPrompt}\n\n${baseSystem}` : baseSystem;
  const prompt = [
    'Extract entities and relationships from the chunks.',
    'Only use evidence_chunk_ids that exist in the input chunk list.',
    'Keep the output small.',
    'Return JSON with keys: chunks, entities, relations.',
    'If none are found, return {"chunks": [], "entities": [], "relations": []}.',
    '',
    `Chunk IDs: ${chunkIds.join(', ')}`,
    '',
    'Chunks:',
    chunkBlock,
  ].join('\n');

  const { content, meta } = await callOpenAiJsonSchema({
    modelKey: opts.modelKey,
    system,
    prompt,
    maxTokens: opts.maxTokens,
    logTag: 'extract',
    emptyCode: 'extract_empty_output',
    responseFormat: opts.responseFormat,
    temperature: opts.temperature ?? null,
    topP: opts.topP ?? null,
    previousResponseId: opts.previousResponseId ?? null,
  });

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    console.error('[KG_V2][extract] invalid json', {
      model: opts.modelKey,
      error: err?.message || err,
      preview: content.slice(0, 200),
    });
    throw createTypedError('extract_invalid_json', 'Extraction returned invalid JSON');
  }

  const parsedEntities = Array.isArray(parsed?.entities)
    ? parsed.entities
    : Array.isArray(parsed?.nodes)
      ? parsed.nodes
      : null;
  const parsedRelations = Array.isArray(parsed?.relations)
    ? parsed.relations
    : Array.isArray(parsed?.rels)
      ? parsed.rels
      : Array.isArray(parsed?.relationships)
        ? parsed.relationships
        : null;

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsedEntities) || !Array.isArray(parsedRelations)) {
    console.error('[KG_V2][extract] invalid json shape', { model: opts.modelKey, preview: content.slice(0, 200) });
    throw createTypedError('extract_invalid_json', 'Extraction returned invalid JSON');
  }

  const chunkIdSet = new Set(chunkIds);
  const defaultEvidence = chunkIds.length ? [chunkIds[0]] : [];
  const entities = parsedEntities
    .slice(0, MAX_ENTITIES)
    .map((e: any, idx: number): KgEntity | null => {
      const type = typeof e?.type === 'string' ? e.type : 'UNKNOWN';
      const name = typeof e?.name === 'string' ? e.name : '';
      const id =
        typeof e?.id === 'string' && e.id.trim()
          ? e.id
          : `${slug(type) || 'entity'}:${slug(name) || `e${idx + 1}`}`;
      const aliases = Array.isArray(e?.aliases) ? e.aliases.map((a: any) => String(a)).slice(0, 10) : [];
      const evidence_chunk_ids = Array.isArray(e?.evidence_chunk_ids)
        ? e.evidence_chunk_ids.map((c: any) => String(c)).filter((c: string) => chunkIdSet.has(c))
        : defaultEvidence;
      if (!name.trim() || evidence_chunk_ids.length === 0) return null;
      return {
        id,
        type,
        name: name.slice(0, 200),
        aliases,
        evidence_chunk_ids,
      };
    })
    .filter(Boolean) as KgEntity[];

  const entityIdSet = new Set(entities.map((e) => e.id));
  const entityNameToId = new Map(entities.map((e) => [e.name.toLowerCase(), e.id]));
  const relationships = parsedRelations
    .slice(0, MAX_RELATIONSHIPS)
    .map((r: any): KgRelationship | null => {
      let from = typeof r?.from === 'string' ? r.from : '';
      let to = typeof r?.to === 'string' ? r.to : '';
      if (from && !entityIdSet.has(from)) {
        from = entityNameToId.get(from.toLowerCase()) ?? from;
      }
      if (to && !entityIdSet.has(to)) {
        to = entityNameToId.get(to.toLowerCase()) ?? to;
      }
      const type = typeof r?.type === 'string' ? r.type : 'REL';
      const evidence_chunk_ids = Array.isArray(r?.evidence_chunk_ids)
        ? r.evidence_chunk_ids.map((c: any) => String(c)).filter((c: string) => chunkIdSet.has(c))
        : defaultEvidence;
      const confidence = typeof r?.confidence === 'number' ? r.confidence : 0.5;
      if (!from || !to || evidence_chunk_ids.length === 0) return null;
      if (!entityIdSet.has(from) || !entityIdSet.has(to)) return null;
      return { from, to, type: type.slice(0, 80), evidence_chunk_ids, confidence };
    })
    .filter(Boolean) as KgRelationship[];

  if (entities.length === 0 && relationships.length === 0) {
    console.error('[KG_V2][extract][ZERO]', {
      doc_id: opts.docId || null,
      model: opts.modelKey,
      raw: content.slice(0, 600),
    });
  }

  return { entities, relationships, meta };
}
