import { useEffect, useMemo, useRef, useState } from 'react';
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
import { GRAPH_THEME, graphControlButtonStyle, graphControlStackStyle, graphPillButtonStyle } from '../graph/graphVisualTokens';
import {
  GRAPH_WORKSPACE,
  buildFocusedNodeSet,
  buildUndirectedNeighborMap,
  isEdgeConnectedToNode,
} from '../graph/graphWorkspaceContract';
import TurboFlowEdge from './edges/TurboFlowEdge';
import AgentCardNode from './nodes/AgentCardNode';

const nodeTypes = {
  agentCard: AgentCardNode,
};
const edgeTypes = {
  turboFlow: TurboFlowEdge,
};

const DEV_MODE = import.meta.env.DEV;
const PERSISTED_NODE_CHANGE_TYPES = new Set<NodeChange['type']>(['add', 'remove', 'replace', 'position']);
const PERSISTED_EDGE_CHANGE_TYPES = new Set<EdgeChange['type']>(['add', 'remove', 'replace']);
const FALLBACK_NODE_WIDTH = 320;
const FALLBACK_NODE_HEIGHT = 180;

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

function buildViewportTranslateExtent(nodes: Node[]): [[number, number], [number, number]] {
  if (nodes.length === 0) {
    return [[-4000, -4000], [4000, 4000]];
  }

  const padding = 420;
  const minX = Math.min(...nodes.map((node) => node.position.x)) - padding;
  const minY = Math.min(...nodes.map((node) => node.position.y)) - padding;
  const maxX = Math.max(...nodes.map((node) => node.position.x)) + 420 + padding;
  const maxY = Math.max(...nodes.map((node) => node.position.y)) + 260 + padding;

  return [[minX, minY], [maxX, maxY]];
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

function toFlowNodes(
  document: DeckDocument,
  selectedCardId: string | null,
  selectedEdgeId: string | null,
  hoveredCardId: string | null,
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
  return document.nodes.map((node) => ({
    id: node.id,
    type: 'agentCard',
    position: node.position,
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
  return 'assistant_agent';
}

function isTopLevelCanvasCard(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(node && !String(node.parentGraphId || '').trim());
}

function isAssistCanvasCard(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(
    node &&
      normalizeRuntimeType(node.runtimeType) === 'assistant_agent',
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
    if (normalizeRuntimeType(node.runtimeType) !== 'assistant_agent') {
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
    sourceRuntimeType === 'magentic_one' &&
    isTopLevelCanvasCard(sourceNode) &&
    isTopLevelCanvasCard(targetNode) &&
    (targetRuntimeType === 'assistant_agent' || targetRuntimeType === 'graph_flow')
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
  const visualStates = buildDeckEdgeVisualStates(document);
  return document.edges.map((edge) => {
    const isSelected = edge.id === selectedEdgeId;
    const isHoverConnected = isEdgeConnectedToNode(edge.source, edge.target, hoveredCardId);
    const isActive = activeEdgeIds.has(edge.id);
    const visualState = visualStates.get(edge.id) || {
      isLoopEdge: false,
      isReturnEdge: false,
      offset: 24,
      borderRadius: 14,
    };
    const edgeType = normalizeEdgeType(edge.edgeType);
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
        isLoopEdge: visualState.isLoopEdge,
        isReturnEdge: visualState.isReturnEdge,
      } satisfies FlowEdgeData,
      type: 'turboFlow',
      className: [
        isActive ? 'edge-active' : null,
        isSelected ? 'edge-selected' : null,
        visualState.isLoopEdge ? 'edge-loop' : null,
        visualState.isReturnEdge ? 'edge-return' : null,
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
        offset: visualState.offset,
        borderRadius: visualState.borderRadius,
      },
      markerEnd: isActive || visualState.isLoopEdge || visualState.isReturnEdge ? 'agent-edge-circle-hot' : 'agent-edge-circle',
      style: {
        strokeWidth: isActive ? 2.85 : isSelected ? 2.5 : hoveredCardId && isHoverConnected ? 2.35 : 2.05,
        opacity: isActive ? 1 : hoveredCardId ? (isHoverConnected ? 0.96 : 0.3) : 1,
      },
    };
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
  focusRequest,
  executionPlan,
  activeCardIds = [],
  activeEdgeIds = [],
  swarmProgressByCardId = {},
  miniMode = false,
}: {
  document: DeckDocument;
  setDocument: Dispatch<SetStateAction<DeckDocument>>;
  onPersistGraphMutation?: (reason: string, detail?: Record<string, unknown>) => void;
  selectedCardId: string | null;
  selectedEdgeId: string | null;
  onSelectCard: (cardId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onDeleteSelectedEdge?: () => void;
  focusRequest: BuilderCanvasFocusRequest | null;
  executionPlan: Pick<DeckExecutionPlan, 'simpleOrderCardIds' | 'startCardIds'> | null;
  activeCardIds?: string[];
  activeEdgeIds?: string[];
  swarmProgressByCardId?: Record<string, { completed: number; total: number }>;
  miniMode?: boolean;
}) {
  const activeCardIdSet = useMemo(() => new Set(activeCardIds), [activeCardIds]);
  const activeEdgeIdSet = useMemo(() => new Set(activeEdgeIds), [activeEdgeIds]);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [layoutLocked, setLayoutLocked] = useState(false);
  const flowNodes = useMemo(
    () =>
      toFlowNodes(
        document,
        selectedCardId,
        selectedEdgeId,
        hoveredCardId,
        executionPlan,
        activeCardIdSet,
        activeEdgeIdSet,
        swarmProgressByCardId,
      ),
    [activeCardIdSet, activeEdgeIdSet, document, executionPlan, hoveredCardId, selectedCardId, selectedEdgeId, swarmProgressByCardId],
  );
  const flowEdges = useMemo(
    () => toFlowEdges(document, selectedEdgeId, hoveredCardId, activeEdgeIdSet),
    [activeEdgeIdSet, document, hoveredCardId, selectedEdgeId],
  );
  const [nodes, setNodes] = useNodesState(flowNodes);
  const [edges, setEdges] = useEdgesState(flowEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewportRecoveryFrameRef = useRef<number | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const documentRecoveryKey = useMemo(() => buildCanvasDocumentRecoveryKey(document), [document]);
  const selectedEdge = useMemo(
    () => document.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [document.edges, selectedEdgeId],
  );
  const translateExtent = useMemo(() => buildViewportTranslateExtent(nodes), [nodes]);

  const recoverViewportIfGraphLost = (reason: string) => {
    if (draggingNodeId) return;
    if (!reactFlowInstance || !reactFlowInstance.viewportInitialized || nodes.length === 0) return;
    const viewportHost = canvasRef.current;
    if (!viewportHost) return;

    const viewport = reactFlowInstance.getViewport();
    const zoom = viewport.zoom || 1;
    const visibleRect = {
      left: -viewport.x / zoom,
      top: -viewport.y / zoom,
      right: (viewportHost.clientWidth - viewport.x) / zoom,
      bottom: (viewportHost.clientHeight - viewport.y) / zoom,
    };
    const selectedNode = selectedCardId ? nodes.find((node) => node.id === selectedCardId) || null : null;

    const graphBounds = reactFlowInstance.getNodesBounds(nodes);
    if (!Number.isFinite(graphBounds.x) || !Number.isFinite(graphBounds.y)) return;
    const graphVisible = isAnyCanvasNodeVisible(nodes, visibleRect, 28 / zoom);

    const selectedNodeBounds = selectedNode ? getNodeCanvasRect(selectedNode) : null;
    const selectedNodeVisible = selectedNodeBounds
      ? isCanvasRectVisible(selectedNodeBounds, visibleRect, 20 / zoom)
      : true;
    // Selection-based fitView is a common source of "camera jump" regressions.
    // Only recover if the graph is actually offscreen, or after a node drag.
    const shouldPreferSelectedNode = reason === 'node-drag-stop';

    if (!graphVisible || (shouldPreferSelectedNode && !selectedNodeVisible)) {
      if (DEV_MODE) {
        console.debug('[builder] recovering lost viewport', {
          reason,
          viewport,
          visibleRect,
          graphBounds,
          selectedNodeBounds,
          graphVisible,
          selectedNodeVisible,
          selectedCardId,
          draggingNodeId,
          shouldPreferSelectedNode,
        });
      }
      if (selectedNode && shouldPreferSelectedNode && !selectedNodeVisible) {
        reactFlowInstance.fitView({
          nodes: [selectedNode],
          duration: GRAPH_THEME.nav.fitDurationMs,
          padding: 1.0,
          minZoom: GRAPH_THEME.nav.minZoom,
          maxZoom: GRAPH_THEME.nav.focusMaxZoom,
        });
      } else {
        reactFlowInstance.fitView({
          duration: GRAPH_THEME.nav.fitDurationMs,
          padding: GRAPH_THEME.nav.fitPadding,
          minZoom: GRAPH_THEME.nav.minZoom,
          maxZoom: GRAPH_THEME.nav.fitMaxZoom,
        });
      }
    }
  };

  const scheduleViewportRecovery = (reason: string) => {
    if (viewportRecoveryFrameRef.current != null) {
      window.cancelAnimationFrame(viewportRecoveryFrameRef.current);
    }
    viewportRecoveryFrameRef.current = window.requestAnimationFrame(() => {
      viewportRecoveryFrameRef.current = null;
      recoverViewportIfGraphLost(reason);
    });
  };

  useEffect(() => {
    setNodes((current) => syncFlowNodesForRender(current, flowNodes));
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges((current) => syncFlowEdgesForRender(current, flowEdges));
  }, [flowEdges, setEdges]);

  useEffect(() => {
    if (!reactFlowInstance || !focusRequest) return;
    if (focusRequest.kind === 'deck') {
      reactFlowInstance.fitView({
        duration: GRAPH_THEME.nav.focusDurationMs,
        padding: GRAPH_THEME.nav.fitPadding,
        minZoom: GRAPH_THEME.nav.minZoom,
        maxZoom: GRAPH_THEME.nav.fitMaxZoom,
      });
      return;
    }
    const targetNode = nodes.find((node) => node.id === focusRequest.cardId);
    if (!targetNode) return;
    reactFlowInstance.fitView({
      nodes: [targetNode],
      duration: GRAPH_THEME.nav.focusDurationMs,
      padding: 1.1,
      maxZoom: GRAPH_THEME.nav.focusMaxZoom,
    });
  }, [focusRequest, nodes, reactFlowInstance]);

  useEffect(() => {
    // Hover and selection restyle the controlled flow nodes, but they do not change
    // the actual deck layout. Recovery should only follow real document changes.
    scheduleViewportRecovery('document-change');
  }, [documentRecoveryKey, reactFlowInstance, draggingNodeId]);

  useEffect(() => {
    scheduleViewportRecovery('selection-change');
  }, [selectedCardId, reactFlowInstance, draggingNodeId]);

  useEffect(() => {
    const viewportHost = canvasRef.current;
    if (!viewportHost || !reactFlowInstance) return;

    const scheduleRecovery = () => {
      scheduleViewportRecovery('canvas-resize');
    };

    const observer = new ResizeObserver(() => scheduleRecovery());
    observer.observe(viewportHost);
    window.addEventListener('resize', scheduleRecovery);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleRecovery);
    };
  }, [reactFlowInstance, documentRecoveryKey, draggingNodeId]);

  useEffect(() => {
    return () => {
      if (viewportRecoveryFrameRef.current != null) {
        window.cancelAnimationFrame(viewportRecoveryFrameRef.current);
      }
    };
  }, []);

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
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      const hasPersistedNodeChange = shouldPersistNodeChanges(changes);
      if (hasPersistedNodeChange) {
        onPersistGraphMutation?.('canvas:nodes', {
          changeTypes: changes.map((change) => change.type),
        });
        setDocument((prev) => ({
          ...prev,
          version: prev.version + 1,
          nodes: mergeFlowNodesIntoDeck(next, prev.nodes),
        }));
      } else if (DEV_MODE && changes.every((change) => change.type === 'select')) {
        console.debug('[builder] ignored node selection-only canvas change', {
          changeTypes: changes.map((change) => change.type),
        });
      }
      return next;
    });
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      const hasPersistedEdgeChange = shouldPersistEdgeChanges(changes);
      if (hasPersistedEdgeChange) {
        onPersistGraphMutation?.('canvas:edges', {
          changeTypes: changes.map((change) => change.type),
        });
        setDocument((prev) => ({
          ...prev,
          version: prev.version + 1,
          edges: mergeFlowEdgesIntoDeck(next, prev.edges),
        }));
      } else if (DEV_MODE && changes.every((change) => change.type === 'select')) {
        console.debug('[builder] ignored edge selection-only canvas change', {
          changeTypes: changes.map((change) => change.type),
        });
      }
      return next;
    });
  };

  const onConnect = (connection: Connection) => {
    setEdges((current) => {
      if (!isPlainConnectionAllowed(connection, current)) return current;

      const next = addEdge(
        {
          ...connection,
          id: `edge_${Math.random().toString(36).slice(2, 10)}`,
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
      onPersistGraphMutation?.('canvas:connect', {
        source: connection.source,
        target: connection.target,
      });
      setDocument((prev) => ({
        ...prev,
        version: prev.version + 1,
        edges: mergeFlowEdgesIntoDeck(next, prev.edges),
      }));
      return next;
    });
  };

  const onReconnect: OnReconnect<Edge> = (oldEdge, newConnection) => {
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
      onPersistGraphMutation?.('canvas:reconnect', {
        edgeId: oldEdge.id,
        source: newConnection.source,
        target: newConnection.target,
      });
      setDocument((prev) => ({
        ...prev,
        version: prev.version + 1,
        edges: mergeFlowEdgesIntoDeck(next, prev.edges),
      }));
      onSelectCard(null);
      onSelectEdge(oldEdge.id);
      return next;
    });
  };

  return (
    <div
      ref={canvasRef}
      className="builder-flow h-full w-full"
      style={{ position: 'relative', background: GRAPH_THEME.background.agentSurface }}
      tabIndex={miniMode ? -1 : 0}
      onKeyDown={(event) => {
        if (miniMode) return;
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
        @keyframes agent-turbo-flow-dash {
          to {
            stroke-dashoffset: -80;
          }
        }
        .builder-flow .react-flow__edge {
          cursor: pointer;
          transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .builder-flow .react-flow__edge:hover {
          opacity: 1;
        }
        .builder-flow .react-flow__edge.selected,
        .builder-flow .react-flow__edge.edge-selected {
          filter: drop-shadow(0 0 5px rgba(79, 162, 173, 0.12));
        }
        .builder-flow .react-flow__edge.edge-active {
          filter: drop-shadow(0 0 7px rgba(79, 162, 173, 0.16)) drop-shadow(0 0 4px rgba(223, 146, 84, 0.1));
        }
        .builder-flow .react-flow__edge.edge-loop,
        .builder-flow .react-flow__edge.edge-return {
          filter: drop-shadow(0 0 5px rgba(223, 146, 84, 0.12));
        }
        .builder-flow .react-flow__node {
          transition: filter 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .builder-flow .react-flow__node.selected {
          filter: drop-shadow(0 0 8px rgba(79, 162, 173, 0.12));
        }
        .builder-flow .react-flow__handle {
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .builder-flow .react-flow__handle:hover,
        .builder-flow .react-flow__handle.connectionindicator {
          transform: scale(1.06);
          box-shadow:
            0 0 0 2px rgba(79, 162, 173, 0.14),
            0 0 0 5px rgba(140, 116, 204, 0.08);
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
          <linearGradient id="agent-edge-gradient-intelligence" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={GRAPH_THEME.turboFlow.intelligenceGradientStart} />
            <stop offset="61.8%" stopColor={GRAPH_THEME.turboFlow.intelligenceGradientMid} />
            <stop offset="100%" stopColor={GRAPH_THEME.turboFlow.intelligenceGradientEnd} />
          </linearGradient>
          <linearGradient id="agent-edge-gradient-execution" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={GRAPH_THEME.turboFlow.executionGradientStart} />
            <stop offset="61.8%" stopColor={GRAPH_THEME.turboFlow.executionGradientMid} />
            <stop offset="100%" stopColor={GRAPH_THEME.turboFlow.executionGradientEnd} />
          </linearGradient>
          <linearGradient id="agent-edge-gradient-memory" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={GRAPH_THEME.turboFlow.memoryGradientStart} />
            <stop offset="61.8%" stopColor={GRAPH_THEME.turboFlow.memoryGradientMid} />
            <stop offset="100%" stopColor={GRAPH_THEME.turboFlow.memoryGradientEnd} />
          </linearGradient>
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
          onClick={() => reactFlowInstance?.zoomIn({ duration: GRAPH_THEME.nav.zoomDurationMs })}
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => reactFlowInstance?.zoomOut({ duration: GRAPH_THEME.nav.zoomDurationMs })}
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
        >
          −
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
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
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
            color: layoutLocked ? GRAPH_THEME.accent.primary : GRAPH_THEME.controls.text,
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
            <rect x="3" y="6" width="8" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
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
        translateExtent={translateExtent}
        preventScrolling
        connectOnClick={false}
        deleteKeyCode={null}
        nodesDraggable={!layoutLocked}
        isValidConnection={(connection) => isPlainConnectionAllowed(connection, edges)}
        onInit={setReactFlowInstance}
        onNodeDragStart={(_, node) => {
          setDraggingNodeId(node.id);
        }}
        onNodeDragStop={(_, node) => {
          setDraggingNodeId((current) => (current === node.id ? null : current));
          scheduleViewportRecovery('node-drag-stop');
        }}
        onMoveEnd={() => scheduleViewportRecovery('move-end')}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onNodeClick={(_, node) => {
          if (miniMode) return;
          canvasRef.current?.focus();
          onSelectEdge(null);
          onSelectCard(node.id);
        }}
        onNodeMouseEnter={(_, node) => setHoveredCardId(node.id)}
        onNodeMouseLeave={(_, node) =>
          setHoveredCardId((current) => (current === node.id ? null : current))
        }
        onEdgeClick={(_, edge) => {
          if (miniMode) return;
          canvasRef.current?.focus();
          onSelectCard(null);
          onSelectEdge(edge.id);
        }}
        onPaneClick={() => {
          canvasRef.current?.focus();
          if (!miniMode) {
            onSelectCard(null);
            onSelectEdge(null);
          }
          setHoveredCardId(null);
        }}
        defaultEdgeOptions={{
          type: 'turboFlow',
          selectable: !miniMode,
          focusable: !miniMode,
          reconnectable: !miniMode,
          interactionWidth: miniMode ? 12 : 32,
          markerEnd: 'agent-edge-circle',
        }}
        snapToGrid
        snapGrid={[GRAPH_WORKSPACE.worldGridGap, GRAPH_WORKSPACE.worldGridGap]}
        fitViewOptions={{
          padding: GRAPH_THEME.nav.fitPadding,
          minZoom: GRAPH_THEME.nav.minZoom,
          maxZoom: GRAPH_THEME.nav.fitMaxZoom,
        }}
        fitView
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={GRAPH_WORKSPACE.worldGridGap}
          size={GRAPH_WORKSPACE.worldGridLineWidth}
          color={GRAPH_THEME.background.grid}
        />
      </ReactFlow>
    </div>
  );
}
