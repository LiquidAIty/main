import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnReconnect,
  type ReactFlowInstance,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import type {
  AgentCardInstance,
  AgentCardRuntimeType,
  DeckDocument,
  DeckEdge,
  DeckEdgeMetadata,
  DeckEdgeType,
} from '../../types/agentgraph';
import type { DeckExecutionPlan } from './deckExecution';
import {
  buildDeckEdgeIdentityKey,
  buildDefaultDeckEdgeMetadata,
  normalizeDeckEdgeMetadata,
} from './deckValidation';
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
  graphPillButtonStyle,
} from '../graph/graphVisualTokens';
import {
  GRAPH_WORKSPACE,
  buildFocusedNodeSet,
  buildUndirectedNeighborMap,
  isEdgeConnectedToNode,
} from '../graph/graphWorkspaceContract';
import TurboFlowEdge from './edges/TurboFlowEdge';
import AgentCardNode from './nodes/AgentCardNode';

const DEV_MODE = import.meta.env.DEV;
const PERSISTED_NODE_CHANGE_TYPES = new Set<NodeChange['type']>(['add', 'remove', 'replace', 'position']);
const PERSISTED_EDGE_CHANGE_TYPES = new Set<EdgeChange['type']>(['add', 'remove', 'replace']);
const FALLBACK_NODE_WIDTH = 144;
const FALLBACK_NODE_HEIGHT = 88;
const CANVAS_ROW_X_START = 180;
const CANVAS_ROW_Y_START = 120;
const CANVAS_ROW_X_GAP = 216;

const nodeTypes = {
  agentCard: AgentCardNode,
};
const edgeTypes = {
  turboFlow: TurboFlowEdge,
};

type ViewportRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type AssistStructureMode = 'single' | 'seq' | 'branch' | 'merge' | 'branch_merge';

export type AssistStructureSummary = {
  mode: AssistStructureMode;
  incomingGraphFlowCount: number;
  outgoingGraphFlowCount: number;
};

type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BuilderCanvasFocusRequest = {
  kind: 'deck' | 'card';
  cardId?: string | null;
  nonce: number;
};

export function buildCanvasDocumentRecoveryKey(document: DeckDocument): string {
  return JSON.stringify({
    version: document.version,
    nodes: document.nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      parentGraphId: String(node.parentGraphId || ''),
      runtimeType: normalizeRuntimeType(node.runtimeType),
    })),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      edgeType: normalizeEdgeType(edge.edgeType),
    })),
  });
}

export function syncFlowNodesForRender(currentNodes: Node[], nextNodes: Node[]): Node[] {
  const currentNodeById = new Map(currentNodes.map((node) => [node.id, node] as const));

  return nextNodes.map((nextNode) => {
    const currentNode = currentNodeById.get(nextNode.id);
    if (!currentNode) return nextNode;
    return {
      ...currentNode,
      ...nextNode,
      position: nextNode.position,
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

function getNodeCanvasRect(node: Node): CanvasRect {
  const nodeWithLayout = node as Node & {
    width?: number;
    height?: number;
    measured?: { width?: number; height?: number };
    positionAbsolute?: { x: number; y: number };
  };
  const position = nodeWithLayout.positionAbsolute || node.position;
  const width =
    typeof nodeWithLayout.measured?.width === 'number'
      ? nodeWithLayout.measured.width
      : typeof nodeWithLayout.width === 'number'
        ? nodeWithLayout.width
        : FALLBACK_NODE_WIDTH;
  const height =
    typeof nodeWithLayout.measured?.height === 'number'
      ? nodeWithLayout.measured.height
      : typeof nodeWithLayout.height === 'number'
        ? nodeWithLayout.height
        : FALLBACK_NODE_HEIGHT;

  return {
    x: position.x,
    y: position.y,
    width,
    height,
  };
}

export function isCanvasRectVisible(rect: CanvasRect, visibleRect: ViewportRect, padding: number): boolean {
  return (
    rect.x + rect.width >= visibleRect.left + padding &&
    rect.x <= visibleRect.right - padding &&
    rect.y + rect.height >= visibleRect.top + padding &&
    rect.y <= visibleRect.bottom - padding
  );
}

export function isAnyCanvasNodeVisible(nodes: Node[], visibleRect: ViewportRect, padding: number): boolean {
  return nodes.some((node) => isCanvasRectVisible(getNodeCanvasRect(node), visibleRect, padding));
}

function computeLeftToRightCanvasRows(document: DeckDocument): Map<string, { x: number; y: number }> {
  const cards = document.nodes.filter(
    (node) =>
      isTopLevelCanvasCard(node),
  );
  const cardIdSet = new Set(cards.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const positionById = new Map(cards.map((node) => [node.id, node.position] as const));
  cards.forEach((node) => {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  });

  document.edges.forEach((edge) => {
    if (!cardIdSet.has(edge.source) || !cardIdSet.has(edge.target)) return;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
    incomingCount.set(edge.target, Number(incomingCount.get(edge.target) || 0) + 1);
  });

  const queue = cards
    .filter((node) => Number(incomingCount.get(node.id) || 0) === 0)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .map((node) => node.id);
  const layerById = new Map<string, number>(cards.map((node) => [node.id, 0] as const));
  const seen = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    seen.add(currentId);
    const currentLayer = Number(layerById.get(currentId) || 0);
    (outgoing.get(currentId) || []).forEach((nextId) => {
      layerById.set(nextId, Math.max(Number(layerById.get(nextId) || 0), currentLayer + 1));
      const remainingIncoming = Number(incomingCount.get(nextId) || 0) - 1;
      incomingCount.set(nextId, remainingIncoming);
      if (remainingIncoming === 0) queue.push(nextId);
    });
  }

  // Cycle fallback: preserve left-to-right intent by deriving layer from original x buckets.
  cards.forEach((node) => {
    if (seen.has(node.id)) return;
    const bucket = Math.max(0, Math.round((node.position.x - CANVAS_ROW_X_START) / CANVAS_ROW_X_GAP));
    layerById.set(node.id, bucket);
  });

  const layout = new Map<string, { x: number; y: number }>();
  const nodesByLayer = new Map<number, string[]>();
  cards.forEach((node) => {
    const layer = Number(layerById.get(node.id) || 0);
    nodesByLayer.set(layer, [...(nodesByLayer.get(layer) || []), node.id]);
  });
  let columnIndex = 0;
  Array.from(nodesByLayer.keys())
    .sort((a, b) => a - b)
    .forEach((layer) => {
      const ids = (nodesByLayer.get(layer) || []).sort((left, right) => {
        const leftPos = positionById.get(left) || { x: 0, y: 0 };
        const rightPos = positionById.get(right) || { x: 0, y: 0 };
        return leftPos.x - rightPos.x || leftPos.y - rightPos.y;
      });
      ids.forEach((nodeId) => {
        layout.set(nodeId, {
          x: CANVAS_ROW_X_START + columnIndex * CANVAS_ROW_X_GAP,
          y: CANVAS_ROW_Y_START,
        });
        columnIndex += 1;
      });
  });

  return layout;
}

function toFlowNodes(
  document: DeckDocument,
  selectedCardId: string | null,
  selectedEdgeId: string | null,
  hoveredCardId: string | null,
  inspectMode: boolean,
  executionPlan: Pick<DeckExecutionPlan, 'simpleOrderCardIds' | 'startCardIds'> | null,
  activeCardIds: Set<string>,
  activeEdgeIds: Set<string>,
  swarmProgressByCardId: Record<string, { completed: number; total: number }>,
): Node[] {
  const executionOrderById = new Map(
    (executionPlan?.simpleOrderCardIds || []).map((cardId, index) => [cardId, index + 1] as const),
  );
  const startCardIds = new Set(executionPlan?.startCardIds || []);
  const callableHeadIds = new Set(
    document.edges
      .filter((edge) => normalizeEdgeType(edge.edgeType) === 'magentic_option')
      .map((edge) => edge.target),
  );
  const assistStructureSummaries = buildAssistStructureSummaries(document);
  const neighborsByNode = buildUndirectedNeighborMap(
    document.nodes.map((node) => node.id),
    document.edges.map((edge) => ({ source: edge.source, target: edge.target })),
  );
  const hoveredRelatedNodeIds = buildFocusedNodeSet(hoveredCardId, neighborsByNode);
  const emphasizedFlowNodeIds = new Set(
    document.edges
      .filter((edge) => edge.id === selectedEdgeId || activeEdgeIds.has(edge.id))
      .flatMap((edge) => [edge.source, edge.target]),
  );
  const rowLayout = computeLeftToRightCanvasRows(document);
  return document.nodes.map((node) => ({
    id: node.id,
    type: 'agentCard',
    position: rowLayout.get(node.id) || node.position,
    draggable: true,
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
      executionOrder: executionOrderById.get(node.id) || null,
      isStartCard: startCardIds.has(node.id),
      isCallableHead: callableHeadIds.has(node.id),
      assistStructureMode: assistStructureSummaries.get(node.id)?.mode || null,
      swarmBadge: getAssistSwarmBadge(node, swarmProgressByCardId[node.id] || null),
      isRuntimeActive: activeCardIds.has(node.id),
      isHovered: node.id === hoveredCardId,
      isHoverRelated: hoveredCardId ? hoveredRelatedNodeIds.has(node.id) : false,
      isFlowLinked: emphasizedFlowNodeIds.has(node.id),
      isInspecting: inspectMode && selectedCardId === node.id,
    },
    selected: node.id === selectedCardId,
  }));
}

export type DeckEdgeVisualState = {
  isLoopEdge: boolean;
  isReturnEdge: boolean;
  offset: number;
  borderRadius: number;
};

type FlowEdgeData = {
  edgeType?: DeckEdgeType | null;
  metadata?: DeckEdgeMetadata | null;
  isActive?: boolean;
  isSelected?: boolean;
  isHoverConnected?: boolean;
  isLoopEdge?: boolean;
  isReturnEdge?: boolean;
};

function normalizeEdgeType(value: unknown): DeckEdgeType {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'flow';
}

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'graph_flow') return 'graph_flow';
  if (normalized === 'local_coder') return 'local_coder';
  return 'assistant_agent';
}

function isAssistLikeRuntimeType(runtimeType: AgentCardRuntimeType): boolean {
  return runtimeType === 'assistant_agent' || runtimeType === 'local_coder';
}

function isTopLevelCanvasCard(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(node && !String(node.parentGraphId || '').trim());
}

function isAssistCanvasCard(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(
    node &&
      isAssistLikeRuntimeType(normalizeRuntimeType(node.runtimeType)),
  );
}

function isVisibleAssistFlowPair(
  sourceNode: AgentCardInstance | undefined | null,
  targetNode: AgentCardInstance | undefined | null,
): boolean {
  if (!isAssistCanvasCard(sourceNode) || !isAssistCanvasCard(targetNode)) return false;

  const sourceGraphId = String(sourceNode.parentGraphId || '').trim();
  const targetGraphId = String(targetNode.parentGraphId || '').trim();

  if (!sourceGraphId && !targetGraphId) {
    return true;
  }

  return Boolean(sourceGraphId && sourceGraphId === targetGraphId);
}

export function buildAssistStructureSummaries(
  document: DeckDocument,
): Map<string, AssistStructureSummary> {
  const summaries = new Map<string, AssistStructureSummary>();
  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));

  document.nodes.forEach((node) => {
    if (!isAssistLikeRuntimeType(normalizeRuntimeType(node.runtimeType))) {
      return;
    }
    summaries.set(node.id, {
      mode: 'single',
      incomingGraphFlowCount: 0,
      outgoingGraphFlowCount: 0,
    });
  });

  document.edges.forEach((edge) => {
    if (normalizeEdgeType(edge.edgeType) !== 'flow') return;
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode || !isVisibleAssistFlowPair(sourceNode, targetNode)) {
      return;
    }

    const sourceSummary = summaries.get(sourceNode.id);
    const targetSummary = summaries.get(targetNode.id);
    if (!sourceSummary || !targetSummary) return;

    sourceSummary.outgoingGraphFlowCount += 1;
    targetSummary.incomingGraphFlowCount += 1;
  });

  summaries.forEach((summary) => {
    if (summary.outgoingGraphFlowCount > 1 && summary.incomingGraphFlowCount > 1) {
      summary.mode = 'branch_merge';
      return;
    }
    if (summary.outgoingGraphFlowCount > 1) {
      summary.mode = 'branch';
      return;
    }
    if (summary.incomingGraphFlowCount > 1) {
      summary.mode = 'merge';
      return;
    }
    if (summary.outgoingGraphFlowCount > 0 || summary.incomingGraphFlowCount > 0) {
      summary.mode = 'seq';
    }
  });

  return summaries;
}

export function getAssistSwarmBadge(
  node: AgentCardInstance,
  runtimeProgress: { completed: number; total: number } | null,
): string | null {
  if (normalizeRuntimeType(node.runtimeType) !== 'assistant_agent') return null;
  if (node.runtimeOptions?.executionMode !== 'swarm') return null;
  if (!runtimeProgress) return null;
  return `${runtimeProgress.completed}/${runtimeProgress.total}`;
}

function resolveCanvasConnectionEdgeType(
  document: DeckDocument,
  connection: Pick<Connection, 'source' | 'target'>,
): DeckEdgeType | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }

  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));
  const sourceNode = nodeMap.get(connection.source);
  const targetNode = nodeMap.get(connection.target);
  if (!sourceNode || !targetNode) return null;

  const sourceRuntimeType = normalizeRuntimeType(sourceNode.runtimeType);
  const targetRuntimeType = normalizeRuntimeType(targetNode.runtimeType);

  if (
    (
      sourceRuntimeType === 'magentic_one' &&
      (isAssistLikeRuntimeType(targetRuntimeType) || targetRuntimeType === 'graph_flow')
    ) ||
    (
      targetRuntimeType === 'magentic_one' &&
      (isAssistLikeRuntimeType(sourceRuntimeType) || sourceRuntimeType === 'graph_flow')
    )
  ) {
    return 'magentic_option';
  }

  if (isVisibleAssistFlowPair(sourceNode, targetNode)) {
    return 'flow';
  }

  return null;
}

function resolveCanvasConnectionMetadata(
  document: DeckDocument,
  connection: Pick<Connection, 'source' | 'target'>,
  edgeType: DeckEdgeType,
): DeckEdgeMetadata | null {
  if (!connection.source || !connection.target) {
    return buildDefaultDeckEdgeMetadata(edgeType);
  }

  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));
  const sourceNode = nodeMap.get(connection.source);
  const targetNode = nodeMap.get(connection.target);
  const legacyCompatibility = Boolean(
    normalizeRuntimeType(sourceNode?.runtimeType) === 'graph_flow' ||
    normalizeRuntimeType(targetNode?.runtimeType) === 'graph_flow' ||
    String(sourceNode?.parentGraphId || '').trim() ||
    String(targetNode?.parentGraphId || '').trim(),
  );

  return buildDefaultDeckEdgeMetadata(edgeType, { legacyCompatibility });
}

function buildEdgeAdjacency(document: DeckDocument): Map<string, Array<{ edgeId: string; target: string }>> {
  const adjacency = new Map<string, Array<{ edgeId: string; target: string }>>();

  document.nodes.forEach((node) => {
    adjacency.set(node.id, []);
  });

  document.edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), { edgeId: edge.id, target: edge.target }]);
  });

  return adjacency;
}

function canReachNode(
  adjacency: Map<string, Array<{ edgeId: string; target: string }>>,
  startId: string,
  targetId: string,
  ignoredEdgeId: string,
  visited: Set<string> = new Set(),
): boolean {
  if (startId === targetId) return true;
  if (visited.has(startId)) return false;
  visited.add(startId);

  return (adjacency.get(startId) || []).some((route) => {
    if (route.edgeId === ignoredEdgeId) return false;
    return canReachNode(adjacency, route.target, targetId, ignoredEdgeId, visited);
  });
}

export function buildDeckEdgeVisualStates(document: DeckDocument): Map<string, DeckEdgeVisualState> {
  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));
  const adjacency = buildEdgeAdjacency(document);

  return new Map(
    document.edges.map((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      const isLoopEdge = canReachNode(adjacency, edge.target, edge.source, edge.id);
      const isReturnEdge =
        sourceNode && targetNode
          ? targetNode.position.x < sourceNode.position.x - 16 ||
            Math.abs(targetNode.position.x - sourceNode.position.x) < 40
          : false;

      return [
        edge.id,
        {
          isLoopEdge,
          isReturnEdge,
          offset: isLoopEdge ? 56 : isReturnEdge ? 42 : 24,
          borderRadius: isLoopEdge ? 20 : isReturnEdge ? 18 : 14,
        },
      ] as const;
    }),
  );
}

function toFlowEdges(
  document: DeckDocument,
  selectedEdgeId: string | null,
  hoveredCardId: string | null,
  activeEdgeIds: Set<string>,
): Edge[] {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  return document.edges.flatMap((edge) => {
    const isSelected = edge.id === selectedEdgeId;
    const isHoverConnected = isEdgeConnectedToNode(edge.source, edge.target, hoveredCardId);
    const isActive = activeEdgeIds.has(edge.id);
    const edgeType = normalizeEdgeType(edge.edgeType);
    const sourceNode = nodeById.get(edge.source) as AgentCardInstance | undefined;
    const targetNode = nodeById.get(edge.target) as AgentCardInstance | undefined;
    if (!sourceNode || !targetNode) return [];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        edgeType,
        metadata: edge.metadata || null,
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
        edgeType === 'magentic_option' ? 'edge-magentic-option' : 'edge-flow',
      ]
        .filter(Boolean)
        .join(' '),
      selected: isSelected,
      selectable: true,
      focusable: true,
      reconnectable: true,
      interactionWidth: 32,
      pathOptions: {
        offset: 24,
        borderRadius: 14,
      },
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

export function mergeFlowNodesIntoDeck(nextNodes: Node[], prevNodes: AgentCardInstance[]): AgentCardInstance[] {
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
      ...(node.data as AgentCardInstance),
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
      const metadata =
        normalizeDeckEdgeMetadata((nextEdge.data as FlowEdgeData | undefined)?.metadata) ??
        edge.metadata ??
        null;
      const { metadata: _ignoredMetadata, ...edgeWithoutMetadata } = edge;
      return {
        ...edgeWithoutMetadata,
        source: nextEdge.source,
        target: nextEdge.target,
          edgeType:
            ((nextEdge.data as FlowEdgeData | undefined)?.edgeType as DeckEdgeType | null | undefined) ??
          edge.edgeType ??
          'flow',
        ...(metadata ? { metadata } : {}),
      };
    });

  nextEdges.forEach((edge) => {
    if (merged.some((entry) => entry.id === edge.id)) return;
    const metadata = normalizeDeckEdgeMetadata((edge.data as FlowEdgeData | undefined)?.metadata);
    merged.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      edgeType:
        ((edge.data as FlowEdgeData | undefined)?.edgeType as DeckEdgeType | null | undefined) ??
        'flow',
      ...(metadata ? { metadata } : {}),
    });
  });

  return merged;
}

export default function BuilderCanvas({
  document,
  setDocument,
  onPersistGraphMutation,
  selectedCardId,
  selectedEdgeId,
  onSelectCard,
  onSelectEdge,
  onDeleteSelectedEdge,
  executionPlan,
  activeCardIds = [],
  activeEdgeIds = [],
  swarmProgressByCardId = {},
  inspectMode = false,
}: {
  document: DeckDocument;
  setDocument: Dispatch<SetStateAction<DeckDocument>>;
  onPersistGraphMutation?: (reason: string, detail?: Record<string, unknown>) => void;
  selectedCardId: string | null;
  selectedEdgeId: string | null;
  onSelectCard: (cardId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onDeleteSelectedEdge?: () => void;
  executionPlan: Pick<DeckExecutionPlan, 'simpleOrderCardIds' | 'startCardIds'> | null;
  activeCardIds?: string[];
  activeEdgeIds?: string[];
  swarmProgressByCardId?: Record<string, { completed: number; total: number }>;
  inspectMode?: boolean;
}) {
  const activeCardIdSet = useMemo(() => new Set(activeCardIds), [activeCardIds]);
  const activeEdgeIdSet = useMemo(() => new Set(activeEdgeIds), [activeEdgeIds]);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [layoutLocked, setLayoutLocked] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const lastInitialFitKeyRef = useRef<string | null>(null);
  const flowNodes = useMemo(
    () =>
      toFlowNodes(
        document,
        selectedCardId,
        selectedEdgeId,
        hoveredCardId,
        inspectMode,
        executionPlan,
        activeCardIdSet,
        activeEdgeIdSet,
        swarmProgressByCardId,
      ),
    [activeCardIdSet, activeEdgeIdSet, document, executionPlan, hoveredCardId, inspectMode, selectedCardId, selectedEdgeId, swarmProgressByCardId],
  );
  const flowEdges = useMemo(
    () =>
      toFlowEdges(
        document,
        selectedEdgeId,
        hoveredCardId,
        activeEdgeIdSet,
      ),
    [activeEdgeIdSet, document, hoveredCardId, selectedEdgeId],
  );
  const [nodes, setNodes] = useNodesState(flowNodes);
  const [edges, setEdges] = useEdgesState(flowEdges);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pendingDocumentMutationRef = useRef<((prev: DeckDocument) => DeckDocument) | null>(null);
  const pendingPersistMetaRef = useRef<{ reason: string; detail?: Record<string, unknown> } | null>(null);
  const [pendingDocumentFlushNonce, setPendingDocumentFlushNonce] = useState(0);
  const selectedEdge = useMemo(
    () => document.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [document.edges, selectedEdgeId],
  );
  const initialFitKey = useMemo(
    () =>
      `${document.nodes.map((node) => node.id).join('|')}::${document.edges
        .map((edge) => edge.id)
        .join('|')}`,
    [document.edges, document.nodes],
  );

  useEffect(() => {
    setNodes((current) => syncFlowNodesForRender(current, flowNodes));
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges((current) => syncFlowEdgesForRender(current, flowEdges));
  }, [flowEdges, setEdges]);

  useEffect(() => {
    if (!reactFlowInstance) return;
    if (flowNodes.length === 0) return;
    if (lastInitialFitKeyRef.current === initialFitKey) return;
    lastInitialFitKeyRef.current = initialFitKey;
    let settleTimer: number | null = null;
    const applyFit = () => {
      const graphNodes = reactFlowInstance
        .getNodes()
        .filter((node) => node.type === 'agentCard');
      if (graphNodes.length === 0) return;
      const sortedByX = [...graphNodes].sort(
        (left, right) =>
          (left.positionAbsolute?.x ?? left.position.x) -
          (right.positionAbsolute?.x ?? right.position.x),
      );
      // First landing should prioritize the left/start strip at readable scale,
      // not force-fit the entire row.
      const fitNodes = sortedByX.slice(0, Math.min(2, sortedByX.length));
      reactFlowInstance.fitView({
        nodes: fitNodes,
        duration: 0,
        padding: 0.1,
        minZoom: GRAPH_WORKSPACE.landingBaselineMinZoom,
        maxZoom: GRAPH_WORKSPACE.landingBaselineMaxZoom,
      });
    };
    const frame = window.requestAnimationFrame(() => {
      applyFit();
      settleTimer = window.setTimeout(() => {
        applyFit();
      }, 96);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
      }
    };
  }, [flowNodes.length, initialFitKey, reactFlowInstance]);

  useEffect(() => {
    const pendingMutation = pendingDocumentMutationRef.current;
    if (!pendingMutation) return;
    pendingDocumentMutationRef.current = null;
    const pendingPersist = pendingPersistMetaRef.current;
    pendingPersistMetaRef.current = null;
    if (pendingPersist) {
      onPersistGraphMutation?.(pendingPersist.reason, pendingPersist.detail);
    }
    setDocument((prev) => pendingMutation(prev));
  }, [pendingDocumentFlushNonce, onPersistGraphMutation, setDocument]);

  const isPlainConnectionAllowed = (
    connection: Pick<Connection, 'source' | 'target'>,
    currentEdges: Edge[],
    ignoreEdgeId?: string,
  ): boolean => {
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;
    if (!resolveCanvasConnectionEdgeType(document, connection)) return false;

    const nextEdgeKey = buildDeckEdgeIdentityKey({
      source: connection.source,
      target: connection.target,
      edgeType: resolveCanvasConnectionEdgeType(document, connection) || 'flow',
    });

    return !currentEdges.some((edge) => {
      if (edge.id === ignoreEdgeId) return false;
      if (!edge.source || !edge.target) return false;
      return (
        buildDeckEdgeIdentityKey({
          source: edge.source,
          target: edge.target,
          edgeType:
            ((edge.data as { edgeType?: DeckEdgeType | null } | undefined)?.edgeType as DeckEdgeType | null | undefined) ??
            'flow',
        }) === nextEdgeKey
      );
    });
  };

  const onNodesChange = (changes: NodeChange[]) => {
    const hasPersistedNodeChange = shouldPersistNodeChanges(changes);
    let nextNodesForMerge: Node[] | null = null;
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      if (hasPersistedNodeChange) {
        nextNodesForMerge = next;
      } else if (DEV_MODE && changes.every((change) => change.type === 'select')) {
        console.debug('[builder] ignored node selection-only canvas change', {
          changeTypes: changes.map((change) => change.type),
        });
      }
      return next;
    });
    if (!hasPersistedNodeChange || !nextNodesForMerge) return;
    pendingPersistMetaRef.current = {
      reason: 'canvas:nodes',
      detail: { changeTypes: changes.map((change) => change.type) },
    };
    pendingDocumentMutationRef.current = (prev) => ({
      ...prev,
      version: prev.version + 1,
      nodes: mergeFlowNodesIntoDeck(nextNodesForMerge as Node[], prev.nodes),
    });
    setPendingDocumentFlushNonce((current) => current + 1);
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const hasPersistedEdgeChange = shouldPersistEdgeChanges(changes);
    let nextEdgesForMerge: Edge[] | null = null;
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      if (hasPersistedEdgeChange) {
        nextEdgesForMerge = next;
      } else if (DEV_MODE && changes.every((change) => change.type === 'select')) {
        console.debug('[builder] ignored edge selection-only canvas change', {
          changeTypes: changes.map((change) => change.type),
        });
      }
      return next;
    });
    if (!hasPersistedEdgeChange || !nextEdgesForMerge) return;
    pendingPersistMetaRef.current = {
      reason: 'canvas:edges',
      detail: { changeTypes: changes.map((change) => change.type) },
    };
    pendingDocumentMutationRef.current = (prev) => ({
      ...prev,
      version: prev.version + 1,
      edges: mergeFlowEdgesIntoDeck(nextEdgesForMerge as Edge[], prev.edges),
    });
    setPendingDocumentFlushNonce((current) => current + 1);
  };
  const commitConnection = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    let nextEdgesForMerge: Edge[] | null = null;
    let shouldPersist = false;
    setEdges((current) => {
      if (!isPlainConnectionAllowed(connection, current)) return current;
      const edgeId = `edge_${Math.random().toString(36).slice(2, 10)}`;

      const next = addEdge(
        {
          ...connection,
          id: edgeId,
          data: (() => {
            const edgeType = resolveCanvasConnectionEdgeType(document, connection) || 'flow';
            return {
              edgeType,
              metadata: resolveCanvasConnectionMetadata(document, connection, edgeType),
            } satisfies FlowEdgeData;
          })(),
        },
        current,
      );
      nextEdgesForMerge = next;
      shouldPersist = true;
      return next;
    });
    if (!shouldPersist || !nextEdgesForMerge) return;
    onPersistGraphMutation?.('canvas:connect', {
      source: connection.source,
      target: connection.target,
    });
    setDocument((prev) => ({
      ...prev,
      version: prev.version + 1,
      edges: mergeFlowEdgesIntoDeck(nextEdgesForMerge as Edge[], prev.edges),
    }));
  }, [document, onPersistGraphMutation, setDocument]);

  const onConnect = useCallback((connection: Connection) => {
    commitConnection(connection);
  }, [commitConnection]);

  const onReconnect: OnReconnect<Edge> = (oldEdge, newConnection) => {
    let nextEdgesForMerge: Edge[] | null = null;
    let shouldPersist = false;
    setEdges((current) => {
      if (!isPlainConnectionAllowed(newConnection, current, oldEdge.id)) return current;
      const nextEdgeType = resolveCanvasConnectionEdgeType(document, newConnection) || 'flow';
      const reconnected = reconnectEdge(
        oldEdge,
        newConnection,
        current,
        { shouldReplaceId: false },
      );
      const next = reconnected.map((edge) =>
        edge.id === oldEdge.id
          ? {
              ...edge,
              data: {
                ...((edge.data as FlowEdgeData | undefined) || {}),
                edgeType: nextEdgeType,
                metadata:
                  normalizeDeckEdgeMetadata((edge.data as FlowEdgeData | undefined)?.metadata) ??
                  resolveCanvasConnectionMetadata(document, newConnection, nextEdgeType),
              },
            }
          : edge,
      );
      nextEdgesForMerge = next;
      shouldPersist = true;
      return next;
    });
    if (!shouldPersist || !nextEdgesForMerge) return;
    onPersistGraphMutation?.('canvas:reconnect', {
      edgeId: oldEdge.id,
      source: newConnection.source,
      target: newConnection.target,
    });
    setDocument((prev) => ({
      ...prev,
      version: prev.version + 1,
      edges: mergeFlowEdgesIntoDeck(nextEdgesForMerge as Edge[], prev.edges),
    }));
    onSelectCard(null);
    onSelectEdge(oldEdge.id);
  };

  return (
    <div
      ref={canvasRef}
      className="builder-flow h-full w-full"
      style={{ position: 'relative', background: GRAPH_THEME.background.agentSurface }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Backspace' || event.key === 'Delete') {
          if (selectedCardId) {
            event.preventDefault();
            onPersistGraphMutation?.('canvas:delete-node', { cardId: selectedCardId });
            setDocument((prev) => ({
              ...prev,
              version: prev.version + 1,
              nodes: prev.nodes.filter((node) => node.id !== selectedCardId),
              edges: prev.edges.filter(
                (edge) => edge.source !== selectedCardId && edge.target !== selectedCardId,
              ),
            }));
            onSelectCard(null);
            onSelectEdge(null);
            setHoveredCardId(null);
            return;
          }
          if (selectedEdgeId) {
            event.preventDefault();
            if (onDeleteSelectedEdge) {
              onDeleteSelectedEdge();
            } else {
              onPersistGraphMutation?.('canvas:delete-edge', { edgeId: selectedEdgeId });
              setDocument((prev) => ({
                ...prev,
                version: prev.version + 1,
                edges: prev.edges.filter((edge) => edge.id !== selectedEdgeId),
              }));
              onSelectEdge(null);
            }
            return;
          }
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onSelectCard(null);
        onSelectEdge(null);
        setHoveredCardId(null);
      }}
    >
      <style>{`
        .builder-flow .react-flow__edge {
          cursor: pointer;
          transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .builder-flow .react-flow__edge:hover {
          opacity: 1;
        }
        .builder-flow .react-flow__edge.selected,
        .builder-flow .react-flow__edge.edge-selected {
          filter: none;
        }
        .builder-flow .react-flow__edge.edge-active {
          filter: none;
        }
        .builder-flow .react-flow__edge.edge-loop,
        .builder-flow .react-flow__edge.edge-return {
          filter: none;
        }
        .builder-flow .react-flow__node {
          transition: filter 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .builder-flow .react-flow__node.selected {
          filter: drop-shadow(0 0 4px ${GRAPH_THEME.accent.primaryGlow});
        }
        .builder-flow .react-flow__handle {
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .builder-flow .react-flow__handle:hover,
        .builder-flow .react-flow__handle.connectionindicator {
          transform: scale(1.06);
          box-shadow:
            0 0 0 2px ${GRAPH_THEME.accent.primarySoft},
            0 0 0 5px ${GRAPH_THEME.accent.solarSoft};
        }
        .builder-flow .react-flow__connection-path {
          stroke: ${GRAPH_THEME.accent.primary};
          stroke-width: 2.35;
        }
        .builder-flow .react-flow__edge-interaction {
          cursor: pointer;
        }
        .builder-flow .react-flow__controls {
          background: ${GRAPH_THEME.controls.background};
          border: 1px solid ${GRAPH_THEME.controls.border};
          border-radius: 10px;
          box-shadow: ${GRAPH_THEME.controls.shadow};
          overflow: hidden;
        }
        .builder-flow .react-flow__controls-button {
          background: ${GRAPH_THEME.controls.background};
          border-bottom: 1px solid ${GRAPH_THEME.controls.border};
          color: ${GRAPH_THEME.controls.text};
        }
        .builder-flow .react-flow__controls-button:hover {
          background: ${GRAPH_THEME.controls.hoverBackground};
        }
        .builder-flow .react-flow__controls-button svg {
          fill: ${GRAPH_THEME.controls.text};
        }
        .builder-flow .react-flow__attribution {
          display: none;
        }
      `}</style>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <marker
            id="agent-edge-circle"
            viewBox="-5 -5 10 10"
            refX="0"
            refY="0"
            markerUnits="strokeWidth"
            markerWidth="10"
            markerHeight="10"
            orient="auto"
          >
            <circle stroke={GRAPH_THEME.turboFlow.markerStroke} strokeOpacity="0.9" r="2" cx="0" cy="0" fill="none" />
          </marker>
          <marker
            id="agent-edge-circle-hot"
            viewBox="-5 -5 10 10"
            refX="0"
            refY="0"
            markerUnits="strokeWidth"
            markerWidth="10"
            markerHeight="10"
            orient="auto"
          >
            <circle stroke={GRAPH_THEME.turboFlow.markerHotStroke} strokeOpacity="0.92" r="2" cx="0" cy="0" fill="none" />
          </marker>
        </defs>
      </svg>
      {selectedEdge && onDeleteSelectedEdge ? (
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: 16,
            zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={() => onDeleteSelectedEdge()}
            style={graphPillButtonStyle({
              border: `1px solid ${GRAPH_THEME.accent.workflow}`,
              color: GRAPH_THEME.surface.text,
            })}
          >
            Delete Link
          </button>
        </div>
      ) : null}
      <div style={graphControlStackStyle}>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() =>
            reactFlowInstance?.zoomIn({
              duration: GRAPH_THEME.nav.zoomDurationMs,
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() =>
            reactFlowInstance?.zoomOut({
              duration: GRAPH_THEME.nav.zoomDurationMs,
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Fit view"
          onClick={() =>
            reactFlowInstance?.fitView({
              duration: GRAPH_THEME.nav.fitDurationMs,
              padding: GRAPH_THEME.nav.fitPadding,
              minZoom: GRAPH_THEME.nav.minZoom,
              maxZoom: GRAPH_THEME.nav.fitMaxZoom,
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2.25 5.25V2.25h3M8.75 2.25h3v3M11.75 8.75v3h-3M5.25 11.75h-3v-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label={layoutLocked ? 'Unlock graph layout' : 'Lock graph layout'}
          onClick={() => setLayoutLocked((current) => !current)}
          style={graphControlButtonStyle({
            color: layoutLocked
              ? GRAPH_THEME.accent.primary
              : GRAPH_THEME.controls.text,
          })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M4.5 6V4.75a2.5 2.5 0 1 1 5 0V6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
            <rect
              x="3"
              y="6"
              width="8"
              height="6"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Strict}
        minZoom={GRAPH_THEME.nav.minZoom}
        maxZoom={GRAPH_THEME.nav.maxZoom}
        preventScrolling
        panOnDrag
        panOnScroll
        selectionOnDrag={false}
        connectOnClick={false}
        deleteKeyCode={null}
        nodesDraggable={!layoutLocked}
        isValidConnection={(connection) => isPlainConnectionAllowed(connection, edges)}
        onInit={setReactFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onNodeClick={(_, node) => {
          canvasRef.current?.focus();
          onSelectEdge(null);
          onSelectCard(node.id);
        }}
        onNodeMouseEnter={(_, node) => setHoveredCardId(node.id)}
        onNodeMouseLeave={(_, node) =>
          setHoveredCardId((current) => (current === node.id ? null : current))
        }
        onEdgeClick={(_, edge) => {
          canvasRef.current?.focus();
          onSelectCard(null);
          onSelectEdge(edge.id);
        }}
        onPaneClick={() => {
          canvasRef.current?.focus();
          onSelectCard(null);
          onSelectEdge(null);
          setHoveredCardId(null);
        }}
        defaultEdgeOptions={{
          type: 'turboFlow',
          selectable: true,
          focusable: true,
          reconnectable: true,
          interactionWidth: 32,
          markerEnd: 'agent-edge-circle',
        }}
        snapToGrid
        snapGrid={[GRAPH_THEME.graphPaper.minorStep, GRAPH_THEME.graphPaper.minorStep]}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={GRAPH_THEME.graphPaper.minorStep}
          size={GRAPH_THEME.graphPaper.lineWidth}
          color={GRAPH_THEME.background.gridMinor}
        />
        <Background
          variant={BackgroundVariant.Lines}
          gap={GRAPH_THEME.graphPaper.majorStep}
          size={GRAPH_THEME.graphPaper.lineWidth}
          color={GRAPH_THEME.background.gridMajor}
        />
      </ReactFlow>
    </div>
  );
}
