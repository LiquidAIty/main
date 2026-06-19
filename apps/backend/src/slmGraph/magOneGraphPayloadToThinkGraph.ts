// Smallest acceptance adapter: an ACCEPTED Mag One / Task Ledger output that carries an
// OWL-shaped `graphPayload` -> the existing SLM graph extraction normalization
// (`parseSlmGraphExtraction`) -> the existing ThinkGraph write path
// (`writeSlmExtractionToThinkGraph` -> recordThinkGraphSemanticRecord into `thinkgraph_liq`).
//
// This never writes the raw Mag One graphPayload directly: it always normalizes first and
// fails closed with an honest reason. It writes ONLY when the caller marks the output
// accepted, so proposed/rejected/unaccepted Mag One responses are never persisted. No second
// ThinkGraph store, no new graph label — it reuses the proven write path.
import {
  writeSlmExtractionToThinkGraph,
  type ThinkGraphWriteFn,
  type ThinkGraphWriteRecord,
} from './thinkGraphWrite';
import { parseSlmGraphExtraction, type SlmGraphExtraction } from './slmGraphWorker';

/** Mag One / Task Ledger output envelope carrying the OWL-shaped graphPayload. */
export type MagOneGraphPayloadEnvelope = {
  /** The OWL-shaped payload the model emitted (OwlShapedGraphPayload shape). */
  graphPayload?: unknown;
  /** Explicit acceptance boundary — only `true` is written. */
  accepted?: boolean;
  /** Optional sourceRef override; otherwise taken from the payload. */
  sourceRef?: string;
  /** Task-linked context, preserved for callers (the graph already encodes task entities). */
  planFlowTaskObjects?: unknown;
};

export type AcceptedGraphPayloadError =
  | 'not_accepted'
  | 'missing_graph_payload'
  | 'invalid_graph_payload'
  | 'empty_graph_payload';

export type AcceptedGraphPayloadNormalizeResult =
  | { ok: true; extraction: SlmGraphExtraction; sourceRef: string }
  | { ok: false; error: AcceptedGraphPayloadError };

/**
 * Pure acceptance + normalization boundary (no DB). Enforces the acceptance flag, then runs
 * the graphPayload through the existing SLM normalization. Honest fail-closed reasons:
 * - not_accepted       — caller did not mark the output accepted
 * - missing_graph_payload — no graphPayload present
 * - invalid_graph_payload — graphPayload is not an object, or normalization failed/yielded no meaning
 * - empty_graph_payload   — normalized to zero entities and zero relations (no-op, never a fake write)
 */
export function normalizeAcceptedMagOneGraphPayload(
  input: MagOneGraphPayloadEnvelope,
): AcceptedGraphPayloadNormalizeResult {
  if (!input || input.accepted !== true) {
    return { ok: false, error: 'not_accepted' };
  }
  const gp = input.graphPayload;
  if (gp === undefined || gp === null) {
    return { ok: false, error: 'missing_graph_payload' };
  }
  if (typeof gp !== 'object' || Array.isArray(gp)) {
    return { ok: false, error: 'invalid_graph_payload' };
  }
  const parse = parseSlmGraphExtraction(JSON.stringify(gp));
  if (!parse.ok) {
    return { ok: false, error: 'invalid_graph_payload' };
  }
  const extraction = parse.result;
  if (extraction.entities.length === 0 && extraction.relations.length === 0) {
    return { ok: false, error: 'empty_graph_payload' }; // no-op, not success
  }
  const sourceRef =
    String(input.sourceRef || '').trim() ||
    String((gp as { sourceRef?: unknown }).sourceRef || '').trim() ||
    String(extraction.sourceRefs[0]?.ref || '').trim();
  return { ok: true, extraction, sourceRef };
}

export type AcceptedGraphPayloadWriteResult =
  | { ok: true; id: string; sourceRef: string; record: ThinkGraphWriteRecord }
  | { ok: false; error: string };

/**
 * Write an ACCEPTED Mag One graphPayload into ThinkGraph via the existing write path.
 * Returns the honest fail reason (not_accepted / missing / invalid / empty_graph_payload)
 * before any write, and surfaces a real ThinkGraph write failure as ok:false — never a
 * fabricated success. The write fn is injectable so the contract is unit-testable without
 * a live AGE graph.
 */
export async function writeAcceptedMagOneGraphPayloadToThinkGraph(
  input: MagOneGraphPayloadEnvelope,
  opts: { projectId: string },
  deps: { write?: ThinkGraphWriteFn } = {},
): Promise<AcceptedGraphPayloadWriteResult> {
  const norm = normalizeAcceptedMagOneGraphPayload(input);
  if (!norm.ok) {
    return { ok: false, error: norm.error };
  }
  const writeRes = await writeSlmExtractionToThinkGraph(
    { ok: true, result: norm.extraction },
    { projectId: opts.projectId, sourceRef: norm.sourceRef },
    deps,
  );
  if (!writeRes.ok) {
    return { ok: false, error: writeRes.error };
  }
  return { ok: true, id: writeRes.id, sourceRef: norm.sourceRef, record: writeRes.record };
}
