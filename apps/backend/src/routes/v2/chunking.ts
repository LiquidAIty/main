import { resolveModel } from '../../llm/models.config';
import { safeFetch } from '../../security/safeFetch';

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
  schema: any;
  maxTokens: number;
  logTag: string;
  emptyCode: string;
}) {
  const { modelKey, system, prompt, schema, maxTokens, logTag, emptyCode } = opts;
  const cfg = getOpenAiConfig(modelKey);
  const url = `${cfg.base.replace(/\/+$/, '')}/chat/completions`;
  const started = Date.now();

  const res = await safeFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.modelId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      ...(modelKey.startsWith('gpt-5')
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens, temperature: 0 }
      ),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'kg_v2', schema, strict: true },
      },
    }),
    timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 20000),
    allowHosts: cfg.allowHosts,
  });

  const elapsed_ms = Date.now() - started;
  const request_id = res.headers.get('x-request-id') || res.headers.get('request-id') || '';
  const raw = await res.json().catch(() => ({}));
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
  console.log('[KG_V2][response-shape] has_choices:', Boolean(raw?.choices));
  console.log('[KG_V2][response-shape] has_message:', Boolean(raw?.choices?.[0]?.message));
  const choice = raw?.choices?.[0] ?? {};
  const msg = choice?.message ?? {};
  console.log('[KG_V2][response-shape] content_type:', typeof msg?.content);
  console.log('[KG_V2][response-shape] content_len:', String(msg?.content || '').length);
  console.log('[KG_V2][response-shape] message_keys:', Object.keys(msg || {}));
  console.log('[KG_V2][response-shape] tool_calls_len:', msg?.tool_calls?.length || 0);
  if (msg?.tool_calls?.length) {
    console.log('[KG_V2][response-shape] tool_call_name:', msg.tool_calls[0]?.function?.name);
    console.log('[KG_V2][response-shape] tool_args_len:', (msg.tool_calls[0]?.function?.arguments || '').length);
  }

  const finish_reason = choice?.finish_reason ?? null;
  const usage = raw?.usage ?? null;
  const content =
    typeof msg?.content === 'string'
      ? msg.content
      : Array.isArray(msg?.content)
        ? msg.content.map((p: any) => p?.text ?? '').join('')
        : '';
  const toolArgs =
    msg?.tool_calls?.[0]?.function?.arguments &&
    typeof msg.tool_calls[0].function.arguments === 'string'
      ? msg.tool_calls[0].function.arguments
      : '';
  const rawContent = content && content.trim().length ? content : toolArgs;
  const preview = String(rawContent || JSON.stringify(raw)).slice(0, 200);
  const raw_len = typeof rawContent === 'string' ? rawContent.length : 0;
  const preview_len = preview.length;

  if (!rawContent || !String(rawContent).trim()) {
    const tokenParam = modelKey.startsWith('gpt-5') ? 'max_completion_tokens' : 'max_tokens';
    const temperatureParam = modelKey.startsWith('gpt-5') ? 'omitted' : '0';
    console.error(`[KG_V2][${logTag}] empty output`, {
      provider: 'openai',
      model: cfg.modelId,
      token_param: tokenParam,
      temperature_param: temperatureParam,
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

export async function chunkTextStrictJSON(opts: { modelKey: string; text: string; systemPrompt?: string }) {
  const baseSystem = 'Return strict JSON only. Output MUST match the schema.';
  const system = opts.systemPrompt ? `${opts.systemPrompt}\n\n${baseSystem}` : baseSystem;
  const prompt = [
    'Split the input into semantic chunks.',
    'Return a JSON array of chunks only.',
    'Each chunk must include chunk_id, text, start, end.',
    '',
    'Input:',
    opts.text,
  ].join('\n');

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['chunks'],
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['chunk_id', 'text', 'start', 'end'],
          properties: {
            chunk_id: { type: 'string' },
            text: { type: 'string' },
            start: { type: 'integer' },
            end: { type: 'integer' },
          },
        },
      },
    },
  };

  const { content, meta } = await callOpenAiJsonSchema({
    modelKey: opts.modelKey,
    system,
    prompt,
    schema,
    maxTokens: 1024,
    logTag: 'chunk',
    emptyCode: 'chunking_empty_output',
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

export async function extractKgFromChunks(opts: { modelKey: string; chunks: KgChunk[]; systemPrompt?: string }) {
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
    '',
    `Chunk IDs: ${chunkIds.join(', ')}`,
    '',
    'Chunks:',
    chunkBlock,
  ].join('\n');

  const schema = {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            name: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'type', 'name', 'aliases', 'evidence_chunk_ids'],
          additionalProperties: false,
        },
      },
      relationships: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            type: { type: 'string' },
            evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
          },
          required: ['from', 'to', 'type', 'evidence_chunk_ids', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['entities', 'relationships'],
    additionalProperties: false,
  };

  const { content, meta } = await callOpenAiJsonSchema({
    modelKey: opts.modelKey,
    system,
    prompt,
    schema,
    maxTokens: 1024,
    logTag: 'extract',
    emptyCode: 'extract_empty_output',
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

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entities) || !Array.isArray(parsed.relationships)) {
    console.error('[KG_V2][extract] invalid json shape', { model: opts.modelKey, preview: content.slice(0, 200) });
    throw createTypedError('extract_invalid_json', 'Extraction returned invalid JSON');
  }

  const chunkIdSet = new Set(chunkIds);
  const entities = parsed.entities
    .slice(0, MAX_ENTITIES)
    .map((e: any, idx: number): KgEntity | null => {
      const id = typeof e?.id === 'string' ? e.id : `e${idx + 1}`;
      const type = typeof e?.type === 'string' ? e.type : 'UNKNOWN';
      const name = typeof e?.name === 'string' ? e.name : '';
      const aliases = Array.isArray(e?.aliases) ? e.aliases.map((a: any) => String(a)).slice(0, 10) : [];
      const evidence_chunk_ids = Array.isArray(e?.evidence_chunk_ids)
        ? e.evidence_chunk_ids.map((c: any) => String(c)).filter((c: string) => chunkIdSet.has(c))
        : [];
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
  const relationships = parsed.relationships
    .slice(0, MAX_RELATIONSHIPS)
    .map((r: any): KgRelationship | null => {
      const from = typeof r?.from === 'string' ? r.from : '';
      const to = typeof r?.to === 'string' ? r.to : '';
      const type = typeof r?.type === 'string' ? r.type : 'REL';
      const evidence_chunk_ids = Array.isArray(r?.evidence_chunk_ids)
        ? r.evidence_chunk_ids.map((c: any) => String(c)).filter((c: string) => chunkIdSet.has(c))
        : [];
      const confidence = typeof r?.confidence === 'number' ? r.confidence : 0.5;
      if (!from || !to || evidence_chunk_ids.length === 0) return null;
      if (!entityIdSet.has(from) || !entityIdSet.has(to)) return null;
      return { from, to, type: type.slice(0, 80), evidence_chunk_ids, confidence };
    })
    .filter(Boolean) as KgRelationship[];

  return { entities, relationships, meta };
}
