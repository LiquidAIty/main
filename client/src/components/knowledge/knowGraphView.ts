// Pure helpers for the EXISTING KnowGraph tab's data path. Classify the KnowGraph read
// result (Neo4j semantic-graph route) into an honest source/reason, and resolve the honest
// diagnostics-pill label — no more blanket "host-provided" lie. Extracted so the logic is
// unit-testable without mounting the (react-three) graph scene. The KnowGraph READ (Neo4j)
// is independent of the ingest-service health (:8001) — an ingest outage must not hide a
// working read.

export type KnowGraphSourceState = {
  ok: boolean;
  /** 'knowgraph-neo4j' (semantic read), 'knowgraph-route' (legacy DTO), or 'unavailable'. */
  source: string;
  reason?: string;
  blocker?: string;
};

/**
 * Classify a KnowGraph semantic-graph read result. Distinguishes real data, honest
 * no-records, Neo4j auth failure, and Neo4j unavailable — never collapses a failure into a
 * silent empty "success". Pure + deterministic.
 */
export function classifyKnowGraphSemanticResult(input: {
  status?: string; // 'ok' | 'unavailable' | 'error'
  warnings?: string[];
  nodeCount: number;
  relCount: number;
  legacy?: boolean; // came via the legacy /api/knowgraph/graph DTO path
}): KnowGraphSourceState {
  const status = String(input.status || '').toLowerCase();
  const warning = String((input.warnings && input.warnings[0]) || '').toLowerCase();
  const hasData = input.nodeCount > 0 || input.relCount > 0;
  const source = input.legacy ? 'knowgraph-route' : 'knowgraph-neo4j';

  if (hasData) return { ok: true, source };

  if (status === 'unavailable' || status === 'error') {
    if (/no .*record|no semantic records|not found|empty/.test(warning)) {
      return { ok: true, source, reason: 'no_knowgraph_records_for_project' };
    }
    if (/auth|unauthor|credential|password|forbidden/.test(warning)) {
      return { ok: false, source: 'unavailable', reason: 'neo4j_auth_failed', blocker: input.warnings?.[0] };
    }
    if (warning) {
      return { ok: false, source: 'unavailable', reason: 'neo4j_unavailable', blocker: input.warnings?.[0] };
    }
    return { ok: false, source: 'unavailable', reason: 'neo4j_unavailable' };
  }

  // status ok (or unknown) but no rows -> honest no-records.
  return { ok: true, source, reason: 'no_knowgraph_records_for_project' };
}

/** Classify a thrown KnowGraph route error (fetch/HTTP failure). */
export function classifyKnowGraphRouteError(message: string): KnowGraphSourceState {
  const m = String(message || '').toLowerCase();
  if (/auth|unauthor|credential|password|forbidden|401|403/.test(m)) {
    return { ok: false, source: 'unavailable', reason: 'neo4j_auth_failed', blocker: message };
  }
  return { ok: false, source: 'unavailable', reason: 'route_error', blocker: message };
}

/**
 * Resolve the honest KnowGraph diagnostics-pill label. Never reports "host-provided" when a
 * backend read was attempted or failed. Falls back to 'host-provided' only when nothing has
 * been read yet AND there is legacy host-provided data.
 */
export function resolveKnowGraphSourceLabel(
  sourceState: KnowGraphSourceState | null,
  _ingestHealthOk: boolean | null,
  hasNodes: boolean,
): string {
  // Returns a SHORT token only ('knowgraph-neo4j' | 'knowgraph-route' | 'host-provided' |
  // 'unavailable'). The detailed reason (no-records / neo4j_auth_failed / ingest health) stays
  // in `sourceState` (network/console/CoderReport) and is NEVER painted on the graph canvas.
  // A failed Neo4j READ is 'unavailable'; a working read with no rows is 'knowgraph-neo4j'
  // (the empty state is conveyed by nodes=0 / status=empty, not a long reason string).
  if (sourceState) {
    if (!sourceState.ok) return 'unavailable';
    return sourceState.source || 'knowgraph-neo4j';
  }
  // Nothing read yet. Ingest-health failure alone is NOT a graph read failure, so do not
  // report 'unavailable' on its account — the read still runs and reports honestly.
  return hasNodes ? 'host-provided' : 'knowgraph-neo4j';
}
