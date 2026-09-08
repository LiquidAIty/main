import { MultiDirectedGraph } from 'graphology';

import type { GraphProjectionNode, GraphProjectionV1 } from './NativeAuthorityGraphSurface';

const COMMUNITY_COLORS = ['#75ccc0', '#d5b47b', '#9ca9e1', '#cb98b5', '#91b9d2', '#a7c68f'];

// A numerical seed only. ForceAtlas2 derives the displayed positions from edges.
function seedPosition(index: number, count: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { x: (index % columns) * 3, y: Math.floor(index / columns) * 3 };
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
  const communities = [...new Set(nodes.map(node => String(node.properties?.communityId || '')))].sort();
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
      : seedPosition(index, nodes.length);
    const position = Number.isFinite(existingPosition.x) && Number.isFinite(existingPosition.y)
      ? existingPosition
      : seedPosition(index, nodes.length);
    const communityId = String(node.properties?.communityId || '');
    const attributes = {
      ...position,
      label: String(node.label || node.title || node.id),
      color: String(node.properties?.attentionActorColor || COMMUNITY_COLORS[Math.max(0, communities.indexOf(communityId)) % COMMUNITY_COLORS.length]),
      communityId,
      forceLabel: Number(node.properties?.gatewayScore) > 0.05 || Number(node.properties?.currentInterest) > 0.7,
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
      color: edge.properties?.edgeClass === 'derived' ? 'rgba(130, 150, 165, 0.18)' : 'rgba(111, 190, 210, 0.6)',
      weight: Number(edge.properties?.strength) || 1,
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
