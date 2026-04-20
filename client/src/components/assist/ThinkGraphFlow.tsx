import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import type { GraphViewData } from "../../types/agentgraph";
import { GRAPH_THEME } from "../graph/graphVisualTokens";
import {
  toReactFlowGraph,
  toThinkGraphProjectionInput,
  type ThinkGraphFlowNode,
} from "../graph/thinkGraphReactFlowAdapter";

type ThinkGraphFlowFocus = {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
} | null;

type ThinkGraphFlowProps = {
  graphData: GraphViewData;
  compact?: boolean;
  onFocusChange?: (focus: ThinkGraphFlowFocus) => void;
};

function resolveNodeStyle(node: ThinkGraphFlowNode) {
  const semanticType = String(node.data?.type || "entity").toLowerCase();
  const accent =
    semanticType === "goal"
      ? "rgba(223,146,84,0.52)"
      : semanticType === "task"
        ? "rgba(79,162,173,0.52)"
        : semanticType === "question"
          ? "rgba(125,105,180,0.52)"
          : "rgba(79,162,173,0.36)";
  return {
    borderRadius: 10,
    border: `1px solid ${accent}`,
    background: "linear-gradient(180deg, rgba(18,20,24,0.9), rgba(10,12,16,0.94))",
    color: GRAPH_THEME.drawer.inputText,
    fontSize: 12,
    lineHeight: 1.35,
    width: 260,
    padding: "10px 12px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  } as const;
}

export default function ThinkGraphFlow({
  graphData,
  compact = false,
  onFocusChange,
}: ThinkGraphFlowProps) {
  const projection = useMemo(() => {
    const input = toThinkGraphProjectionInput(graphData);
    return toReactFlowGraph(input, { maxNodes: compact ? 36 : 80 });
  }, [compact, graphData]);
  const seededNodes = useMemo(
    () => projection.nodes.map((node) => ({ ...node, style: resolveNodeStyle(node) })),
    [projection.nodes],
  );
  const [nodes, setNodes] = useNodesState(seededNodes);
  const [edges, setEdges] = useEdgesState(projection.edges);

  useEffect(() => {
    setNodes(seededNodes);
  }, [seededNodes, setNodes]);

  useEffect(() => {
    setEdges(projection.edges);
  }, [projection.edges, setEdges]);

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    const selectedChange = changes.find((change) => change.type === "select");
    if (!selectedChange || !onFocusChange) return;
    const selectedNode = nodes.find((node) => node.id === selectedChange.id);
    if (!selectedNode || !selectedChange.selected) {
      onFocusChange(null);
      return;
    }
    onFocusChange({
      nodeId: selectedNode.id,
      nodeLabel: String(selectedNode.data?.label || selectedNode.id),
      nodeType: String(selectedNode.data?.type || "entity"),
    });
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  };

  return (
    <div
      data-testid="plan-thinkgraph-flow"
      style={{
        height: compact ? 220 : 320,
        width: "100%",
        borderRadius: 10,
        border: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
        background: "rgba(8,10,13,0.64)",
        overflow: "hidden",
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: compact ? 0.2 : 0.24 }}
        minZoom={0.25}
        maxZoom={1.6}
        nodesConnectable={false}
        nodesDraggable
        elementsSelectable
        edgesFocusable={false}
        edgesReconnectable={false}
        connectOnClick={false}
        connectionMode={ConnectionMode.Loose}
        proOptions={{ hideAttribution: true }}
        style={{
          background:
            "radial-gradient(circle at 20% 14%, rgba(79,162,173,0.08), transparent 40%), rgba(8,10,13,0.66)",
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          color="rgba(255,255,255,0.09)"
        />
      </ReactFlow>
    </div>
  );
}
