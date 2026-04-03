import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  Controls,
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
import AgentCardNode from './nodes/AgentCardNode';

const nodeTypes = {
  agentCard: AgentCardNode,
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
  executionPlan: Pick<DeckExecutionPlan, 'simpleOrderCardIds' | 'startCardIds'> | null,
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
  return document.nodes.map((node) => ({
    id: node.id,
    type: 'agentCard',
    position: node.position,
    data: {
      ...node,
      executionOrder: executionOrderById.get(node.id) || null,
      isStartCard: startCardIds.has(node.id),
      isCallableHead: callableHeadIds.has(node.id),
      assistStructureMode: assistStructureSummaries.get(node.id)?.mode || null,
      swarmBadge: getAssistSwarmBadge(node),
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
};

function normalizeEdgeType(value: unknown): DeckEdgeType {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'graph_flow';
}

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'graph_flow') return 'graph_flow';
  return 'assistant_agent';
}

function isTopLevelCanvasCard(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(node && node.kind !== 'blackboard' && !String(node.parentGraphId || '').trim());
}

function isAssistCanvasCard(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(
    node &&
      node.kind !== 'blackboard' &&
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
    if (node.kind === 'blackboard' || normalizeRuntimeType(node.runtimeType) !== 'assistant_agent') {
      return;
    }
    summaries.set(node.id, {
      mode: 'single',
      incomingGraphFlowCount: 0,
      outgoingGraphFlowCount: 0,
    });
  });

  document.edges.forEach((edge) => {
    if (normalizeEdgeType(edge.edgeType) !== 'graph_flow') return;
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

export function getAssistSwarmBadge(node: AgentCardInstance): string | null {
  if (normalizeRuntimeType(node.runtimeType) !== 'assistant_agent') return null;
  if (node.runtimeOptions?.executionMode !== 'swarm') return null;
  const workerCount = Math.max(2, Math.min(Number(node.runtimeOptions?.swarmMaxWorkers) || 3, 6));
  return `Swarm x${workerCount}`;
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
    return 'graph_flow';
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

function toFlowEdges(document: DeckDocument, selectedEdgeId: string | null): Edge[] {
  const visualStates = buildDeckEdgeVisualStates(document);
  return document.edges.map((edge) => {
    const isSelected = edge.id === selectedEdgeId;
    const visualState = visualStates.get(edge.id) || {
      isLoopEdge: false,
      isReturnEdge: false,
      offset: 24,
      borderRadius: 14,
    };
    const edgeType = normalizeEdgeType(edge.edgeType);
    const stroke = isSelected
      ? 'rgba(79, 162, 173, 0.98)'
      : edgeType === 'magentic_option'
        ? 'rgba(96, 194, 255, 0.96)'
      : visualState.isLoopEdge
        ? 'rgba(217, 132, 88, 0.94)'
        : 'rgba(234, 146, 77, 0.94)';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        edgeType,
        metadata: edge.metadata || null,
      } satisfies FlowEdgeData,
      type: 'smoothstep',
      className: [
        visualState.isLoopEdge ? 'edge-loop' : null,
        visualState.isReturnEdge ? 'edge-return' : null,
        edgeType === 'magentic_option' ? 'edge-magentic-option' : 'edge-graph-flow',
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
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: stroke,
      },
      style: {
        stroke,
        strokeWidth: isSelected ? 3.2 : 2.2,
        strokeDasharray: visualState.isLoopEdge ? '10 7' : visualState.isReturnEdge ? '6 5' : undefined,
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
          'graph_flow',
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
        'graph_flow',
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
}) {
  const flowNodes = useMemo(
    () => toFlowNodes(document, selectedCardId, executionPlan),
    [document, executionPlan, selectedCardId],
  );
  const flowEdges = useMemo(
    () => toFlowEdges(document, selectedEdgeId),
    [document, selectedEdgeId],
  );
  const [nodes, setNodes] = useNodesState(flowNodes);
  const [edges, setEdges] = useEdgesState(flowEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewportRecoveryFrameRef = useRef<number | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
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
    const shouldPreferSelectedNode =
      reason === 'selection-change' || reason === 'node-drag-stop';

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
          duration: 220,
          padding: 1.0,
          minZoom: 0.28,
          maxZoom: 1.15,
        });
      } else {
        reactFlowInstance.fitView({ duration: 220, padding: 0.22, minZoom: 0.22, maxZoom: 1.35 });
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
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  useEffect(() => {
    if (!reactFlowInstance || !focusRequest) return;
    if (focusRequest.kind === 'deck') {
      reactFlowInstance.fitView({ duration: 260, padding: 0.22 });
      return;
    }
    const targetNode = nodes.find((node) => node.id === focusRequest.cardId);
    if (!targetNode) return;
    reactFlowInstance.fitView({
      nodes: [targetNode],
      duration: 260,
      padding: 1.1,
      maxZoom: 1.15,
    });
  }, [focusRequest, nodes, reactFlowInstance]);

  useEffect(() => {
    scheduleViewportRecovery('document-change');
  }, [document.version, nodes, reactFlowInstance, draggingNodeId]);

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
  }, [reactFlowInstance, nodes, draggingNodeId]);

  useEffect(() => {
    return () => {
      if (viewportRecoveryFrameRef.current != null) {
        window.cancelAnimationFrame(viewportRecoveryFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedEdgeId) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;

      const target = event.target as HTMLElement | null;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isTypingSurface =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable;
      if (isTypingSurface) return;

      event.preventDefault();
      setEdges((current) => {
        const next = current.filter((edge) => edge.id !== selectedEdgeId);
        if (next.length === current.length) return current;
        onPersistGraphMutation?.('canvas:edge-delete', {
          edgeId: selectedEdgeId,
          source: current.find((edge) => edge.id === selectedEdgeId)?.source || null,
          target: current.find((edge) => edge.id === selectedEdgeId)?.target || null,
        });
        setDocument((prev) => ({
          ...prev,
          version: prev.version + 1,
          edges: mergeFlowEdgesIntoDeck(next, prev.edges),
        }));
        onSelectEdge(null);
        return next;
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onPersistGraphMutation, onSelectEdge, selectedEdgeId, setDocument, setEdges]);

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
      edgeType: resolveCanvasConnectionEdgeType(document, connection) || 'graph_flow',
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
            'graph_flow',
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
            const edgeType = resolveCanvasConnectionEdgeType(document, connection) || 'graph_flow';
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
      const nextEdgeType = resolveCanvasConnectionEdgeType(document, newConnection) || 'graph_flow';
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
      style={{ position: 'relative' }}
    >
      <style>{`
        .builder-flow .react-flow__edge {
          cursor: pointer;
        }
        .builder-flow .react-flow__edge-path {
          transition: stroke 120ms ease, stroke-width 120ms ease, opacity 120ms ease;
        }
        .builder-flow .react-flow__edge:hover .react-flow__edge-path {
          stroke: rgba(212, 219, 228, 0.96);
          stroke-width: 2.8;
        }
        .builder-flow .react-flow__edge.selected .react-flow__edge-path,
        .builder-flow .react-flow__edge:focus .react-flow__edge-path {
          stroke: rgba(79, 162, 173, 0.98);
          stroke-width: 3.2;
        }
        .builder-flow .react-flow__edge.edge-loop .react-flow__edge-path {
          filter: drop-shadow(0 0 6px rgba(217, 132, 88, 0.18));
        }
        .builder-flow .react-flow__edge.edge-return .react-flow__edge-path {
          opacity: 0.96;
        }
        .builder-flow .react-flow__edge.edge-magentic-option .react-flow__edge-path {
          opacity: 0.98;
        }
        .builder-flow .react-flow__edge.edge-graph-flow .react-flow__edge-path {
          opacity: 0.96;
        }
        .builder-flow .react-flow__handle {
          transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
        }
        .builder-flow .react-flow__handle:hover,
        .builder-flow .react-flow__handle.connectionindicator {
          transform: scale(1.14);
          box-shadow: 0 0 0 4px rgba(79, 162, 173, 0.12);
        }
        .builder-flow .react-flow__connection-path {
          stroke: rgba(79, 162, 173, 0.92);
          stroke-width: 2.8;
        }
        .builder-flow .react-flow__edge-interaction {
          cursor: pointer;
        }
        .builder-flow .react-flow__controls {
          background: #171717;
          border: 1px solid #2f3437;
          border-radius: 8px;
          box-shadow: none;
          overflow: hidden;
        }
        .builder-flow .react-flow__controls-button {
          background: #171717;
          border-bottom: 1px solid #2f3437;
          color: #e6e6e6;
        }
        .builder-flow .react-flow__controls-button:hover {
          background: #222629;
        }
        .builder-flow .react-flow__controls-button svg {
          fill: #e6e6e6;
        }
        .builder-flow .react-flow__attribution {
          display: none;
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 16,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => reactFlowInstance?.fitView({ duration: 220, padding: 0.22 })}
          style={{
            padding: '7px 10px',
            borderRadius: 999,
            border: '1px solid rgba(79, 162, 173, 0.38)',
            background: 'rgba(17, 17, 17, 0.94)',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            boxShadow: '0 16px 36px rgba(0,0,0,0.18)',
            backdropFilter: 'blur(8px)',
          }}
        >
          Fit Flow
        </button>
        {selectedEdge && onDeleteSelectedEdge ? (
          <button
            type="button"
            onClick={() => onDeleteSelectedEdge()}
            style={{
              padding: '7px 10px',
              borderRadius: 999,
              border: '1px solid rgba(217,132,88,0.36)',
              background: 'rgba(17, 17, 17, 0.94)',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              boxShadow: '0 16px 36px rgba(0,0,0,0.18)',
              backdropFilter: 'blur(8px)',
            }}
          >
            Delete Link
          </button>
        ) : null}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Strict}
        minZoom={0.22}
        maxZoom={1.6}
        translateExtent={translateExtent}
        preventScrolling
        connectOnClick={false}
        deleteKeyCode={null}
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
          onSelectEdge(null);
          onSelectCard(node.id);
        }}
        onEdgeClick={(_, edge) => {
          onSelectCard(null);
          onSelectEdge(edge.id);
        }}
        onPaneClick={() => {
          onSelectEdge(null);
        }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          selectable: true,
          focusable: true,
          reconnectable: true,
          interactionWidth: 32,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: 'rgba(118, 126, 138, 0.92)',
          },
        }}
        snapToGrid
        snapGrid={[24, 24]}
        fitViewOptions={{ padding: 0.22, minZoom: 0.22, maxZoom: 1.35 }}
        fitView
      >
        <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="rgba(73, 82, 91, 0.42)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
