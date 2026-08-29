import { MultiDirectedGraph } from 'graphology';

import type { GraphProjectionNode, GraphProjectionV1 } from './NativeAuthorityGraphSurface';

const LEVEL_COLORS: Record<string, string> = {
  L2: '#ffd166',
  L1: '#7dd3fc',
  L0: '#a78bfa',
};

function stableAngle(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function nodePosition(node: GraphProjectionNode, index: number, total: number) {
  const distance = Number(node.properties?.distance);
  const normalizedDistance = Number.isFinite(distance) ? Math.max(0, distance) : null;
  const angle = stableAngle(node.id) + index * Math.PI * (3 - Math.sqrt(5));
  const radius = normalizedDistance == null
    ? 1.2 + Math.sqrt((index + 1) / Math.max(1, total)) * 8
    : 1.2 + Math.min(10, normalizedDistance * 7);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

type ProjectionSyncResult = {
  renderedNodes: number;
  renderedEdges: number;
  filteredEdges: number;
  becamePopulated: boolean;
};

export function synchronizeProjectionGraph(
  graph: MultiDirectedGraph,
  projection: GraphProjectionV1 | null,
): ProjectionSyncResult {
  const nodes = projection?.nodes ?? [];
  const edges = projection?.edges ?? [];
  const nodeById = new Map<string, GraphProjectionNode>();
  for (const node of nodes) {
    if (nodeById.has(node.id)) throw new Error(`duplicate_projection_node_id:${node.id}`);
    nodeById.set(node.id, node);
  }

  const edgeById = new Map<string, GraphProjectionV1['edges'][number]>();
  let filteredEdges = 0;
  for (const edge of edges) {
    if (edgeById.has(edge.id)) throw new Error(`duplicate_projection_edge_id:${edge.id}`);
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      filteredEdges += 1;
      continue;
    }
    edgeById.set(edge.id, edge);
  }

  const wasEmpty = graph.order === 0;
  for (const edgeId of graph.edges()) {
    const edge = edgeById.get(edgeId);
    if (
      !edge
      || graph.source(edgeId) !== edge.source
      || graph.target(edgeId) !== edge.target
    ) {
      graph.dropEdge(edgeId);
    }
  }
  for (const nodeId of graph.nodes()) {
    if (!nodeById.has(nodeId)) graph.dropNode(nodeId);
  }

  const degree = new Map<string, number>();
  for (const edge of edgeById.values()) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  nodes.forEach((node, index) => {
    const level = String(node.properties?.level || '');
    const nodeDegree = degree.get(node.id) || 0;
    const existingPosition = graph.hasNode(node.id)
      ? {
          x: Number(graph.getNodeAttribute(node.id, 'x')),
          y: Number(graph.getNodeAttribute(node.id, 'y')),
        }
      : nodePosition(node, index, nodes.length);
    const position = Number.isFinite(existingPosition.x) && Number.isFinite(existingPosition.y)
      ? existingPosition
      : nodePosition(node, index, nodes.length);
    const attributes = {
      ...position,
      label: String(node.label || node.title || node.id),
      color: String(node.properties?.attentionActorColor || LEVEL_COLORS[level] || '#5eead4'),
      size: Math.max(3, Math.min(14, 4 + Math.sqrt(nodeDegree + 1) * 1.8)),
      zIndex: level === 'L2' ? 3 : level === 'L1' ? 2 : 1,
      nativeId: node.id,
      canonicalId: node.canonicalId || node.id,
      properties: node.properties || {},
      provenance: node.provenance || {},
    };
    if (graph.hasNode(node.id)) graph.replaceNodeAttributes(node.id, attributes);
    else graph.addNode(node.id, attributes);
  });

  for (const edge of edgeById.values()) {
    const attributes = {
      label: edge.predicate,
      color: 'rgba(111, 190, 210, 0.34)',
      size: Math.max(0.4, Math.min(3, Number(edge.properties?.strength) || 0.8)),
      nativeId: edge.id,
      properties: edge.properties || {},
      provenance: edge.provenance || {},
    };
    if (graph.hasEdge(edge.id)) graph.replaceEdgeAttributes(edge.id, attributes);
    else graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, attributes);
  }

  return {
    renderedNodes: graph.order,
    renderedEdges: graph.size,
    filteredEdges,
    becamePopulated: wasEmpty && graph.order > 0,
  };
}
