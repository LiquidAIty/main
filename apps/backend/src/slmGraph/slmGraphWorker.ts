// SLM graph prompt + parse primitives: one small text chunk -> one atomic OWL graph result.
// JSON only; invalid JSON fails closed. Pure prompt-build + parse — no model call, no DB, no
// writes. The live consumers are the graph-seeded search fragments (graphToSearchParams,
// graphSeededSearchConvergence) that reuse the extraction shape.

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

// Canonical shapes. Per-item confidence/uncertainty are optional numeric scores the
// live model often nests inside each entity/relation.
export type SlmGraphEntity = {
  id: string;
  label: string;
  type: string;
  confidence?: number | null;
  uncertainty?: number | null;
};
export type SlmGraphRelation = {
  from: string;
  to: string;
  type: string;
  confidence?: number | null;
  uncertainty?: number | null;
};
export type SlmGraphAssertion = { subject: string; predicate: string; object: string };
export type SlmSourceRef = { ref: string; type?: string };

export type SlmGraphExtraction = {
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
  | { ok: true; result: SlmGraphExtraction }
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

function numOrNull(v: unknown): number | null {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function slugId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'entity'
  );
}

// --- Live-variant normalization (small models drift on key names) ---------------
// name -> label, class -> type, source -> from, target -> to, relation -> type,
// string sourceRef -> { ref }, numeric/string/missing uncertainty -> canonical.
// Items missing required meaning are DROPPED so no undefined canonical field can
// reach a downstream write.

function normalizeEntity(raw: any): SlmGraphEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const label = String(raw.label ?? raw.name ?? '').trim();
  if (!label) return null; // required meaning missing -> drop
  const type = String(raw.type ?? raw.class ?? 'entity').trim() || 'entity';
  const id = String(raw.id ?? '').trim() || slugId(label);
  return { id, label, type, confidence: numOrNull(raw.confidence), uncertainty: numOrNull(raw.uncertainty) };
}

function normalizeRelation(raw: any): SlmGraphRelation | null {
  if (!raw || typeof raw !== 'object') return null;
  const from = String(raw.from ?? raw.source ?? '').trim();
  const to = String(raw.to ?? raw.target ?? '').trim();
  const type = String(raw.type ?? raw.relation ?? '').trim();
  if (!from || !to || !type) return null; // required meaning missing -> drop
  return { from, to, type, confidence: numOrNull(raw.confidence), uncertainty: numOrNull(raw.uncertainty) };
}

function normalizeSourceRef(raw: any): SlmSourceRef | null {
  if (typeof raw === 'string') {
    const ref = raw.trim();
    return ref ? { ref } : null;
  }
  if (raw && typeof raw === 'object') {
    const ref = String(raw.ref ?? '').trim();
    if (!ref) return null;
    const type = String(raw.type ?? '').trim();
    return type ? { ref, type } : { ref };
  }
  return null;
}

/** Top-level uncertainty notes. number -> ["0.15"]; string -> [string]; missing -> []. */
function normalizeUncertaintyNotes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((u) => String(u)).filter((u) => u.trim().length > 0);
  if (typeof raw === 'number' && Number.isFinite(raw)) return [String(raw)];
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t ? [t] : [];
  }
  return [];
}

/**
 * Parse model output into a canonical SlmGraphExtraction. Fails closed on invalid/
 * malformed JSON. Normalizes live key-name variants and DROPS items missing required
 * meaning. If the model sent entity/relation content but normalization leaves nothing
 * usable, fails closed (`no_meaningful_graph`) rather than reporting a hollow ok:true.
 */
export function parseSlmGraphExtraction(text: string): SlmGraphParse {
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

  const hadInputContent = asArr(parsed.entities).length + asArr(parsed.relations).length > 0;
  const entities = asArr<any>(parsed.entities)
    .map(normalizeEntity)
    .filter((e): e is SlmGraphEntity => e !== null);
  const relations = asArr<any>(parsed.relations)
    .map(normalizeRelation)
    .filter((r): r is SlmGraphRelation => r !== null);
  // The model sent content but none of it normalized to a usable entity/relation.
  if (hadInputContent && entities.length === 0 && relations.length === 0) {
    return { ok: false, error: 'no_meaningful_graph' };
  }

  const sourceRefs = asArr<any>(parsed.sourceRefs)
    .map(normalizeSourceRef)
    .filter((s): s is SlmSourceRef => s !== null);

  const result: SlmGraphExtraction = {
    entities,
    relations,
    categories: asArr<unknown>(parsed.categories)
      .map((c) => String(c))
      .filter((c) => c.trim().length > 0),
    assertions: asArr<SlmGraphAssertion>(parsed.assertions),
    sourceRefs,
    confidence: numOrNull(parsed.confidence) ?? 0,
    uncertainty: normalizeUncertaintyNotes(parsed.uncertainty),
    nextSearchSeedCandidates: asArr<unknown>(parsed.nextSearchSeedCandidates).map((c) => String(c)),
  };
  return { ok: true, result };
}

