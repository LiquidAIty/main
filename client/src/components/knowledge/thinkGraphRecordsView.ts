// Pure helpers for the ThinkGraph tab's accepted-record read path. Map the
// /api/thinkgraph/graph-view response into GraphViewData, and resolve an HONEST source label
// for the diagnostics pill. Extracted so the logic is unit-testable without mounting the
// (react-three) graph scene. No network here — the caller fetches.
import type { GraphViewData } from '../../types/agentgraph';

export type ThinkGraphRecordsView = {
  ok: boolean;
  source: string;
  nodes: Array<{ id: string; label: string; type?: string; sourceRef?: string; confidence?: number }>;
  edges: Array<{ id: string; source: string; target: string; label?: string; type?: string; sourceRef?: string; confidence?: number }>;
  reason?: string;
  blocker?: string;
} | null;

function safeText(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Map accepted :SlmGraphRecord graph-view nodes/edges into GraphViewData. Returns null when
 * there are no accepted records, so the caller can fall back to the legacy view instead of
 * showing an empty graph.
 */
export function mapAcceptedThinkGraphRecordsToViewData(
  view: ThinkGraphRecordsView,
): GraphViewData | null {
  const nodes = view?.nodes ?? [];
  const edges = view?.edges ?? [];
  if (nodes.length === 0) return null;
  return {
    kind: 'thinkgraph',
    nodes: nodes.map((node) => ({
      id: String(node.id),
      label: safeText(node.label || node.id),
      type: safeText(node.type || 'entity'),
      confidence: typeof node.confidence === 'number' ? node.confidence : undefined,
    })),
    edges: edges.map((edge, index) => ({
      id: safeText(edge.id) || `think:${index}:${safeText(edge.source)}:${safeText(edge.target)}`,
      source: String(edge.source),
      target: String(edge.target),
      type: safeText(edge.type || edge.label || 'related_to'),
    })),
  };
}

/**
 * Resolve the honest data-source label for the ThinkGraph diagnostics pill — no more blanket
 * "host-provided" lie. Distinguishes real DB data, honest-empty (no records), the legacy
 * host-provided fallback, and DB-unavailable (with its blocker).
 */
export function resolveThinkGraphSourceLabel(
  view: ThinkGraphRecordsView,
  hostHasNodes: boolean,
): string {
  // Returns a SHORT token only ('thinkgraph-db' | 'host-provided' | 'unavailable'); the
  // detailed reason/blocker stays in `view` (network/console), never on the graph canvas.
  if (view) {
    if (!view.ok) return 'unavailable';
    if (view.nodes.length > 0) return 'thinkgraph-db';
    if (hostHasNodes) return 'host-provided';
    return 'thinkgraph-db';
  }
  return hostHasNodes ? 'host-provided' : 'thinkgraph-db';
}
