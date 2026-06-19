// Pure projection: stored accepted ThinkGraph :SlmGraphRecord records (read back via
// readRecentThinkGraphSemanticRecords) -> graph-view nodes/edges for the Agent Builder
// ThinkGraph tab. No DB, no LLM, no writes — display projection only. This is what
// un-islands accepted Mag One graphPayloads: they were written as :SlmGraphRecord in
// thinkgraph_liq but the graph tab queried :Entity, so they never showed.
import type {
  StoredThinkGraphSemanticRecord,
  ThinkGraphSemanticListResult,
} from '../services/thinkgraph/thinkgraphMemory';

export type ThinkGraphViewNode = {
  id: string;
  label: string;
  type?: string;
  sourceRef?: string;
  confidence?: number;
};

export type ThinkGraphViewEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type?: string;
  sourceRef?: string;
  confidence?: number;
};

export type ThinkGraphView = {
  nodes: ThinkGraphViewNode[];
  edges: ThinkGraphViewEdge[];
};

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Project accepted ThinkGraph records into canvas nodes/edges. Entities become nodes (last
 * write wins on id collisions across records), relations become edges. Each node/edge carries
 * the originating record's sourceRef so the tab stays traceable to graph memory. Pure +
 * deterministic. Returns honest empty when there are no records.
 */
export function projectThinkGraphRecordsToGraphView(
  records: StoredThinkGraphSemanticRecord[],
): ThinkGraphView {
  const nodeById = new Map<string, ThinkGraphViewNode>();
  const edges: ThinkGraphViewEdge[] = [];

  for (const record of Array.isArray(records) ? records : []) {
    const recordRef = String(record?.sourceRef || '').trim() || undefined;
    const recordConfidence = num(record?.confidence);

    for (const entity of Array.isArray(record?.entities) ? record.entities : []) {
      const id = String((entity as any)?.id || (entity as any)?.label || '').trim();
      const label = String((entity as any)?.label || (entity as any)?.id || '').trim();
      if (!id || !label) continue;
      nodeById.set(id, {
        id,
        label,
        type: String((entity as any)?.type || 'entity').trim() || 'entity',
        sourceRef: recordRef,
        confidence: num((entity as any)?.confidence) ?? recordConfidence,
      });
    }

    const relations = Array.isArray(record?.relations) ? record.relations : [];
    relations.forEach((relation, index) => {
      const source = String((relation as any)?.from || '').trim();
      const target = String((relation as any)?.to || '').trim();
      const type = String((relation as any)?.type || '').trim();
      if (!source || !target || !type) return;
      edges.push({
        id: `${recordRef || 'tg'}:${source}->${target}:${type}:${index}`,
        source,
        target,
        label: type,
        type,
        sourceRef: recordRef,
        confidence: num((relation as any)?.confidence) ?? recordConfidence,
      });
    });
  }

  return { nodes: Array.from(nodeById.values()), edges };
}

export type ThinkGraphGraphViewResponse = {
  ok: boolean;
  source: 'thinkgraph-db' | 'unavailable';
  projectId: string;
  nodes: ThinkGraphViewNode[];
  edges: ThinkGraphViewEdge[];
  counts: { nodes: number; edges: number; records: number };
  reason?: string;
  blocker?: string;
};

/**
 * Build the honest graph-view response for the ThinkGraph tab from a reader result. Pure —
 * never throws. Distinguishes real data, honest-empty (no_thinkgraph_records_for_project),
 * and honest-unavailable (thinkgraph_unavailable + exact blocker). A DB failure is NEVER
 * collapsed into an empty graph.
 */
export function buildThinkGraphGraphViewResponse(
  projectId: string,
  result: ThinkGraphSemanticListResult,
): ThinkGraphGraphViewResponse {
  const pid = String(projectId || '').trim();
  if (!result.ok) {
    return {
      ok: false,
      source: 'unavailable',
      projectId: pid,
      nodes: [],
      edges: [],
      counts: { nodes: 0, edges: 0, records: 0 },
      reason: 'thinkgraph_unavailable',
      blocker: result.error,
    };
  }
  const view = projectThinkGraphRecordsToGraphView(result.records);
  const isEmpty = view.nodes.length === 0 && view.edges.length === 0;
  return {
    ok: true,
    source: 'thinkgraph-db',
    projectId: pid,
    nodes: view.nodes,
    edges: view.edges,
    counts: { nodes: view.nodes.length, edges: view.edges.length, records: result.records.length },
    reason: isEmpty ? 'no_thinkgraph_records_for_project' : undefined,
  };
}
