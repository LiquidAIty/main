import type { Edge, Node } from "@xyflow/react";
import type { ElkInput } from "./elk-layout";

export const NODE_WIDTH = 280;
export const NODE_HEIGHT = 120;

export function applyForceLayout(
  nodes: Node[],
  edges: Edge[],
  _nodeDimensions?: Map<string, { width: number; height: number }>,
  _communityMap?: Map<string, number>,
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
  const spacingX = 360;
  const spacingY = 220;
  const layoutedNodes = nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % columns) * spacingX,
      y: Math.floor(index / columns) * spacingY,
    },
  }));

  return { nodes: layoutedNodes, edges };
}

export function nodesToElkInput(
  nodes: Node[],
  edges: Edge[],
  dims: Map<string, { width: number; height: number }>,
  _layoutOptionsOverride?: Record<string, string>,
): ElkInput {
  return {
    id: "root",
    children: nodes.map((node, index) => ({
      id: node.id,
      width: dims.get(node.id)?.width ?? NODE_WIDTH,
      height: dims.get(node.id)?.height ?? NODE_HEIGHT,
      x: (index % 3) * 360,
      y: Math.floor(index / 3) * 220,
    })),
    edges: edges.map((edge, index) => ({
      id: edge.id ?? `e-${index}`,
      sources: [String(edge.source)],
      targets: [String(edge.target)],
    })),
  };
}

export function mergeElkPositions<T extends Node>(
  nodes: T[],
  positioned: ElkInput,
): T[] {
  const positions = new Map(
    (positioned.children ?? []).map((child) => [
      child.id,
      { x: child.x ?? 0, y: child.y ?? 0 },
    ]),
  );

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
  }));
}
