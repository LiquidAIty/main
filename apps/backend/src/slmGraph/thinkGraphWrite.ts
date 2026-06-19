// Smallest adapter: a normalized SLM graph EXTRACTION -> one real ThinkGraph write
// record. Maps slmGraphWorker output to a ThinkGraph semantic record and writes it via
// the existing ThinkGraph store. Fails closed on invalid/empty extractions and never
// reports success when the underlying ThinkGraph write fails. The write fn is injectable
// so the mapping/fail-closed contract is unit-testable without a live AGE graph.
import {
  recordThinkGraphSemanticRecord,
  type ThinkGraphSemanticRecord,
} from '../services/thinkgraph/thinkgraphMemory';
import type { SlmGraphParse, SlmGraphExtraction } from './slmGraphWorker';

export type ThinkGraphWriteRecord = ThinkGraphSemanticRecord & { createdBy: 'slmGraphWorker' };

/** Map a normalized SLM graph extraction into a provenance-complete ThinkGraph write record. Pure. */
export function buildThinkGraphWriteRecord(
  extraction: SlmGraphExtraction,
  opts: { projectId: string; sourceRef?: string },
): ThinkGraphWriteRecord {
  const sourceRefs = [...(extraction.sourceRefs ?? [])];
  const extraRef = String(opts.sourceRef || '').trim();
  if (extraRef && !sourceRefs.some((s) => s.ref === extraRef)) {
    sourceRefs.push({ ref: extraRef, type: 'model_output' });
  }
  return {
    projectId: opts.projectId,
    sourceRef: String(opts.sourceRef || '').trim(),
    createdBy: 'slmGraphWorker',
    entities: extraction.entities ?? [],
    relations: extraction.relations ?? [],
    categories: extraction.categories ?? [],
    sourceRefs,
    confidence: typeof extraction.confidence === 'number' ? extraction.confidence : null,
    uncertainty: extraction.uncertainty ?? [],
    nextSearchSeedCandidates: extraction.nextSearchSeedCandidates ?? [],
  };
}

export type ThinkGraphWriteResult =
  | { ok: true; id: string; record: ThinkGraphWriteRecord }
  | { ok: false; error: string };

export type ThinkGraphWriteFn = (
  record: ThinkGraphWriteRecord,
) => Promise<{ id: string; ts: string }>;

const defaultWrite: ThinkGraphWriteFn = (record) => recordThinkGraphSemanticRecord(record);

/**
 * Write one normalized SLM graph extraction into ThinkGraph. Fails closed when the SLM
 * output was invalid (parse failed) or the extraction is empty (no entities/relations),
 * and surfaces the real write failure as ok:false — never a fabricated success.
 */
export async function writeSlmExtractionToThinkGraph(
  slmRun: SlmGraphParse,
  opts: { projectId: string; sourceRef?: string },
  deps: { write?: ThinkGraphWriteFn } = {},
): Promise<ThinkGraphWriteResult> {
  if (!slmRun.ok) {
    return { ok: false, error: 'invalid_slm_output' }; // fail closed: do not write
  }
  const record = buildThinkGraphWriteRecord(slmRun.result, opts);
  if (record.entities.length === 0 && record.relations.length === 0) {
    return { ok: false, error: 'empty_extraction' }; // nothing meaningful to write
  }
  const write = deps.write ?? defaultWrite;
  try {
    const res = await write(record);
    return { ok: true, id: res.id, record };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'thinkgraph_write_failed' };
  }
}
