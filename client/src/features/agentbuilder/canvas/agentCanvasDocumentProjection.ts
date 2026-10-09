import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';

import type { DeckCard, DeckDocument, DeckEdge, DeckEdgeType } from '../../../types/agentgraph';
import { buildDeckEdgeIdentityKey } from './deckEdgeIdentity';
import { hasMainBotAuthority, normalizeDeckEdgeType } from '../deck/deckPrimitives';
import {
  buildFocusedNodeSet,
  buildUndirectedNeighborMap,
  isEdgeConnectedToNode,
} from '../../../components/graph/graphWorkspaceContract';

const PERSISTED_NODE_CHANGE_TYPES = new Set<NodeChange['type']>(['add', 'replace']);
const PERSISTED_EDGE_CHANGE_TYPES = new Set<EdgeChange['type']>(['add', 'remove', 'replace']);

export function syncFlowNodesForRender(currentNodes: Node[], nextNodes: Node[]): Node[] {
  const currentNodeById = new Map(currentNodes.map((node) => [node.id, node] as const));

  return nextNodes.map((nextNode) => {
    const currentNode = currentNodeById.get(nextNode.id);
    if (!currentNode) return nextNode;
    return {
      ...currentNode,
      ...nextNode,
      // ReactFlow owns the pointer position for the duration of a drag. Deck,
      // selection, edge, and runtime-status refreshes may update presentation
      // data, but they must not snap the node back to its last saved position
      // before onNodeDragStop commits the exact final coordinates.
      position: currentNode.dragging ? currentNode.position : nextNode.position,
      data: nextNode.data,
      style: nextNode.style,
      selected: nextNode.selected,
    };
  });
}

export function syncFlowEdgesForRender(currentEdges: Edge[], nextEdges: Edge[]): Edge[] {
  const currentEdgeById = new Map(currentEdges.map((edge) => [edge.id, edge] as const));

  return nextEdges.map((nextEdge) => {
    const currentEdge = currentEdgeById.get(nextEdge.id);
    if (!currentEdge) return nextEdge;
    return {
      ...currentEdge,
      ...nextEdge,
      data: nextEdge.data,
      style: nextEdge.style,
      markerEnd: nextEdge.markerEnd,
      selected: nextEdge.selected,
      className: nextEdge.className,
    };
  });
}

export function toFlowNodes(
  document: DeckDocument,
  selectedCardId: string | null,
  hoveredCardId: string | null,
  inspectMode: boolean,
  activeCardIds: Set<string>,
  activeAgentCounts: Record<string, number> = {},
): Node[] {
  const bus = document.nodes.find((node) => node.runtime.kind === 'hermes' && node.runtime.mode === 'magentic_one');
  const neighborsByNode = buildUndirectedNeighborMap(
    document.nodes.map((node) => node.id),
    document.edges.map((edge) => ({ source: edge.source, target: edge.target })),
  );
  const hoveredRelatedNodeIds = buildFocusedNodeSet(hoveredCardId, neighborsByNode);
  return document.nodes.map((node) => {
    const isMagneticWorkerBus = node.runtime.kind === 'hermes' && node.runtime.mode === 'magentic_one';
    return {
      id: node.id,
      type: isMagneticWorkerBus ? 'magneticWorkerBus' : 'deckCard',
      position: node.position,
      draggable: !isMagneticWorkerBus,
      selectable: true,
      focusable: true,
      style: hoveredCardId
        ? {
            opacity:
              node.id === hoveredCardId || hoveredRelatedNodeIds.has(node.id) || node.id === selectedCardId
                ? 1
                : 0.44,
          }
        : undefined,
      data: {
        ...node,
        busX: bus?.position.x,
        isRuntimeActive: activeCardIds.has(node.id),
        activeAgentCount: activeAgentCounts[node.id] ?? 0,
        isInspecting: inspectMode && selectedCardId === node.id,
      },
      selected: node.id === selectedCardId,
    };
  });
}

export type FlowEdgeData = {
  edgeType?: DeckEdgeType | null;
  enabled?: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  isHoverConnected?: boolean;
  isLoopEdge?: boolean;
  isReturnEdge?: boolean;
};

const MAGNETIC_DIRECT_HANDLE = 'card-control';

/** Classify a user-drawn connection from Card identities, not the side or
 * decorative handle used: a Magnetic endpoint is blue worker membership;
 * an orchestrator Card's outbound connection to another Card is orange flow.
 * Orange authority is outbound and never implies reverse control. */
export function resolveCanvasConnectionEdgeType(
  document: DeckDocument,
  connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
): DeckEdgeType | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }

  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));
  const sourceNode = nodeMap.get(connection.source);
  const targetNode = nodeMap.get(connection.target);
  if (!sourceNode || !targetNode) return null;

  const sourceIsBus = sourceNode.runtime.kind === 'hermes' && sourceNode.runtime.mode === 'magentic_one';
  const targetIsBus = targetNode.runtime.kind === 'hermes' && targetNode.runtime.mode === 'magentic_one';
  if (sourceIsBus && targetIsBus) return null;

  if (sourceIsBus || targetIsBus) {
    return 'magentic_option';
  }

  const targetOptions = targetNode.runtimeOptions as { enabled?: boolean } | null;
  const targetProfile = targetNode.runtime.kind === 'hermes' ? targetNode.runtime.profile.trim().toLowerCase() : '';
  if (!hasMainBotAuthority(sourceNode)
    || (targetNode as DeckCard & { enabled?: boolean }).enabled === false
    || targetOptions?.enabled === false
    || targetNode.runtime.kind !== 'hermes'
    || targetNode.runtime.mode === 'magentic_one'
    || !targetProfile
    || document.nodes.filter((card) => card.runtime.kind === 'hermes'
      && card.runtime.profile.trim().toLowerCase() === targetProfile).length !== 1
    || (sourceNode.runtime.kind === 'hermes'
      && sourceNode.runtime.profile.trim().toLowerCase() === targetNode.runtime.profile.trim().toLowerCase())) {
    return null;
  }
  return 'flow';
}

export function toFlowEdges(
  document: DeckDocument,
  selectedEdgeId: string | null,
  hoveredCardId: string | null,
  activeEdgeIds: Set<string>,
): Edge[] {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  return document.edges.flatMap((edge) => {
    const isSelected = edge.id === selectedEdgeId;
    const isHoverConnected = isEdgeConnectedToNode(edge.source, edge.target, hoveredCardId);
    const isActive = edge.enabled !== false && activeEdgeIds.has(edge.id);
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    const sourceNode = nodeById.get(edge.source) as DeckCard | undefined;
    const targetNode = nodeById.get(edge.target) as DeckCard | undefined;
    if (!sourceNode || !targetNode) return [];
    const sourceCanOrchestrate = hasMainBotAuthority(sourceNode);
    const targetCanOrchestrate = hasMainBotAuthority(targetNode);
    const targetIsMagnetic = targetNode.runtime.kind === 'hermes'
      && targetNode.runtime.mode === 'magentic_one';
    return {
      id: edge.id,
      hidden: edgeType === 'flow' && (!sourceCanOrchestrate || edge.enabled === false),
      source: edge.source,
      sourceHandle: edgeType === 'flow' && sourceCanOrchestrate
        ? 'card-control' : edge.sourceHandle ?? undefined,
      target: edge.target,
      targetHandle: edgeType === 'flow' && sourceCanOrchestrate
        ? (
            targetIsMagnetic
              ? MAGNETIC_DIRECT_HANDLE
              : targetCanOrchestrate && edge.targetHandle === 'card-control'
                ? 'card-control'
                : undefined
          )
        : edge.targetHandle ?? undefined,
      data: {
        edgeType,
        enabled: edge.enabled !== false,
        isActive,
        isSelected,
        isHoverConnected,
        isLoopEdge: false,
        isReturnEdge: false,
      } satisfies FlowEdgeData,
      type: 'turboFlow',
      className: [
        isActive ? 'edge-active' : null,
        isSelected ? 'edge-selected' : null,
        edgeType === 'magentic_option'
          ? 'edge-magnetic-option'
          : edgeType === 'invalid'
            ? 'edge-invalid'
            : 'edge-flow',
      ]
        .filter(Boolean)
        .join(' '),
      selected: isSelected,
      selectable: true,
      focusable: true,
      reconnectable: true,
      interactionWidth: 32,
      markerEnd: 'agent-edge-circle',
      style: {
        strokeWidth: isSelected ? 1.56 : isActive ? 1.5 : 1.36,
        opacity: hoveredCardId
          ? (isHoverConnected ? 0.58 : 0.24)
          : (isSelected ? 0.6 : 0.44),
      },
    } as Edge;
  });
}

export function shouldPersistNodeChanges(changes: NodeChange[]): boolean {
  return changes.some((change) => PERSISTED_NODE_CHANGE_TYPES.has(change.type));
}

export function shouldPersistEdgeChanges(changes: EdgeChange[]): boolean {
  return changes.some((change) => PERSISTED_EDGE_CHANGE_TYPES.has(change.type));
}

export function reduceCanvasNodeChanges(
  changes: NodeChange[],
  currentNodes: Node[],
): { nextNodes: Node[]; nextNodesForPersistence: Node[] | null } {
  const acceptedChanges = changes.filter((change) => change.type !== 'remove');
  const nextNodes = applyNodeChanges(acceptedChanges, currentNodes);
  return {
    nextNodes,
    nextNodesForPersistence: shouldPersistNodeChanges(acceptedChanges) ? nextNodes : null,
  };
}

export function reduceCanvasEdgeChanges(
  changes: EdgeChange[],
  currentEdges: Edge[],
): { nextEdges: Edge[]; nextEdgesForPersistence: Edge[] | null } {
  const nextEdges = applyEdgeChanges(changes, currentEdges);
  return {
    nextEdges,
    nextEdgesForPersistence: shouldPersistEdgeChanges(changes) ? nextEdges : null,
  };
}

export function mergeFlowNodesIntoDeck(nextNodes: Node[], prevNodes: DeckCard[]): DeckCard[] {
  const nextNodeById = new Map(nextNodes.map((node) => [node.id, node] as const));
  const merged = prevNodes
    .filter((node) => nextNodeById.has(node.id))
    .map((node) => ({
      ...node,
      position: nextNodeById.get(node.id)?.position || node.position,
    }));

  nextNodes.forEach((node) => {
    if (merged.some((entry) => entry.id === node.id)) return;
    merged.push({
      ...(node.data as DeckCard),
      position: node.position,
    });
  });

  return merged;
}

export function mergeFlowEdgesIntoDeck(nextEdges: Edge[], prevEdges: DeckEdge[]): DeckEdge[] {
  const nextEdgeById = new Map(nextEdges.map((edge) => [edge.id, edge] as const));
  const merged = prevEdges
    .filter((edge) => nextEdgeById.has(edge.id))
    .map((edge) => {
      const nextEdge = nextEdgeById.get(edge.id);
      if (!nextEdge) return edge;
      return {
        ...edge,
        source: nextEdge.source,
        sourceHandle: nextEdge.source === edge.source && nextEdge.sourceHandle === 'card-control'
          && normalizeDeckEdgeType(edge.edgeType) === 'flow'
          ? edge.sourceHandle ?? null : nextEdge.sourceHandle ?? null,
        target: nextEdge.target,
        targetHandle: nextEdge.targetHandle ?? null,
        edgeType:
          ((nextEdge.data as FlowEdgeData | undefined)?.edgeType as DeckEdgeType | null | undefined) ??
          edge.edgeType ??
          'flow',
      };
    });

  nextEdges.forEach((edge) => {
    if (merged.some((entry) => entry.id === edge.id)) return;
    merged.push({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
      edgeType:
        ((edge.data as FlowEdgeData | undefined)?.edgeType as DeckEdgeType | null | undefined) ??
        'flow',
    });
  });

  return merged;
}

export function isPlainConnectionAllowedForDocument(
  document: DeckDocument,
  connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
  currentEdges: Edge[],
  ignoreEdgeId?: string,
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;
  const edgeType = resolveCanvasConnectionEdgeType(document, connection);
  if (!edgeType) return false;

  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const masterAssignment = (
    sourceId: string,
    targetId: string,
    type: DeckEdgeType,
  ): { workerId: string; masterId: string } | null | false => {
    const source = nodeById.get(sourceId);
    const target = nodeById.get(targetId);
    if (!source || !target) return false;
    if (type === 'flow') {
      if (!hasMainBotAuthority(source)) return false;
      if (target.runtime.kind === 'hermes' && target.runtime.mode === 'magentic_one') return null;
      return { workerId: targetId, masterId: sourceId };
    }
    if (type !== 'magentic_option') return null;
    const sourceIsMagnetic = source.runtime.kind === 'hermes'
      && source.runtime.mode === 'magentic_one';
    const targetIsMagnetic = target.runtime.kind === 'hermes'
      && target.runtime.mode === 'magentic_one';
    if (sourceIsMagnetic === targetIsMagnetic) return false;
    const worker = sourceIsMagnetic ? target : source;
    const workerRecord = worker as DeckCard & { enabled?: boolean };
    const workerOptions = worker.runtimeOptions as { enabled?: boolean } | null;
    if (worker.kind !== 'agent'
      || worker.runtime.kind !== 'hermes'
      || worker.runtime.mode !== 'delegate'
      || !worker.runtime.profile.trim()
      || workerRecord.enabled === false
      || workerOptions?.enabled === false) return false;
    return {
      workerId: sourceIsMagnetic ? targetId : sourceId,
      masterId: sourceIsMagnetic ? sourceId : targetId,
    };
  };
  const candidateMaster = masterAssignment(connection.source, connection.target, edgeType);
  if (candidateMaster === false) return false;
  if (candidateMaster && currentEdges.some((edge) => {
    if (edge.id === ignoreEdgeId || !edge.source || !edge.target) return false;
    if ((edge.data as FlowEdgeData | undefined)?.enabled === false) return false;
    const existingType = (
      (edge.data as { edgeType?: DeckEdgeType | null } | undefined)?.edgeType ?? 'flow'
    ) as DeckEdgeType;
    if (existingType !== edgeType) return false;
    const existingMaster = masterAssignment(edge.source, edge.target, existingType);
    return Boolean(
      existingMaster
      && existingMaster.workerId === candidateMaster.workerId
      && existingMaster.masterId !== candidateMaster.masterId,
    );
  })) return false;

  const nextEdgeKey = buildDeckEdgeIdentityKey({
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
    edgeType,
  });

  return !currentEdges.some((edge) => {
    if (edge.id === ignoreEdgeId) return false;
    if (!edge.source || !edge.target) return false;
    return (
      buildDeckEdgeIdentityKey({
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        target: edge.target,
        targetHandle: edge.targetHandle ?? null,
        edgeType:
          ((edge.data as { edgeType?: DeckEdgeType | null } | undefined)?.edgeType as DeckEdgeType | null | undefined) ??
          'flow',
      }) === nextEdgeKey
    );
  });
}

export function buildDeckEdgeFromConnection(
  connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
  edgeId: string,
  edgeType: DeckEdgeType,
): DeckEdge | null {
  if (!connection.source || !connection.target) return null;
  return {
    id: edgeId,
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
    edgeType,
  };
}
