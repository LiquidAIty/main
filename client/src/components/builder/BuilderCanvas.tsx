import { useEffect, useMemo, useState } from 'react';
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

import type { AgentCardInstance, DeckDocument, DeckEdge } from '../../types/agentgraph';
import type { DeckExecutionPlan } from './deckExecution';
import { buildDeckEdgeIdentityKey } from './deckValidation';
import AgentCardNode from './nodes/AgentCardNode';

const nodeTypes = {
  agentCard: AgentCardNode,
};

const DEV_MODE = import.meta.env.DEV;
const PERSISTED_NODE_CHANGE_TYPES = new Set<NodeChange['type']>(['add', 'remove', 'replace', 'position']);
const PERSISTED_EDGE_CHANGE_TYPES = new Set<EdgeChange['type']>(['add', 'remove', 'replace']);

export type BuilderCanvasFocusRequest = {
  kind: 'deck' | 'card';
  cardId?: string | null;
  nonce: number;
};

function toFlowNodes(
  document: DeckDocument,
  selectedCardId: string | null,
  executionPlan: Pick<DeckExecutionPlan, 'simpleOrderCardIds' | 'startCardIds'> | null,
): Node[] {
  const executionOrderById = new Map(
    (executionPlan?.simpleOrderCardIds || []).map((cardId, index) => [cardId, index + 1] as const),
  );
  const startCardIds = new Set(executionPlan?.startCardIds || []);
  return document.nodes.map((node) => ({
    id: node.id,
    type: 'agentCard',
    position: node.position,
    data: {
      ...node,
      executionOrder: executionOrderById.get(node.id) || null,
      isStartCard: startCardIds.has(node.id),
      readsFromBlackboard: document.edges.some(
        (edge) => edge.source === 'node_blackboard' && edge.target === node.id,
      ),
      writesToBlackboard: document.edges.some(
        (edge) => edge.source === node.id && edge.target === 'node_blackboard',
      ),
    },
    selected: node.id === selectedCardId,
  }));
}

export type DeckEdgeVisualState = {
  isLoopEdge: boolean;
  isReturnEdge: boolean;
  isBlackboardEdge: boolean;
  offset: number;
  borderRadius: number;
};

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
      const isBlackboardEdge = sourceNode?.kind === 'blackboard' || targetNode?.kind === 'blackboard';
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
          isBlackboardEdge,
          offset: isLoopEdge ? 56 : isReturnEdge ? 42 : isBlackboardEdge ? 32 : 24,
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
      isBlackboardEdge: false,
      offset: 24,
      borderRadius: 14,
    };
    const stroke = isSelected
      ? 'rgba(79, 162, 173, 0.98)'
      : visualState.isLoopEdge
        ? 'rgba(217, 132, 88, 0.94)'
        : visualState.isBlackboardEdge
          ? 'rgba(111, 176, 186, 0.94)'
          : 'rgba(118, 126, 138, 0.92)';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      className: [
        visualState.isLoopEdge ? 'edge-loop' : null,
        visualState.isReturnEdge ? 'edge-return' : null,
        visualState.isBlackboardEdge ? 'edge-blackboard' : null,
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
      return nextEdge
        ? {
            ...edge,
            source: nextEdge.source,
            target: nextEdge.target,
          }
        : edge;
    });

  nextEdges.forEach((edge) => {
    if (merged.some((entry) => entry.id === edge.id)) return;
    merged.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
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
  const selectedEdge = useMemo(
    () => document.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [document.edges, selectedEdgeId],
  );

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

    const nextEdgeKey = buildDeckEdgeIdentityKey({
      source: connection.source,
      target: connection.target,
    });

    return !currentEdges.some((edge) => {
      if (edge.id === ignoreEdgeId) return false;
      if (!edge.source || !edge.target) return false;
      return (
        buildDeckEdgeIdentityKey({
          source: edge.source,
          target: edge.target,
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
      const next = reconnectEdge(oldEdge, newConnection, current, { shouldReplaceId: false });
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
    <div className="builder-flow h-full w-full" style={{ position: 'relative' }}>
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
        .builder-flow .react-flow__edge.edge-blackboard .react-flow__edge-path {
          opacity: 0.98;
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
        connectOnClick={false}
        deleteKeyCode={null}
        isValidConnection={(connection) => isPlainConnectionAllowed(connection, edges)}
        onInit={setReactFlowInstance}
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
        fitViewOptions={{ padding: 0.22 }}
        fitView
      >
        <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="rgba(73, 82, 91, 0.42)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
