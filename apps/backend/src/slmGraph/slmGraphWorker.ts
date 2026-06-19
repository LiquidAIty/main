// Minimal local-SLM graph task: one small text chunk -> one atomic OWL graph result.
// JSON only; invalid JSON fails closed. The model call is injectable so the parser is
// unit-testable without a live model. No subsystem, no gates, no decoration.
import { safeFetch } from '../security/safeFetch';

export type SlmTargetGraph = 'thinkgraph' | 'knowgraph';

export type SlmInputKind =
  | 'llm_chat_useful_part'
  | 'search_result_chunk'
  | 'local_document_chunk'
  | 'media_caption_chunk';

export type SlmGraphInput = {
  targetGraph: SlmTargetGraph;
  inputKind: SlmInputKind;
  sourceRef: string;
  text: string;
  ontologySlice: Record<string, unknown>;
  allowedClasses: string[];
  allowedRelations: string[];
  nearbyEntities: string[];
  nearbyRelations: string[];
};

export type SlmGraphEntity = { id: string; label: string; type: string };
export type SlmGraphRelation = { from: string; to: string; type: string };
export type SlmGraphAssertion = { subject: string; predicate: string; object: string };
export type SlmSourceRef = { ref: string; type: string };

export type SlmGraphResult = {
  entities: SlmGraphEntity[];
  relations: SlmGraphRelation[];
  categories: string[];
  assertions: SlmGraphAssertion[];
  sourceRefs: SlmSourceRef[];
  confidence: number;
  uncertainty: string[];
  nextSearchSeedCandidates: string[];
};

export type SlmGraphParse =
  | { ok: true; result: SlmGraphResult }
  | { ok: false; error: string };

/** Strict JSON-only prompt scoped to the provided ontology slice. */
export function buildSlmGraphPrompt(input: SlmGraphInput): { system: string; user: string } {
  const system = [
    'You are a local SLM graph worker. Do ONE atomic OWL graph extraction.',
    'Return JSON ONLY (no markdown, no prose). Use ONLY the allowed classes/relations.',
    'Put anything unsure into uncertainty; never invent classes/relations/values.',
    'Required JSON keys: entities, relations, categories, assertions, sourceRefs,',
    'confidence, uncertainty, nextSearchSeedCandidates.',
  ].join('\n');
  const user = [
    `targetGraph: ${input.targetGraph}`,
    `inputKind: ${input.inputKind}`,
    `sourceRef: ${input.sourceRef || '(none)'}`,
    `ontologySlice: ${JSON.stringify(input.ontologySlice || {})}`,
    `allowedClasses: ${JSON.stringify(input.allowedClasses || [])}`,
    `allowedRelations: ${JSON.stringify(input.allowedRelations || [])}`,
    `nearbyEntities: ${JSON.stringify(input.nearbyEntities || [])}`,
    `nearbyRelations: ${JSON.stringify(input.nearbyRelations || [])}`,
    '',
    'text:',
    String(input.text ?? ''),
  ].join('\n');
  return { system, user };
}

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Parse model output into a SlmGraphResult. Fails closed on invalid/malformed JSON. */
export function parseSlmGraphOutput(text: string): SlmGraphParse {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, error: 'non_json_output' };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'not_a_json_object' };
  }
  // Required arrays must be present and be arrays (fail closed on shape).
  for (const key of ['entities', 'relations']) {
    if (!Array.isArray(parsed[key])) return { ok: false, error: `missing_${key}` };
  }
  const result: SlmGraphResult = {
    entities: asArr<SlmGraphEntity>(parsed.entities),
    relations: asArr<SlmGraphRelation>(parsed.relations),
    categories: asArr<string>(parsed.categories).map(String),
    assertions: asArr<SlmGraphAssertion>(parsed.assertions),
    sourceRefs: asArr<SlmSourceRef>(parsed.sourceRefs),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
    uncertainty: asArr<string>(parsed.uncertainty).map(String),
    nextSearchSeedCandidates: asArr<string>(parsed.nextSearchSeedCandidates).map(String),
  };
  return { ok: true, result };
}

export type SlmCallFn = (args: { system: string; prompt: string }) => Promise<string>;

/** Minimal default model call to a local OpenAI-compatible endpoint (env-driven). */
const defaultCall: SlmCallFn = async ({ system, prompt }) => {
  const base = (process.env.LOCAL_LLM_BASE_URL || 'http://localhost:12434/engines/v1').replace(
    /\/+$/,
    '',
  );
  const model = process.env.LOCAL_GEMMA_MODEL || 'local-gemma-slm';
  const res = await safeFetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LOCAL_LLM_API_KEY || 'local'}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    timeoutMs: 60000,
    // Operator-configured local endpoint (loopback). Scoped to this call only.
    policy: 'OPEN',
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return String(json?.choices?.[0]?.message?.content ?? '');
};

export type SlmGraphRun = SlmGraphParse & { rawPreview: string };

/** Run one atomic SLM graph task. Fails closed (ok:false) on any model/parse failure. */
export async function runSlmGraphTask(
  input: SlmGraphInput,
  deps: { call?: SlmCallFn } = {},
): Promise<SlmGraphRun> {
  const call = deps.call ?? defaultCall;
  const { system, user } = buildSlmGraphPrompt(input);
  let text: string;
  try {
    text = await call({ system, prompt: user });
  } catch (err: any) {
    return { ok: false, error: err?.message || 'model_unreachable', rawPreview: '' };
  }
  const parsed = parseSlmGraphOutput(text);
  return { ...parsed, rawPreview: String(text || '').slice(0, 600) };
}
