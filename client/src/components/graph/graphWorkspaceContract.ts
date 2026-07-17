const GRAPH_PAPER_MINOR_STEP = 24;
const GRAPH_PAPER_MAJOR_STEP = GRAPH_PAPER_MINOR_STEP * 4;
const GRAPH_PAPER_LINE_WIDTH = 1;
const GRAPH_PAPER_BASELINE_SCREEN_MINOR_STEP = GRAPH_PAPER_MINOR_STEP;
const GRAPH_BASELINE_WORLD_ZOOM =
  GRAPH_PAPER_BASELINE_SCREEN_MINOR_STEP / GRAPH_PAPER_MINOR_STEP;

export const GRAPH_PAPER = {
  minorStep: GRAPH_PAPER_MINOR_STEP,
  majorStep: GRAPH_PAPER_MAJOR_STEP,
  lineWidth: GRAPH_PAPER_LINE_WIDTH,
  baseColor: "#A7B0BA",
  minorOpacity: 0.14,
  majorOpacity: 0.22,
  restingBrightness: 0.98,
  vignetteOpacity: 0.16,
  worldScale: 1,
  // 3D renderer adapters must still match 2D resting appearance to this shared contract.
  worldDepth: -220,
  worldExtent: 6400,
} as const;

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
  worldGridGap: GRAPH_PAPER.minorStep,
  worldGridMajorGapMultiplier: GRAPH_PAPER.majorStep / GRAPH_PAPER.minorStep,
  worldGridLineWidth: GRAPH_PAPER.lineWidth,
  worldOverscan: 12000,
  landingBaselineZoom: GRAPH_BASELINE_WORLD_ZOOM,
  landingBaselineMinZoom: GRAPH_BASELINE_WORLD_ZOOM - 0.02,
  landingBaselineMaxZoom: GRAPH_BASELINE_WORLD_ZOOM + 0.02,
  landingPrimaryBandWidth: GRAPH_PAPER.majorStep * 7,
  landingPrimaryBandHalfHeight: GRAPH_PAPER.majorStep,
} as const;

export const GRAPH_TEXT = {
  titlePx: 14.5,
  bodyPx: 12,
} as const;

export function getGraphMajorGridGap(): number {
  return GRAPH_WORKSPACE.worldGridGap * GRAPH_WORKSPACE.worldGridMajorGapMultiplier;
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
