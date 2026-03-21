import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import type { AgentCardInstance, DeckDocument, DeckEdge } from '../../types/agentgraph';
import { buildDeckEdgeIdentityKey } from './deckValidation';
import AgentCardNode from './nodes/AgentCardNode';

const nodeTypes = {
  agentCard: AgentCardNode,
};

function toFlowNodes(document: DeckDocument): Node[] {
  return document.nodes.map((node) => ({
    id: node.id,
    type: 'agentCard',
    position: node.position,
    data: node,
  }));
}

function toFlowEdges(document: DeckDocument): Edge[] {
  return document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: {
      routeType: edge.routeType,
      condition: edge.condition,
      mapping: edge.mapping,
      priority: edge.priority,
    },
  }));
}

function toDeckNodes(nodes: Node[]): AgentCardInstance[] {
  return nodes.map((node) => ({
    ...(node.data as AgentCardInstance),
    position: node.position,
  }));
}

function toDeckEdges(edges: Edge[]): DeckEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    routeType: (edge.data?.routeType as DeckEdge['routeType']) || 'default',
    condition: typeof edge.data?.condition === 'string' ? edge.data.condition : undefined,
    mapping: Array.isArray(edge.data?.mapping) ? edge.data.mapping : undefined,
    priority: typeof edge.data?.priority === 'number' ? edge.data.priority : undefined,
  }));
}

export default function BuilderCanvas({
  document,
  setDocument,
  onSelectCard,
  onSelectEdge,
}: {
  document: DeckDocument;
  setDocument: Dispatch<SetStateAction<DeckDocument>>;
  onSelectCard: (cardId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
}) {
  const [nodes, setNodes] = useNodesState(toFlowNodes(document));
  const [edges, setEdges] = useEdgesState(toFlowEdges(document));

  useEffect(() => {
    setNodes(toFlowNodes(document));
  }, [document, setNodes]);

  useEffect(() => {
    setEdges(toFlowEdges(document));
  }, [document, setEdges]);

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      setDocument((prev) => ({
        ...prev,
        version: prev.version + 1,
        nodes: toDeckNodes(next),
      }));
      return next;
    });
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      setDocument((prev) => ({
        ...prev,
        version: prev.version + 1,
        edges: toDeckEdges(next),
      }));
      return next;
    });
  };

  const onConnect = (connection: Connection) => {
    setEdges((current) => {
      if (!connection.source || !connection.target) return current;
      const nextEdgeKey = buildDeckEdgeIdentityKey({
        source: connection.source,
        target: connection.target,
        routeType: 'default',
        condition: undefined,
      });
      const hasDuplicate = current.some((edge) => {
        if (!edge.source || !edge.target) return false;
        return (
          buildDeckEdgeIdentityKey({
            source: edge.source,
            target: edge.target,
            routeType: (edge.data?.routeType as DeckEdge['routeType']) || 'default',
            condition: typeof edge.data?.condition === 'string' ? edge.data.condition : undefined,
          }) === nextEdgeKey
        );
      });
      if (hasDuplicate) return current;

      const next = addEdge(
        {
          ...connection,
          id: `edge_${Math.random().toString(36).slice(2, 10)}`,
          data: { routeType: 'default', priority: 0 },
        },
        current,
      );
      setDocument((prev) => ({
        ...prev,
        version: prev.version + 1,
        edges: toDeckEdges(next),
      }));
      return next;
    });
  };

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          onSelectEdge(null);
          onSelectCard(node.id);
        }}
        onEdgeClick={(_, edge) => {
          onSelectCard(null);
          onSelectEdge(edge.id);
        }}
        onPaneClick={() => {
          onSelectCard(null);
          onSelectEdge(null);
        }}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
