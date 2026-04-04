export const GRAPH_WORKSPACE = {
  minZoom: 0.22,
  maxZoom: 1.6,
  fitMaxZoom: 1.35,
  focusMaxZoom: 1.15,
  fitPadding: 0.2,
  fitDurationMs: 220,
  focusDurationMs: 260,
  zoomStep: 1.18,
  zoomDurationMs: 140,
  wheelDelta: 0.0016,
  worldGridGap: 24,
  worldGridMajorGapMultiplier: 4,
  worldGridLineWidth: 1,
  worldOverscan: 12000,
} as const;

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

export function normalizeGraphZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0.5;
  return clamp(
    (zoom - GRAPH_WORKSPACE.minZoom) / (GRAPH_WORKSPACE.focusMaxZoom - GRAPH_WORKSPACE.minZoom),
    0,
    1,
  );
}

export function getGraphMajorGridGap(): number {
  return GRAPH_WORKSPACE.worldGridGap * GRAPH_WORKSPACE.worldGridMajorGapMultiplier;
}

export function resolveKnowledgeSubstrateRhythm(zoom: number): {
  minorOpacity: number;
  majorOpacity: number;
  minorLineWidth: number;
  majorLineWidth: number;
} {
  const depth = normalizeGraphZoom(zoom);
  return {
    minorOpacity: 0.012 + depth * 0.118,
    majorOpacity: 0.092 + depth * 0.088,
    minorLineWidth: GRAPH_WORKSPACE.worldGridLineWidth * (0.94 - depth * 0.12),
    majorLineWidth: GRAPH_WORKSPACE.worldGridLineWidth * (1.1 - depth * 0.08),
  };
}

export function buildUndirectedNeighborMap(
  nodeIds: string[],
  connections: Array<{ source: string; target: string }>,
): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  nodeIds.forEach((nodeId) => neighbors.set(nodeId, new Set<string>()));

  connections.forEach(({ source, target }) => {
    if (!neighbors.has(source) || !neighbors.has(target)) return;
    neighbors.get(source)?.add(target);
    neighbors.get(target)?.add(source);
  });

  return neighbors;
}

export function buildFocusedNodeSet(
  focusId: string | null,
  neighborsByNode: Map<string, Set<string>>,
): Set<string> {
  const focused = new Set<string>();
  if (!focusId) return focused;
  focused.add(focusId);
  (neighborsByNode.get(focusId) || new Set<string>()).forEach((nodeId) => focused.add(nodeId));
  return focused;
}

export function isEdgeConnectedToNode(
  source: string,
  target: string,
  nodeId: string | null,
): boolean {
  if (!nodeId) return false;
  return source === nodeId || target === nodeId;
}
