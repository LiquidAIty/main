import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnReconnect,
  type ReactFlowInstance,
} from '@xyflow/react';

import type { DeckDocument, DeckEdge } from '../../../types/agentgraph';
import { buildPresentationLandingViewport } from '../core/agentBuilderViewportMath';
import { GRAPH_WORKSPACE } from '../../../components/graph/graphWorkspaceContract';
import { buildDeckEdgeIdentityKey } from './deckEdgeIdentity';
import {
  buildDeckEdgeFromConnection,
  isPlainConnectionAllowedForDocument,
  mergeFlowEdgesIntoDeck,
  mergeFlowNodesIntoDeck,
  reduceCanvasEdgeChanges,
  reduceCanvasNodeChanges,
  resolveCanvasConnectionEdgeType,
  syncFlowEdgesForRender,
  syncFlowNodesForRender,
  toFlowEdges,
  toFlowNodes,
  type FlowEdgeData,
} from './agentCanvasDocumentProjection';

export type AgentCanvasGraphProps = {
  document: DeckDocument;
  setDocument: Dispatch<SetStateAction<DeckDocument>>;
  onPersistGraphMutation?: (reason: string, detail?: Record<string, unknown>) => void;
  selectedCardId: string | null;
  selectedEdgeId: string | null;
  onSelectCard: (cardId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onDeleteSelectedEdge?: () => void;
  activeCardIds?: string[];
  activeAgentCounts?: Record<string, number>;
  activeEdgeIds?: string[];
  inspectMode?: boolean;
  focusZone?: { zone: 'agents'; nonce: number } | null;
};

export default function useAgentCanvasInteractions({
  document,
  setDocument,
  onPersistGraphMutation,
  selectedCardId,
  selectedEdgeId,
  onSelectCard,
  onSelectEdge,
  activeCardIds = [],
  activeAgentCounts = {},
  activeEdgeIds = [],
  inspectMode = false,
  focusZone = null,
}: AgentCanvasGraphProps) {
  const activeCardIdSet = useMemo(() => new Set(activeCardIds), [activeCardIds]);
  const activeEdgeIdSet = useMemo(() => new Set(activeEdgeIds), [activeEdgeIds]);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [paperViewport, setPaperViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const initialViewportAppliedRef = useRef(false);
  const flowNodes = useMemo(
    () => toFlowNodes(
      document,
      selectedCardId,
      hoveredCardId,
      inspectMode,
      activeCardIdSet,
      activeAgentCounts,
    ),
    [activeAgentCounts, activeCardIdSet, document, hoveredCardId, inspectMode, selectedCardId],
  );
  const flowEdges = useMemo(
    () => toFlowEdges(document, selectedEdgeId, hoveredCardId, activeEdgeIdSet),
    [activeEdgeIdSet, document, hoveredCardId, selectedEdgeId],
  );
  const [nodes, setNodes] = useNodesState(flowNodes);
  const [edges, setEdges] = useEdgesState(flowEdges);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const latestDocumentRef = useRef(document);
  const latestFlowNodesRef = useRef(nodes);
  const latestFlowEdgesRef = useRef(edges);
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
    setEdges((current) => syncFlowEdgesForRender(current, flowEdges));
  }, [flowEdges, setEdges]);
  useEffect(() => {
    latestFlowNodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    latestFlowEdgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (!reactFlowInstance || !focusZone) return;
    const frame = window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({ duration: 500, padding: 0.2 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusZone, reactFlowInstance]);

  useEffect(() => {
    if (!reactFlowInstance || flowNodes.length === 0 || initialViewportAppliedRef.current) return;
    initialViewportAppliedRef.current = true;
    const landingViewport = buildPresentationLandingViewport(
      document,
      canvasRef.current,
      GRAPH_WORKSPACE.landingBaselineZoom,
    );
    const frame = window.requestAnimationFrame(() => {
      if (landingViewport) reactFlowInstance.setViewport(landingViewport, { duration: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [document, flowNodes.length, reactFlowInstance]);

  const isPlainConnectionAllowed = (
    connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>,
    currentEdges: Edge[],
    ignoreEdgeId?: string,
  ): boolean => isPlainConnectionAllowedForDocument(document, connection, currentEdges, ignoreEdgeId);

  const onNodesChange = (changes: NodeChange[]) => {
    const reduced = reduceCanvasNodeChanges(changes, latestFlowNodesRef.current);
    latestFlowNodesRef.current = reduced.nextNodes;
    setNodes(reduced.nextNodes);
    if (!reduced.nextNodesForPersistence) return;
    onPersistGraphMutation?.('canvas:nodes', { changeTypes: changes.map((change) => change.type) });
    setDocument((prev) => ({
      ...prev,
      version: prev.version + 1,
      nodes: mergeFlowNodesIntoDeck(reduced.nextNodesForPersistence as Node[], prev.nodes),
    }));
  };

  const onNodeDragStop: NodeMouseHandler = (_event, draggedNode) => {
    const previous = latestDocumentRef.current.nodes.find((node) => node.id === draggedNode.id);
    if (previous
      && previous.position.x === draggedNode.position.x
      && previous.position.y === draggedNode.position.y) return;
    const nextNodes = latestFlowNodesRef.current.map((node) => (
      node.id === draggedNode.id ? { ...node, position: { ...draggedNode.position } } : node
    ));
    latestFlowNodesRef.current = nextNodes;
    setNodes(nextNodes);
    onPersistGraphMutation?.('canvas:node-drag-stop', {
      cardId: draggedNode.id,
      x: draggedNode.position.x,
      y: draggedNode.position.y,
    });
    setDocument((prev) => ({
      ...prev,
      version: prev.version + 1,
      nodes: mergeFlowNodesIntoDeck(nextNodes, prev.nodes),
    }));
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const reduced = reduceCanvasEdgeChanges(changes, latestFlowEdgesRef.current);
    latestFlowEdgesRef.current = reduced.nextEdges;
    setEdges(reduced.nextEdges);
    if (!reduced.nextEdgesForPersistence) return;
    onPersistGraphMutation?.('canvas:edges', { changeTypes: changes.map((change) => change.type) });
    setDocument((prev) => ({
      ...prev,
      version: prev.version + 1,
      edges: mergeFlowEdgesIntoDeck(reduced.nextEdgesForPersistence as Edge[], prev.edges),
    }));
  };

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const edgeType = resolveCanvasConnectionEdgeType(document, connection);
    if (!edgeType) return;
    const edgeId = `edge_${Math.random().toString(36).slice(2, 10)}`;
    const nextDeckEdge = buildDeckEdgeFromConnection(connection, edgeId, edgeType);
    if (!nextDeckEdge) return;
    setEdges((current) => {
      if (!isPlainConnectionAllowed(connection, current)) return current;
      return addEdge({ ...connection, id: edgeId, data: { edgeType } satisfies FlowEdgeData }, current);
    });
    onPersistGraphMutation?.('canvas:connect', {
      source: connection.source,
      target: connection.target,
    });
    setDocument((prev) => {
      const nextEdgeKey = buildDeckEdgeIdentityKey(nextDeckEdge as DeckEdge);
      if (prev.edges.some((edge) => buildDeckEdgeIdentityKey(edge) === nextEdgeKey)) return prev;
      return { ...prev, version: prev.version + 1, edges: [...prev.edges, nextDeckEdge as DeckEdge] };
    });
  }, [document, onPersistGraphMutation, setDocument]);

  const onReconnect: OnReconnect<Edge> = (oldEdge, newConnection) => {
    if (!newConnection.source || !newConnection.target) return;
    if (newConnection.source === newConnection.target) return;
    const nextEdgeType = resolveCanvasConnectionEdgeType(document, newConnection);
    if (!nextEdgeType) return;
    setEdges((current) => {
      if (!isPlainConnectionAllowed(newConnection, current, oldEdge.id)) return current;
      return reconnectEdge(oldEdge, newConnection, current, { shouldReplaceId: false }).map((edge) => (
        edge.id === oldEdge.id
          ? {
              ...edge,
              data: { ...((edge.data as FlowEdgeData | undefined) || {}), edgeType: nextEdgeType },
            }
          : edge
      ));
    });
    onPersistGraphMutation?.('canvas:reconnect', {
      edgeId: oldEdge.id,
      source: newConnection.source,
      target: newConnection.target,
    });
    setDocument((prev) => {
      const reconnectedDeckEdge = buildDeckEdgeFromConnection(newConnection, oldEdge.id, nextEdgeType);
      if (!reconnectedDeckEdge) return prev;
      const nextEdgeKey = buildDeckEdgeIdentityKey(reconnectedDeckEdge);
      if (prev.edges.some((edge) => (
        edge.id !== oldEdge.id && buildDeckEdgeIdentityKey(edge) === nextEdgeKey
      ))) return prev;
      return {
        ...prev,
        version: prev.version + 1,
        edges: prev.edges.map((edge) => edge.id === oldEdge.id ? {
          ...edge,
          source: reconnectedDeckEdge.source,
          sourceHandle: reconnectedDeckEdge.sourceHandle,
          target: reconnectedDeckEdge.target,
          targetHandle: reconnectedDeckEdge.targetHandle,
          edgeType: reconnectedDeckEdge.edgeType,
        } : edge),
      };
    });
    onSelectCard(null);
    onSelectEdge(oldEdge.id);
  };

  return {
    canvasRef,
    edges,
    nodes,
    onConnect,
    onEdgesChange,
    onNodeDragStop,
    onNodesChange,
    onReconnect,
    paperViewport,
    selectedEdge,
    setHoveredCardId,
    setPaperViewport,
    setReactFlowInstance,
    isPlainConnectionAllowed,
  };
}
