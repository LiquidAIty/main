import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  applyNodeChanges,
  useNodesState,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type Node,
  type NodeChange,
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
import {
  buildSemanticRelationshipIdentityKey,
  buildDefaultDeckEdgeMetadata,
  isMagOneMembershipSourceHandle,
  resolveSemanticConnection,
  SEMANTIC_HANDLE_IDS,
} from './deckValidation';
import { normalizeDeckEdgeType } from '../../features/agentbuilder/deck/deckPrimitives';
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
  graphPillButtonStyle,
} from '../graph/graphVisualTokens';
import { buildPresentationLandingViewport } from '../../features/agentbuilder/core/agentBuilderViewportMath';
import {
  GRAPH_WORKSPACE,
  buildFocusedNodeSet,
  buildUndirectedNeighborMap,
  isEdgeConnectedToNode,
} from '../graph/graphWorkspaceContract';
import TurboFlowEdge from './edges/TurboFlowEdge';
import AgentCardNode from './nodes/AgentCardNode';
import MagenticBusNode from './nodes/MagenticBusNode';

const DEV_MODE = import.meta.env.DEV;
const PERSISTED_NODE_CHANGE_TYPES = new Set<NodeChange['type']>(['add', 'remove', 'replace', 'position']);
const FALLBACK_NODE_WIDTH = 144;
const FALLBACK_NODE_HEIGHT = 88;

const nodeTypes = {
  agentCard: AgentCardNode,
  magenticBus: MagenticBusNode,
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
      edgeType: normalizeDeckEdgeType(edge.edgeType),
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

export function toFlowNodes(
  document: DeckDocument,
  selectedCardId: string | null,
  hoveredCardId: string | null,
  inspectMode: boolean,
  activeCardIds: Set<string>,
): Node[] {
  const neighborsByNode = buildUndirectedNeighborMap(
    document.nodes.map((node) => node.id),
    document.edges.map((edge) => ({ source: edge.source, target: edge.target })),
  );
  const hoveredRelatedNodeIds = buildFocusedNodeSet(hoveredCardId, neighborsByNode);
  return document.nodes.map((node) => {
    const isMagenticBus = normalizeRuntimeType(node.runtimeType) === 'magentic_one';
    return {
      id: node.id,
      type: isMagenticBus ? 'magenticBus' : 'agentCard',
      position: node.position,
      draggable: !isMagenticBus,
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
        isRuntimeActive: activeCardIds.has(node.id),
        isInspecting: inspectMode && selectedCardId === node.id,
      },
      selected: node.id === selectedCardId,
    };
  });
}

type DeckEdgeVisualState = {
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

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'graph_flow') return 'graph_flow';
  if (normalized === 'local_coder') return 'local_coder';
  return 'assistant_agent';
}

/** Classify a user-drawn connection into the REAL runtime edge types:
 * semantic handles are the persisted relationship contract; source/target
 * authority is never inferred from card position. */
export function resolveCanvasConnectionEdgeType(
  document: DeckDocument,
  connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
): DeckEdgeType | null {
  return resolveSemanticConnection(document, {
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
  })?.edgeType ?? null;
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
    const isActive = activeEdgeIds.has(edge.id);
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    const sourceNode = nodeById.get(edge.source) as AgentCardInstance | undefined;
    const targetNode = nodeById.get(edge.target) as AgentCardInstance | undefined;
    if (!sourceNode || !targetNode) return [];
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? undefined,
      target: edge.target,
      targetHandle: edge.targetHandle ?? undefined,
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
        edgeType === 'magentic_option'
          ? 'edge-magentic-option'
          : edgeType === 'magentic_control'
            ? 'edge-magentic-control'
            : edgeType === 'invalid'
              ? 'edge-invalid'
              : 'edge-flow',
      ]
        .filter(Boolean)
        .join(' '),
      selected: isSelected,
      selectable: true,
      focusable: true,
      reconnectable: false,
      interactionWidth: 32,
      pathOptions: {
        offset: 24,
        borderRadius: 14,
      },
      markerEnd: edgeType === 'magentic_option' ? undefined : 'agent-edge-arrow',
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

export function reduceCanvasNodeChanges(
  changes: NodeChange[],
  currentNodes: Node[],
): { nextNodes: Node[]; nextNodesForPersistence: Node[] | null } {
  const nextNodes = applyNodeChanges(changes, currentNodes);
  return {
    nextNodes,
    nextNodesForPersistence: shouldPersistNodeChanges(changes) ? nextNodes : null,
  };
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

export function isPlainConnectionAllowedForDocument(
  document: DeckDocument,
  connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
  currentEdges: Edge[],
  ignoreEdgeId?: string,
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;
  const resolved = resolveSemanticConnection(document, {
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
  });
  if (!resolved) return false;

  const nextEdgeKey = buildSemanticRelationshipIdentityKey(resolved);

  return !currentEdges.some((edge) => {
    if (edge.id === ignoreEdgeId) return false;
    if (!edge.source || !edge.target) return false;
    return (
      buildSemanticRelationshipIdentityKey({
        source: edge.source,
        target: edge.target,
        edgeType:
          ((edge.data as { edgeType?: DeckEdgeType | null } | undefined)?.edgeType as DeckEdgeType | null | undefined) ??
          'flow',
      }) === nextEdgeKey
    );
  });
}

export function buildDeckEdgeFromConnection(
  document: Pick<DeckDocument, 'nodes'>,
  connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
  edgeId: string,
): DeckEdge | null {
  const resolved = resolveSemanticConnection(document, {
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
  });
  if (!resolved) return null;
  const metadata = buildDefaultDeckEdgeMetadata(resolved.edgeType);
  return {
    id: edgeId,
    source: resolved.source,
    sourceHandle: resolved.sourceHandle,
    target: resolved.target,
    targetHandle: resolved.targetHandle,
    edgeType: resolved.edgeType,
    ...(metadata ? { metadata } : {}),
  };
}

export function applyDeckDocumentMutation(
  document: DeckDocument,
  mutation: (current: DeckDocument) => DeckDocument,
): DeckDocument {
  const next = mutation(document);
  if (next === document) return document;
  return {
    ...next,
    version: document.version + 1,
  };
}

export function removeCardAndConnectedEdges(
  document: DeckDocument,
  cardId: string,
): DeckDocument {
  if (!document.nodes.some((node) => node.id === cardId)) return document;
  return applyDeckDocumentMutation(document, (current) => ({
    ...current,
    nodes: current.nodes.filter((node) => node.id !== cardId),
    edges: current.edges.filter((edge) => edge.source !== cardId && edge.target !== cardId),
  }));
}

export function isCanvasTextEditingTarget(target: EventTarget | null): boolean {
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  } | null;
  if (!element) return false;
  const tagName = String(element.tagName || '').toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (element.isContentEditable) return true;
  return Boolean(element.closest?.('[contenteditable="true"]'));
}

export function isProtectedCanvasCard(card: AgentCardInstance): boolean {
  const binding = String(card.runtimeBinding || '').trim();
  const runtimeType = normalizeRuntimeType(card.runtimeType);
  return (
    card.id === 'card_main_chat' ||
    card.id === 'card_magentic' ||
    card.id === 'card_hermes_steward' ||
    card.id === 'card_local_coder' ||
    binding === 'main_chat' ||
    binding === 'hermes_steward' ||
    binding === 'local_coder' ||
    runtimeType === 'magentic_one' ||
    runtimeType === 'local_coder'
  );
}

export function confirmCanvasCardDeletion(
  card: AgentCardInstance,
  connectedEdgeCount: number,
  confirmDelete: (message: string) => boolean,
  promptDelete: (message: string) => string | null,
): boolean {
  const title = String(card.title || card.id).trim() || card.id;
  const edgeWarning = `${connectedEdgeCount} connected edge${connectedEdgeCount === 1 ? '' : 's'} will also be removed.`;
  if (!isProtectedCanvasCard(card)) {
    return confirmDelete(`Delete “${title}”? ${edgeWarning} This cannot be undone.`);
  }
  const requiredText = `DELETE ${title}`;
  return promptDelete(
    `Protected card: ${title}. ${edgeWarning} Type ${requiredText} to delete it.`,
  ) === requiredText;
}

function SemanticConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromHandle,
}: ConnectionLineComponentProps) {
  const handleId = String(fromHandle?.id || '').trim();
  const label = isMagOneMembershipSourceHandle(handleId)
    ? 'Add to Mag One team'
    : handleId === SEMANTIC_HANDLE_IDS.magOneControlOutput
      ? 'Submit to Mag One'
      : handleId === SEMANTIC_HANDLE_IDS.hermesObserveOutput
        ? 'Allow Hermes observation'
        : 'Direct call';
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  return (
    <g>
      <path
        d={`M ${fromX},${fromY} L ${toX},${toY}`}
        fill="none"
        stroke={GRAPH_THEME.accent.primary}
        strokeWidth={2.35}
      />
      <text
        x={midX}
        y={midY - 8}
        textAnchor="middle"
        fill={GRAPH_THEME.surface.text}
        fontSize="11"
        style={{ paintOrder: 'stroke', stroke: GRAPH_THEME.background.agentSurface, strokeWidth: 4 }}
      >
        {label}
      </text>
    </g>
  );
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
  activeCardIds = [],
  activeEdgeIds = [],
  inspectMode = false,
  presentationViewportKey = null,
  focusZone = null,
  autosaveConflictMessage = null,
  onReloadSavedDeck,
}: {
  document: DeckDocument;
  setDocument: Dispatch<SetStateAction<DeckDocument>>;
  onPersistGraphMutation?: (reason: string, detail?: Record<string, unknown>) => void;
  selectedCardId: string | null;
  selectedEdgeId: string | null;
  onSelectCard: (cardId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onDeleteSelectedEdge?: () => void;
  activeCardIds?: string[];
  activeEdgeIds?: string[];
  inspectMode?: boolean;
  presentationViewportKey?: string | number | null;
  // Camera focus zone from the left rail (camera-only): pan/zoom to fit the
  // agent/bus nodes. Never hides any node.
  focusZone?: { zone: 'agents'; nonce: number } | null;
  autosaveConflictMessage?: string | null;
  onReloadSavedDeck?: () => void;
}) {
  const activeCardIdSet = useMemo(() => new Set(activeCardIds), [activeCardIds]);
  const activeEdgeIdSet = useMemo(() => new Set(activeEdgeIds), [activeEdgeIds]);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [layoutLocked, setLayoutLocked] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const initialViewportAppliedRef = useRef(false);
  const flowNodes = useMemo(
    () =>
      toFlowNodes(
        document,
        selectedCardId,
        hoveredCardId,
        inspectMode,
        activeCardIdSet,
      ),
    [activeCardIdSet, document, hoveredCardId, inspectMode, selectedCardId],
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
  const edges = flowEdges;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const latestDocumentRef = useRef(document);
  const latestFlowNodesRef = useRef(nodes);
  const selectedEdge = useMemo(
    () => document.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [document.edges, selectedEdgeId],
  );

  useEffect(() => {
    latestDocumentRef.current = document;
  }, [document]);

  useEffect(() => {
    setNodes((current) => syncFlowNodesForRender(current, flowNodes));
  }, [flowNodes, setNodes]);

  useEffect(() => {
    latestFlowNodesRef.current = nodes;
  }, [nodes]);

  // Left-rail camera: pan/zoom to fit the agent/bus nodes on the scene.
  useEffect(() => {
    if (!reactFlowInstance || !focusZone) return;
    const frame = window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({ duration: 500, padding: 0.2 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusZone, reactFlowInstance]);

  useEffect(() => {
    if (!reactFlowInstance) return;
    if (flowNodes.length === 0) return;
    if (initialViewportAppliedRef.current) return;
    initialViewportAppliedRef.current = true;
    const landingViewport = buildPresentationLandingViewport(
      document,
      canvasRef.current,
      GRAPH_WORKSPACE.landingBaselineZoom,
    );
    const frame = window.requestAnimationFrame(() => {
      if (landingViewport) {
        reactFlowInstance.setViewport(landingViewport, { duration: 0 });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [document, flowNodes.length, reactFlowInstance]);

  useEffect(() => {
    if (!reactFlowInstance) return;
    if (!initialViewportAppliedRef.current) return;
    if (flowNodes.length === 0) return;
    if (presentationViewportKey == null) return;
    const frame = window.requestAnimationFrame(() => {
      const landingViewport = buildPresentationLandingViewport(
        latestDocumentRef.current,
        canvasRef.current,
        GRAPH_WORKSPACE.landingBaselineZoom,
      );
      if (landingViewport) {
        reactFlowInstance.setViewport(landingViewport, { duration: 0 });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [flowNodes.length, presentationViewportKey, reactFlowInstance]);

  const isPlainConnectionAllowed = (
    connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
    currentEdges: Edge[],
    ignoreEdgeId?: string,
  ): boolean => isPlainConnectionAllowedForDocument(document, connection, currentEdges, ignoreEdgeId);

  const onNodesChange = (changes: NodeChange[]) => {
    const reduced = reduceCanvasNodeChanges(changes, latestFlowNodesRef.current);
    latestFlowNodesRef.current = reduced.nextNodes;
    setNodes(reduced.nextNodes);
    if (!reduced.nextNodesForPersistence) {
      if (DEV_MODE && changes.every((change) => change.type === 'select')) {
        console.debug('[builder] ignored node selection-only canvas change', {
          changeTypes: changes.map((change) => change.type),
        });
      }
      return;
    }
    onPersistGraphMutation?.('canvas:nodes', {
      changeTypes: changes.map((change) => change.type),
    });
    setDocument((prev) =>
      applyDeckDocumentMutation(prev, (current) => ({
        ...current,
        nodes: mergeFlowNodesIntoDeck(
          reduced.nextNodesForPersistence as Node[],
          current.nodes,
        ),
      })),
    );
  };

  const commitConnection = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (!isPlainConnectionAllowedForDocument(document, connection, edges)) return;
    const edgeId = `edge_${Math.random().toString(36).slice(2, 10)}`;
    const nextDeckEdge = buildDeckEdgeFromConnection(document, connection, edgeId);
    if (!nextDeckEdge) return;
    onPersistGraphMutation?.('canvas:connect', {
      source: nextDeckEdge.source,
      target: nextDeckEdge.target,
      edgeType: nextDeckEdge.edgeType,
    });
    setDocument((prev) => {
      const nextEdgeKey = buildSemanticRelationshipIdentityKey(nextDeckEdge);
      if (prev.edges.some((edge) => buildSemanticRelationshipIdentityKey(edge) === nextEdgeKey)) {
        return prev;
      }
      return applyDeckDocumentMutation(prev, (current) => ({
        ...current,
        edges: [...current.edges, nextDeckEdge],
      }));
    });
  }, [document, edges, onPersistGraphMutation, setDocument]);

  const onConnect = useCallback((connection: Connection) => {
    commitConnection(connection);
  }, [commitConnection]);

  const deleteSelectedCard = useCallback(() => {
    if (!selectedCardId) return;
    const card = document.nodes.find((node) => node.id === selectedCardId);
    if (!card) return;
    const connectedEdgeCount = document.edges.filter(
      (edge) => edge.source === selectedCardId || edge.target === selectedCardId,
    ).length;
    if (
      !confirmCanvasCardDeletion(
        card,
        connectedEdgeCount,
        (message) => window.confirm(message),
        (message) => window.prompt(message),
      )
    ) {
      return;
    }
    onPersistGraphMutation?.('canvas:delete-card-confirmed', {
      cardId: selectedCardId,
      connectedEdgeCount,
    });
    setDocument((prev) => removeCardAndConnectedEdges(prev, selectedCardId));
    onSelectCard(null);
    onSelectEdge(null);
    setHoveredCardId(null);
  }, [document, onPersistGraphMutation, onSelectCard, onSelectEdge, selectedCardId, setDocument]);

  return (
    <div
      ref={canvasRef}
      className="builder-flow h-full w-full"
      style={{ position: 'relative', background: GRAPH_THEME.background.agentSurface }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (isCanvasTextEditingTarget(event.target)) return;
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
            id="agent-edge-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="strokeWidth"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={GRAPH_THEME.turboFlow.markerStroke} />
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
      {selectedCardId ? (
        <div style={{ position: 'absolute', left: 16, top: selectedEdge ? 58 : 16, zIndex: 20 }}>
          <button
            type="button"
            onClick={deleteSelectedCard}
            style={graphPillButtonStyle({
              border: `1px solid ${GRAPH_THEME.accent.workflow}`,
              color: GRAPH_THEME.surface.text,
            })}
          >
            Delete Card…
          </button>
        </div>
      ) : null}
      {autosaveConflictMessage ? (
        <div
          role="alert"
          style={{
            position: 'absolute',
            left: '50%',
            top: 16,
            transform: 'translateX(-50%)',
            zIndex: 30,
            maxWidth: 560,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${GRAPH_THEME.accent.workflow}`,
            background: 'rgba(20, 16, 14, 0.96)',
            color: GRAPH_THEME.surface.text,
            fontSize: 12,
          }}
        >
          <div>{autosaveConflictMessage}</div>
          {onReloadSavedDeck ? (
            <button
              type="button"
              onClick={onReloadSavedDeck}
              style={{ ...graphPillButtonStyle({ color: GRAPH_THEME.surface.text }), marginTop: 8 }}
            >
              Reload saved board
            </button>
          ) : null}
        </div>
      ) : null}
      <div style={{ ...graphControlStackStyle, left: 'auto', right: 16 }}>
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
          onClick={() => {
            if (!reactFlowInstance) return;
            const landingViewport = buildPresentationLandingViewport(
              document,
              canvasRef.current,
              GRAPH_WORKSPACE.landingBaselineZoom,
            );
            if (!landingViewport) return;
            reactFlowInstance.setViewport(landingViewport, {
              duration: GRAPH_THEME.nav.fitDurationMs,
            });
          }}
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
        connectionLineComponent={SemanticConnectionLine}
        deleteKeyCode={null}
        edgesReconnectable={false}
        nodesDraggable={!layoutLocked}
        isValidConnection={(connection) =>
          isPlainConnectionAllowed(
            {
              source: connection.source,
              target: connection.target,
              sourceHandle: connection.sourceHandle ?? null,
              targetHandle: connection.targetHandle ?? null,
            },
            edges,
          )
        }
        onInit={setReactFlowInstance}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
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
          reconnectable: false,
          interactionWidth: 32,
          markerEnd: 'agent-edge-arrow',
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
