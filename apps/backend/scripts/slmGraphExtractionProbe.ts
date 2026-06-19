// Diagnostic probe for the local Docker Gemma graph-extraction worker. Model-only
// (NO ThinkGraph write). Two modes:
//   SLM_PROBE_SCAN=1  -> GET /models + ping each candidate model id, print status table.
//   (default)         -> one full extraction request with noisy output.
// Plain OpenAI-compatible chat request (model/messages/temperature/max_tokens) — NO
// response_format (Docker Model Runner returns {"error":"unknown error"} on json_object).
//   $env:LOCAL_LLM_BASE_URL='http://localhost:12434/engines/v1'
//   $env:LOCAL_GEMMA_MODEL='docker.io/ai/gemma3-qat:latest'
//   npx tsx apps/backend/scripts/slmGraphExtractionProbe.ts
import { safeFetch } from '../src/security/safeFetch';
import { buildSlmGraphPrompt, parseSlmGraphExtraction } from '../src/slmGraph/slmGraphWorker';

const BASE = (process.env.LOCAL_LLM_BASE_URL || 'http://localhost:12434/engines/v1').replace(/\/+$/, '');
const ENDPOINT = `${BASE}/chat/completions`;
const API_KEY = process.env.LOCAL_LLM_API_KEY || 'local';

function authHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
}

async function listModels(): Promise<string[]> {
  try {
    const res = await safeFetch(`${BASE}/models`, { method: 'GET', headers: authHeaders(), timeoutMs: 20000, policy: 'OPEN' });
    const j: any = await res.json().catch(() => ({}));
    return Array.isArray(j?.data) ? j.data.map((m: any) => String(m?.id)).filter(Boolean) : [];
  } catch (e: any) {
    console.log('[probe] GET /models failed:', e?.message || e);
    return [];
  }
}

async function pingId(model: string): Promise<void> {
  const body = { model, messages: [{ role: 'user', content: 'ping' }], temperature: 0, max_tokens: 1 };
  try {
    const res = await safeFetch(ENDPOINT, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), timeoutMs: 60000, policy: 'OPEN' });
    const j: any = await res.json().catch(() => ({}));
    const hasCompletion = Boolean(j?.choices?.[0]?.message);
    const note = j?.error ? `error=${JSON.stringify(j.error)}` : hasCompletion ? 'completion' : 'no_completion';
    console.log(`[probe] id="${model}" -> httpStatus=${res.status} ok=${res.ok && hasCompletion} ${note}`);
  } catch (e: any) {
    console.log(`[probe] id="${model}" -> request_failed: ${e?.message || e}`);
  }
}

async function scan(): Promise<void> {
  console.log('[probe] === MODEL ID SCAN (model-only) ===');
  console.log('[probe] baseURL  =', BASE);
  console.log('[probe] endpoint =', ENDPOINT);
  const models = await listModels();
  console.log('[probe] GET /models ids =', JSON.stringify(models));
  const candidates = ['efe9562a810', 'docker.io/gemma3-qat:latest', 'docker.io/ai/gemma3-qat:latest', ...models];
  const seen = new Set<string>();
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    await pingId(id);
  }
}

async function fullExtraction(): Promise<void> {
  const model = process.env.LOCAL_GEMMA_MODEL || 'docker.io/ai/gemma3-qat:latest';
  const text = 'User wants to add Local Gemma as an SLM graph worker for OWL extraction.';
  const { system, user } = buildSlmGraphPrompt({
    targetGraph: 'thinkgraph',
    inputKind: 'llm_chat_useful_part',
    sourceRef: 'docker-live-gemma-proof',
    text,
    ontologySlice: {},
    allowedClasses: ['Model', 'Task', 'Capability'],
    allowedRelations: ['performs', 'uses', 'related_to'],
    nearbyEntities: [],
    nearbyRelations: [],
  });
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
    max_tokens: 512,
  };

  console.log('[probe] === MODEL-ONLY EXTRACTION (NO ThinkGraph write) ===');
  console.log('[probe] baseURL          =', BASE);
  console.log('[probe] endpoint         =', ENDPOINT);
  console.log('[probe] modelId          =', model);
  console.log('[probe] requestTimestamp =', new Date().toISOString());
  // Exact payload minus secrets (the API key lives in the Authorization header, not the
  // body; message content truncated only for readability).
  console.log(
    '[probe] requestPayload   =\n',
    JSON.stringify(
      { ...body, messages: body.messages.map((m) => ({ role: m.role, content: m.content.slice(0, 220) + (m.content.length > 220 ? '…' : '') })) },
      null,
      2,
    ),
  );

  const res = await safeFetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    timeoutMs: 120000,
    policy: 'OPEN', // operator-configured local loopback endpoint, scoped to this call
  });
  const raw: any = await res.json().catch(() => ({}));
  console.log('[probe] httpStatus       =', res.status);

  if (!res.ok || raw?.error) {
    console.log('[probe] FAILURE rawBody  =\n', JSON.stringify(raw, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log('[probe] rawModelResponse =\n', JSON.stringify(raw, null, 2));
  const content = String(raw?.choices?.[0]?.message?.content ?? '');
  console.log('[probe] normalizedExtraction =\n', JSON.stringify(parseSlmGraphExtraction(content), null, 2));
}

async function main() {
  if (process.env.SLM_PROBE_SCAN === '1') return scan();
  return fullExtraction();
}

main().catch((e) => {
  console.error('[probe] failed:', e?.message || e);
  process.exit(1);
});
