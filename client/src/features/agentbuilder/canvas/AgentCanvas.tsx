import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import {
  ConnectionMode,
  Controls,
  ReactFlow,
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

import '@xyflow/react/dist/style.css';

import type {
  DeckDocument,
  DeckEdge,
} from '../../../types/agentgraph';
import {
  buildDeckEdgeIdentityKey,
} from './deckEdgeIdentity';
import {
  GRAPH_THEME,
  graphDrawerSectionStyle,
  graphPillButtonStyle,
} from '../../../components/graph/graphVisualTokens';
import { buildPresentationLandingViewport } from '../core/agentBuilderViewportMath';
import { GraphPaperBackground } from '../../../components/graph/GraphCanvasChrome';
import {
  GRAPH_WORKSPACE,
} from '../../../components/graph/graphWorkspaceContract';
import TurboFlowEdge from './edges/TurboFlowEdge';
import DeckCardNode from './nodes/DeckCardNode';
import MagneticWorkerBusNode from './nodes/MagneticWorkerBusNode';
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

const nodeTypes = {
  deckCard: DeckCardNode,
  magneticWorkerBus: MagneticWorkerBusNode,
};
const edgeTypes = {
  turboFlow: TurboFlowEdge,
};

type AgentCanvasGraphProps = {
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

type AgentCanvasProps = AgentCanvasGraphProps & {
  surfaceRole: 'large' | 'companion';
  shellStyle: CSSProperties;
  ready: boolean;
  loadError: string | null;
};

function AgentCanvasGraph({
  document,
  setDocument,
  onPersistGraphMutation,
  selectedCardId,
  selectedEdgeId,
  onSelectCard,
  onSelectEdge,
  onDeleteSelectedEdge,
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
    () =>
      toFlowNodes(
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
      return;
    }
    onPersistGraphMutation?.('canvas:nodes', {
      changeTypes: changes.map((change) => change.type),
    });
    setDocument((prev) => ({
      ...prev,
      version: prev.version + 1,
      nodes: mergeFlowNodesIntoDeck(reduced.nextNodesForPersistence as Node[], prev.nodes),
    }));
  };

  const onNodeDragStop: NodeMouseHandler = (_event, draggedNode) => {
    const previous = latestDocumentRef.current.nodes.find((node) => node.id === draggedNode.id);
    if (
      previous &&
      previous.position.x === draggedNode.position.x &&
      previous.position.y === draggedNode.position.y
    ) {
      return;
    }
    const nextNodes = latestFlowNodesRef.current.map((node) =>
      node.id === draggedNode.id
        ? { ...node, position: { ...draggedNode.position } }
        : node,
    );
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
    if (!reduced.nextEdgesForPersistence) {
      return;
    }
    onPersistGraphMutation?.('canvas:edges', {
      changeTypes: changes.map((change) => change.type),
    });
    setDocument((prev) => ({
      ...prev,
      version: prev.version + 1,
      edges: mergeFlowEdgesIntoDeck(reduced.nextEdgesForPersistence as Edge[], prev.edges),
    }));
  };
  const commitConnection = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const edgeType = resolveCanvasConnectionEdgeType(document, connection);
    if (!edgeType) return;
    const edgeId = `edge_${Math.random().toString(36).slice(2, 10)}`;
    const nextDeckEdge = buildDeckEdgeFromConnection(connection, edgeId, edgeType);
    if (!nextDeckEdge) return;

    setEdges((current) => {
      if (!isPlainConnectionAllowed(connection, current)) return current;
      return addEdge(
        {
          ...connection,
          id: edgeId,
          data: {
            edgeType,
          } satisfies FlowEdgeData,
        },
        current,
      );
    });
    onPersistGraphMutation?.('canvas:connect', {
      source: connection.source,
      target: connection.target,
    });
    setDocument((prev) => {
      const nextEdgeKey = buildDeckEdgeIdentityKey(nextDeckEdge as DeckEdge);
      if (prev.edges.some((edge) => buildDeckEdgeIdentityKey(edge) === nextEdgeKey)) {
        return prev;
      }
      return {
        ...prev,
        version: prev.version + 1,
        edges: [...prev.edges, nextDeckEdge as DeckEdge],
      };
    });
  }, [document, onPersistGraphMutation, setDocument]);

  const onConnect = useCallback((connection: Connection) => {
    commitConnection(connection);
  }, [commitConnection]);

  const onReconnect: OnReconnect<Edge> = (oldEdge, newConnection) => {
    if (!newConnection.source || !newConnection.target) return;
    if (newConnection.source === newConnection.target) return;
    const nextEdgeType = resolveCanvasConnectionEdgeType(document, newConnection);
    if (!nextEdgeType) return;
    setEdges((current) => {
      if (!isPlainConnectionAllowed(newConnection, current, oldEdge.id)) return current;
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
              },
            }
          : edge,
      );
      return next;
    });
    onPersistGraphMutation?.('canvas:reconnect', {
      edgeId: oldEdge.id,
      source: newConnection.source,
      target: newConnection.target,
    });
    setDocument((prev) => {
      const reconnectedDeckEdge = buildDeckEdgeFromConnection(
        newConnection,
        oldEdge.id,
        nextEdgeType,
      );
      if (!reconnectedDeckEdge) return prev;
      const nextEdgeKey = buildDeckEdgeIdentityKey(reconnectedDeckEdge);
      if (
        prev.edges.some(
          (edge) => edge.id !== oldEdge.id && buildDeckEdgeIdentityKey(edge) === nextEdgeKey,
        )
      ) {
        return prev;
      }
      return {
        ...prev,
        version: prev.version + 1,
        edges: prev.edges.map((edge) =>
          edge.id === oldEdge.id
            ? {
                ...edge,
                source: reconnectedDeckEdge.source,
                sourceHandle: reconnectedDeckEdge.sourceHandle,
                target: reconnectedDeckEdge.target,
                targetHandle: reconnectedDeckEdge.targetHandle,
                edgeType: reconnectedDeckEdge.edgeType,
              }
            : edge,
        ),
      };
    });
    onSelectCard(null);
    onSelectEdge(oldEdge.id);
  };

  return (
    <div
      ref={canvasRef}
      className="agent-canvas-flow h-full w-full"
      style={{ position: 'relative', background: GRAPH_THEME.background.agentSurface }}
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.key === 'Backspace' || event.key === 'Delete') && selectedEdgeId) {
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
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onSelectCard(null);
        onSelectEdge(null);
        setHoveredCardId(null);
      }}
    >
      <style>{`
        .agent-canvas-flow .react-flow__edge {
          cursor: pointer;
          transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .agent-canvas-flow .react-flow__edge:hover {
          opacity: 1;
        }
        .agent-canvas-flow .react-flow__edge.selected,
        .agent-canvas-flow .react-flow__edge.edge-selected {
          filter: none;
        }
        .agent-canvas-flow .react-flow__edge.edge-active {
          filter: none;
        }
        .agent-canvas-flow .react-flow__edge.edge-loop,
        .agent-canvas-flow .react-flow__edge.edge-return {
          filter: none;
        }
        .agent-canvas-flow .react-flow__node {
          transition: filter 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .agent-canvas-flow .react-flow__node.selected {
          filter: drop-shadow(0 0 4px ${GRAPH_THEME.accent.primaryGlow});
        }
        .agent-canvas-flow .react-flow__handle {
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .agent-canvas-flow .react-flow__handle:hover,
        .agent-canvas-flow .react-flow__handle.connectionindicator {
          transform: scale(1.06);
          box-shadow:
            0 0 0 2px ${GRAPH_THEME.accent.primarySoft},
            0 0 0 5px ${GRAPH_THEME.accent.solarSoft};
        }
        .agent-canvas-flow .react-flow__connection-path {
          stroke: ${GRAPH_THEME.accent.primary};
          stroke-width: 2.35;
        }
        .agent-canvas-flow .react-flow__edge-interaction {
          cursor: pointer;
        }
        .agent-canvas-flow .react-flow__controls {
          background: ${GRAPH_THEME.controls.background};
          border: 1px solid ${GRAPH_THEME.controls.border};
          border-radius: 10px;
          box-shadow: ${GRAPH_THEME.controls.shadow};
          overflow: hidden;
        }
        .agent-canvas-flow .react-flow__controls-button {
          background: ${GRAPH_THEME.controls.background};
          border-bottom: 1px solid ${GRAPH_THEME.controls.border};
          color: ${GRAPH_THEME.controls.text};
        }
        .agent-canvas-flow .react-flow__controls-button:hover {
          background: ${GRAPH_THEME.controls.hoverBackground};
        }
        .agent-canvas-flow .react-flow__controls-button svg {
          fill: ${GRAPH_THEME.controls.text};
        }
        .agent-canvas-flow .react-flow__attribution {
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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        minZoom={GRAPH_THEME.nav.minZoom}
        maxZoom={GRAPH_THEME.nav.maxZoom}
        preventScrolling
        panOnDrag
        panOnScroll
        selectionOnDrag={false}
        connectOnClick={false}
        deleteKeyCode={null}
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
        onMove={(_event, viewport) => setPaperViewport(viewport)}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
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
      >
        <GraphPaperBackground viewport={paperViewport} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function AgentCanvas({
  surfaceRole,
  shellStyle,
  ready,
  loadError,
  ...canvasProps
}: AgentCanvasProps) {
  const content = ready ? (
    <div data-testid={`${surfaceRole}-surface-canvas`} style={shellStyle}>
      <AgentCanvasGraph {...canvasProps} />
    </div>
  ) : (
    <div
      role={loadError ? 'alert' : 'status'}
      data-testid="canonical-canvas-load-state"
      style={graphDrawerSectionStyle({
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        border: 0,
        borderRadius: 0,
        color: loadError ? 'rgba(255,162,162,0.95)' : GRAPH_THEME.drawer.inputMuted,
      })}
    >
      {loadError ? `Canvas unavailable: ${loadError}` : 'Loading…'}
    </div>
  );

  return (
    <div
      data-testid="workspace-canvas-surface"
      style={{ position: 'relative', height: '100%', minHeight: 0, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>{content}</div>
    </div>
  );
}
