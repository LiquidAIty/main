/**
 * TaskContextSlice — the minimal, explicit, non-persistent task-scoped reference
 * envelope a future CoderPacket / task-ledger / approved workflow uses to point at a
 * bounded slice of each graph store.
 *
 * This deliberately REPLACES the earlier generic "Project Realm" idea. There is:
 *  - no cross-store record merge;
 *  - no persistent global bridge graph;
 *  - no automatic bridge discovery / inference;
 *  - no visual layout contract;
 *  - no selection from semantic similarity or text/ticker matching.
 *
 * A slice only carries EXPLICIT raw IDs (and an explicit {@link CodeGraphScope}).
 * Every reference preserves its graph kind and immutable raw ID, so the selection is
 * fully reversible to each store. KnowGraph refs may be empty — knowledge is included
 * only when the task explicitly selects it, never because a task mentions a ticker.
 */
import type { KnowledgeGraphKind } from '../../types/agentgraph';
import {
  validateCodeGraphScope,
  type CodeGraphScope,
} from '../codegraph/codeGraphScope';

/** A reference into exactly one store. Never merged across stores. */
export type GraphRawRef = {
  graphKind: KnowledgeGraphKind; // 'knowgraph' | 'thinkgraph' | 'codegraph'
  rawId: string; // immutable raw node/edge id within that store
};

export type TaskContextSliceSelectedBy = 'user' | 'task-ledger' | 'approved-workflow';

export type TaskContextSlice = {
  taskId: string;
  projectId: string;
  purpose: string;
  selectedBy: TaskContextSliceSelectedBy;
  /** Explicit bounded code context, when the task needs code. */
  codeGraphScope?: CodeGraphScope;
  /** Explicit ThinkGraph raw ids only (no inference). */
  thinkGraphRefs: GraphRawRef[];
  /** Explicit KnowGraph raw ids only — empty is valid and is the default. */
  knowGraphRefs: GraphRawRef[];
  /** Explicit task/workflow rationale for the selection. */
  selectionReason: string;
};

export type TaskContextSliceValidation = { ok: boolean; errors: string[] };

const SELECTED_BY: ReadonlySet<TaskContextSliceSelectedBy> = new Set([
  'user',
  'task-ledger',
  'approved-workflow',
]);

function validateRefs(
  refs: GraphRawRef[],
  expectedKind: KnowledgeGraphKind,
  bucket: string,
  errors: string[],
): void {
  if (!Array.isArray(refs)) {
    errors.push(`${bucket} must be an array of explicit refs`);
    return;
  }
  refs.forEach((ref, i) => {
    if (!ref || ref.graphKind !== expectedKind) {
      errors.push(`${bucket}[${i}] must have graphKind '${expectedKind}'`);
    }
    if (!ref || !String(ref.rawId || '').trim()) {
      errors.push(`${bucket}[${i}] requires an explicit non-empty rawId`);
    }
  });
}

/**
 * Validate a TaskContextSlice. Requires explicit identity + rationale, a known
 * `selectedBy`, well-typed ref buckets whose graph kind matches the bucket (no
 * cross-store mixing), and a valid CodeGraphScope when present. Empty knowGraphRefs is
 * valid. Returns collected errors so callers can fail closed.
 */
export function validateTaskContextSlice(
  slice: TaskContextSlice,
): TaskContextSliceValidation {
  const errors: string[] = [];
  if (!slice || typeof slice !== 'object') {
    return { ok: false, errors: ['slice missing'] };
  }
  for (const key of ['taskId', 'projectId', 'purpose', 'selectionReason'] as const) {
    if (!String(slice[key] || '').trim()) errors.push(`${key} required`);
  }
  if (!SELECTED_BY.has(slice.selectedBy)) {
    errors.push(`selectedBy must be one of ${[...SELECTED_BY].join('|')}`);
  }
  validateRefs(slice.thinkGraphRefs, 'thinkgraph', 'thinkGraphRefs', errors);
  validateRefs(slice.knowGraphRefs, 'knowgraph', 'knowGraphRefs', errors);
  if (slice.codeGraphScope !== undefined) {
    const scopeResult = validateCodeGraphScope(slice.codeGraphScope);
    if (!scopeResult.ok) {
      errors.push(...scopeResult.errors.map((e) => `codeGraphScope: ${e}`));
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Collect every raw reference a slice represents, preserving graph kind + raw id.
 * CodeGraph contributes its scope's represented raw CBM node ids as `codegraph` refs.
 * No merge, no dedup across stores beyond identity — purely reversible enumeration.
 */
export function collectRepresentedRawRefs(slice: TaskContextSlice): GraphRawRef[] {
  const refs: GraphRawRef[] = [];
  for (const ref of slice.thinkGraphRefs ?? []) refs.push(ref);
  for (const ref of slice.knowGraphRefs ?? []) refs.push(ref);
  const scope = slice.codeGraphScope;
  if (scope) {
    for (const rawId of scope.representedRawNodeIds ?? []) {
      refs.push({ graphKind: 'codegraph', rawId });
    }
  }
  return refs;
}
