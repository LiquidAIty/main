// Pure helpers for the EXISTING KnowGraph tab's data path. Classify the KnowGraph read
// result (Neo4j semantic-graph route) into an honest source/reason, resolve the honest
// diagnostics-pill label (no more blanket "host-provided" lie), adapt the live semantic
// read into the legacy graph shape the tab renders, and decide live-vs-cache precedence.
// Extracted so the logic is unit-testable without mounting the (react-three) graph scene.
// The KnowGraph READ (Neo4j) is independent of the ingest-service health (:8001) — an
// ingest outage must not hide a working read.

import type { GraphReadResult } from '../../types/agentgraph';

function safeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return String(value);
  } catch {
    return '';
  }
}

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

/**
 * Adapt a LIVE semantic-graph read result ({records, relationships, sourceRefs, warnings,
 * status}) into the legacy {nodes, relationships} shape the existing KnowGraph tab renders.
 * Preserves each record's owlClass/kind as the node `type` (so live EDGAR contexts such as
 * BusinessContext / RiskContext / ManagementDiscussionContext reach the normalization path
 * unchanged). Pure + deterministic; behavior identical to the prior in-page implementation.
 */
export function semanticReadResultToLegacyKnowGraph(result: GraphReadResult): {
  nodes: any[];
  relationships: any[];
  warnings: string[];
  status: string;
} {
  const records = Array.isArray(result?.records) ? result.records : [];
  const relationships = Array.isArray(result?.relationships) ? result.relationships : [];
  const nodeMap = new Map<string, any>();
  const rels: any[] = [];

  records.forEach((record: any) => {
    const id = safeText(record?.id || record?.['@id']).trim();
    if (!id) return;
    const props =
      record?.properties && typeof record.properties === 'object'
        ? (record.properties as Record<string, unknown>)
        : {};
    nodeMap.set(id, {
      id,
      label: safeText(record?.label || id),
      type: safeText(record?.kind || record?.owlClass || record?.['@type'] || 'entity'),
      properties: {
        ...props,
        summary: record?.summary ?? null,
        graph: record?.graph ?? null,
        kind: record?.kind ?? null,
        owlClass: record?.owlClass ?? null,
        atType: record?.['@type'] ?? null,
        sourceRefs: record?.sourceRefs ?? [],
        provenance: record?.provenance ?? null,
        vectorText: record?.vectorText ?? null,
        datatypeProperties: record?.datatypeProperties ?? [],
        objectProperties: record?.objectProperties ?? [],
        confidence: record?.confidence ?? null,
      },
    });
    const relList = Array.isArray(record?.relationships) ? record.relationships : [];
    relList.forEach((rel: any) => {
      if (!rel?.from || !rel?.to) return;
      rels.push({
        id: safeText(rel.id || `${rel.from}->${rel.to}:${rel.type || 'related_to'}`),
        from: safeText(rel.from),
        to: safeText(rel.to),
        type: safeText(rel.type || 'related_to'),
        properties: {
          ...(rel.properties && typeof rel.properties === 'object' ? rel.properties : {}),
          confidence: rel.confidence ?? null,
          sourceRefs: record?.sourceRefs ?? [],
        },
      });
    });
  });

  relationships.forEach((rel: any) => {
    if (!rel?.from || !rel?.to) return;
    rels.push({
      id: safeText(rel.id || `${rel.from}->${rel.to}:${rel.type || 'related_to'}`),
      from: safeText(rel.from),
      to: safeText(rel.to),
      type: safeText(rel.type || 'related_to'),
      properties: {
        ...(rel.properties && typeof rel.properties === 'object' ? rel.properties : {}),
        confidence: rel.confidence ?? null,
      },
    });
  });

  return {
    nodes: Array.from(nodeMap.values()),
    relationships: rels,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    status: safeText((result as any)?.status || 'ok').toLowerCase(),
  };
}

export type KnowGraphLivePrecedenceInput = {
  /** The live semantic-graph read produced an AUTHORITATIVE answer for the active project —
   *  i.e. the backend responded definitively: real data OR an honest "no records". This is
   *  the classifier's `ok` flag; it is FALSE only on a genuine read failure (neo4j
   *  unavailable / auth / route error). */
  liveAuthoritative: boolean;
  liveNodeCount: number;
  liveRelCount: number;
  /** Honest internal reason when the live read was NOT authoritative (kept off-canvas). */
  liveReason?: string;
  /** The project-scoped cached graph has displayable nodes/edges. */
  cacheHasData: boolean;
};

export type KnowGraphLivePrecedenceOutcome = {
  /** Which source the existing KnowGraph tab should display as authoritative. */
  display: 'live' | 'cache';
  /** Honest status line — never claims "cached" after a successful live read. */
  status: string;
  /** Internal reason kept off the graph canvas (network/console/report only). */
  reason?: string;
};

/**
 * Decide KnowGraph display precedence AFTER a live semantic-graph read attempt for the
 * active project. SPEC rule: a successful live response is AUTHORITATIVE and wins over
 * cached data; cached graph data may stand in ONLY when the live read actually failed. An
 * authoritative empty (honest "no records for this project") is still live — never fall
 * back to a stale other-content cache for a project that genuinely has no records.
 *
 * The caller derives `cacheHasData` from the PROJECT-SCOPED cache key, so a "cache" display
 * can never silently substitute another project's graph.
 */
export function resolveKnowGraphLivePrecedence(
  input: KnowGraphLivePrecedenceInput,
): KnowGraphLivePrecedenceOutcome {
  if (input.liveAuthoritative) {
    const hasData = input.liveNodeCount > 0 || input.liveRelCount > 0;
    return hasData
      ? { display: 'live', status: 'Knowledge graph refresh succeeded.' }
      : {
          display: 'live',
          status: 'Live knowledge graph has no records for this project yet.',
          reason: 'no_knowgraph_records_for_project',
        };
  }
  if (input.cacheHasData) {
    return {
      display: 'cache',
      status: 'Live knowledge graph unavailable; showing cached graph.',
      reason: input.liveReason || 'live_unavailable',
    };
  }
  return {
    display: 'live',
    status: 'Knowledge graph refresh failed.',
    reason: input.liveReason || 'live_unavailable',
  };
}
