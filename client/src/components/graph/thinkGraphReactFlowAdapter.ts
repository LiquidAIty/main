import type { Edge, Node } from "@xyflow/react";

import type { GraphViewData } from "../../types/agentgraph";

export type ThinkGraphEntity = {
  id: string;
  label: string;
  type: string;
  summary?: string;
  confidence?: number;
  semanticMetadata?: Record<string, unknown>;
};

export type ThinkGraphRelationship = {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  weight?: number;
  confidence?: number;
  semanticMetadata?: Record<string, unknown>;
};

export type ThinkGraphProjectionInput = {
  entities: ThinkGraphEntity[];
  relationships: ThinkGraphRelationship[];
};

export type ThinkGraphLayoutState = {
  nodePositions?: Record<string, { x: number; y: number }>;
  collapsedNodeIds?: string[];
  groupBy?: string | null;
};

export type ThinkGraphFlowNodeData = {
  label: string;
  type: string;
  summary?: string;
  confidence?: number;
};

export type ThinkGraphFlowNode = Node<ThinkGraphFlowNodeData>;
export type ThinkGraphFlowEdge = Edge;

export type ThinkGraphFlowProjection = {
  nodes: ThinkGraphFlowNode[];
  edges: ThinkGraphFlowEdge[];
};

export function toThinkGraphProjectionInput(data: GraphViewData): ThinkGraphProjectionInput {
  return {
    entities: data.nodes.map((node) => ({
      id: String(node.id),
      label: String(node.label || node.id),
      type: String(node.type || "entity"),
      summary: node.summary,
      confidence: typeof node.confidence === "number" ? node.confidence : undefined,
      semanticMetadata: {
        sourceIds: Array.isArray(node.sourceIds) ? node.sourceIds : [],
        color: node.color || null,
        size: node.size ?? null,
      },
    })),
    relationships: data.edges.map((edge) => ({
      id: String(edge.id),
      sourceId: String(edge.source),
      targetId: String(edge.target),
      type: String(edge.type || "related_to"),
      weight: typeof edge.weight === "number" ? edge.weight : undefined,
      confidence: undefined,
      semanticMetadata: {
        color: edge.color || null,
      },
    })),
  };
}

function fallbackPosition(index: number): { x: number; y: number } {
  const angle = index * 0.62;
  const radius = 120 + Math.floor(index / 8) * 110;
  return {
    x: Math.cos(angle) * radius + 180,
    y: Math.sin(angle) * radius + 120,
  };
}

export function toReactFlowGraph(
  input: ThinkGraphProjectionInput,
  options?: {
    layoutState?: ThinkGraphLayoutState;
    maxNodes?: number;
  },
): ThinkGraphFlowProjection {
  const nodeLimit =
    typeof options?.maxNodes === "number" && Number.isFinite(options.maxNodes)
      ? Math.max(1, Math.floor(options.maxNodes))
      : 80;
  const entities = input.entities.slice(0, nodeLimit);
  const entityIdSet = new Set(entities.map((entity) => entity.id));
  const collapsedSet = new Set(options?.layoutState?.collapsedNodeIds || []);

  const nodes: ThinkGraphFlowNode[] = entities.map((entity, index) => {
    const explicitPosition = options?.layoutState?.nodePositions?.[entity.id];
    const position = explicitPosition || fallbackPosition(index);
    return {
      id: entity.id,
      type: "default",
      position,
      data: {
        label: entity.label,
        type: entity.type,
        summary: entity.summary,
        confidence: entity.confidence,
      },
      hidden: collapsedSet.has(entity.id),
      selectable: true,
      draggable: true,
    };
  });

  const edges: ThinkGraphFlowEdge[] = input.relationships
    .filter((edge) => entityIdSet.has(edge.sourceId) && entityIdSet.has(edge.targetId))
    .map((edge) => ({
      id: edge.id || `${edge.sourceId}->${edge.targetId}:${edge.type}`,
      source: edge.sourceId,
      target: edge.targetId,
      type: "smoothstep",
      label: edge.type,
      animated: false,
      style: {
        stroke: "rgba(79,162,173,0.45)",
        strokeWidth: Math.max(1, Number(edge.weight || 1)),
      },
    }));

  return { nodes, edges };
}
