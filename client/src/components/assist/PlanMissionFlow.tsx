import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Edge,
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  type NodeProps,
  type ReactFlowInstance,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import type { StructuredAssistPlanSurface } from '../builder/assistPlanSurface';
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
} from '../graph/graphVisualTokens';
import TurboFlowEdge from '../builder/edges/TurboFlowEdge';
import {
  buildPlanMissionGraph,
  type PlanMissionNodeOverrideMap,
  type PlanMissionFlowEdgeData,
  type PlanMissionNodeData,
  type PlanMissionFlowNode,
} from './planMissionModel';

type PlanMissionFocus = {
  nodeId: string;
  nodeLabel: string;
  nodeKind: string;
  nodeData: PlanMissionNodeData;
} | null;

type PlanMissionFlowProps = {
  structuredPlan: StructuredAssistPlanSurface;
  compact?: boolean;
  fullHeight?: boolean;
  nodeOverrides?: PlanMissionNodeOverrideMap;
  selectedNodeId?: string | null;
  editMode?: boolean;
  drawerLinked?: boolean;
  onFocusChange?: (focus: PlanMissionFocus) => void;
};

function WallAnchorNode() {
  return (
    <div
      aria-hidden
      style={{
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

function MissionNode({ data, selected }: NodeProps<PlanMissionNodeData>) {
  const nodeData = data as PlanMissionNodeData;
  const status = String(nodeData?.status || 'seeded');
  const shellActive = Boolean(selected || status.toLowerCase() === 'running');
  const title = String(nodeData?.label || '').trim() || 'Plan Node';
  const subtext = String(nodeData?.kind || '').trim() || 'Task';
  return (
    <>
      <style>{`
        @keyframes mission-shell-border-travel {
          from { background-position: 0% 50%; }
          to { background-position: 200% 50%; }
        }
      `}</style>
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: GRAPH_THEME.accent.primary,
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'grid',
          alignContent: 'center',
          gap: 7,
          borderRadius: 14,
          border: `1px solid ${shellActive ? 'rgba(55,173,170,0.58)' : 'rgba(55,173,170,0.26)'}`,
          boxShadow: shellActive
            ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 28px rgba(55,173,170,0.2), 0 0 14px rgba(242,166,74,0.16)'
            : 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 18px rgba(0,0,0,0.18)',
          padding: '12px 14px',
          background: GRAPH_THEME.card.glassBackground,
          width: 282,
          minHeight: 116,
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: 14,
            padding: 1,
            background:
              'linear-gradient(130deg, #37ADAA 0%, #2B8C8A 26%, #F2A64A 56%, #C97C2A 80%, #37ADAA 100%)',
            backgroundSize: '220% 220%',
            opacity: shellActive ? 1 : 0,
            animation: shellActive ? 'mission-shell-border-travel 4.9s linear infinite' : 'none',
            transition: 'opacity 220ms ease',
            pointerEvents: 'none',
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />
        <div
          style={{
            fontSize: 15.5,
            fontWeight: 700,
            lineHeight: 1.18,
            letterSpacing: '-0.01em',
            color: GRAPH_THEME.surface.text,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: 'rgba(167, 176, 186, 0.84)',
            fontSize: 12,
            lineHeight: 1.48,
            maxWidth: 220,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {subtext}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: GRAPH_THEME.accent.primary,
        }}
      />
    </>
  );
}

const missionNodeTypes = {
  mission: MissionNode,
  wallAnchor: WallAnchorNode,
};

const missionEdgeTypes = {
  turboFlow: TurboFlowEdge,
};

function resolveNodeStyle(node: PlanMissionFlowNode) {
  const kind = node.data?.kind;
  const status = String(node.data?.status || 'seeded').toLowerCase();
  const accentByKind: Record<string, string> = {
    Goal: GRAPH_THEME.accent.primaryBorder,
    Task: 'rgba(167,176,186,0.3)',
    Research: GRAPH_THEME.accent.primaryBorder,
    Synthesize: 'rgba(110,95,174,0.36)',
    Approval: 'rgba(242,166,74,0.42)',
    Output: GRAPH_THEME.accent.primaryBorder,
    AgentAssignment: 'rgba(242,166,74,0.34)',
    Note: 'rgba(167,176,186,0.24)',
  };
  const statusGlowByStatus: Record<string, string> = {
    running: `0 0 0 1px ${GRAPH_THEME.accent.solarSoft}, 0 0 18px ${GRAPH_THEME.accent.solarGlow}`,
    awaiting_review:
      '0 0 0 1px rgba(110,95,174,0.2), 0 0 16px rgba(110,95,174,0.14)',
    review: '0 0 0 1px rgba(110,95,174,0.2), 0 0 16px rgba(110,95,174,0.14)',
    blocked:
      '0 0 0 1px rgba(167,176,186,0.22), 0 0 14px rgba(167,176,186,0.12)',
    error: '0 0 0 1px rgba(201,124,42,0.24), 0 0 16px rgba(201,124,42,0.14)',
    complete: `0 0 0 1px ${GRAPH_THEME.accent.primarySoft}, 0 0 14px ${GRAPH_THEME.accent.primaryGlow}`,
    done: `0 0 0 1px ${GRAPH_THEME.accent.primarySoft}, 0 0 14px ${GRAPH_THEME.accent.primaryGlow}`,
  };
  const accent = accentByKind[String(kind || 'Task')] || accentByKind.Task;
  return {
    borderRadius: 14,
    border: `1px solid ${accent}`,
    background: GRAPH_THEME.card.glassBackground,
    color: GRAPH_THEME.drawer.inputText,
    fontSize: 12.5,
    lineHeight: 1.35,
    width: 286,
    minHeight: 124,
    padding: '10px 12px',
    boxShadow:
      statusGlowByStatus[status] || 'inset 0 1px 0 rgba(255,255,255,0.04)',
    backdropFilter: 'blur(12px) saturate(120%)',
    WebkitBackdropFilter: 'blur(12px) saturate(120%)',
  } as const;
}

export default function PlanMissionFlow({
  structuredPlan,
  compact = false,
  fullHeight = false,
  nodeOverrides,
  selectedNodeId = null,
  editMode = false,
  drawerLinked = false,
  onFocusChange,
}: PlanMissionFlowProps) {
  const WALL_ORCH_ID = 'card_magentic';
  const flowHostRef = useRef<HTMLDivElement | null>(null);
  const pendingConnectionRef = useRef<{
    nodeId: string | null;
    handleType: 'source' | 'target' | null;
  } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [layoutLocked, setLayoutLocked] = useState(false);
  const missionGraph = useMemo(
    () => buildPlanMissionGraph(structuredPlan, nodeOverrides),
    [structuredPlan, nodeOverrides],
  );
  const seededNodes = useMemo(() => {
    const missionNodes = missionGraph.nodes.map((node) => ({
      ...node,
      style: resolveNodeStyle(node),
    }));
    const wallNode = {
      id: WALL_ORCH_ID,
      type: 'wallAnchor',
      position: { x: -340, y: -80 },
      data: {},
      draggable: false,
      selectable: false,
      focusable: false,
    } as unknown as PlanMissionFlowNode;
    return [wallNode, ...missionNodes];
  }, [missionGraph.nodes]);
  const [nodes, setNodes] = useNodesState(seededNodes);
  const [edges, setEdges] = useEdgesState<Edge<PlanMissionFlowEdgeData>>(
    missionGraph.edges,
  );

  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node] as const));
      return seededNodes.map((node) => {
        const existing = byId.get(node.id);
        const selected = Boolean(selectedNodeId && node.id === selectedNodeId);
        if (!existing) return { ...node, selected };
        return {
          ...node,
          position: existing.position,
          selected,
        };
      });
    });
  }, [seededNodes, selectedNodeId, setNodes]);

  useEffect(() => {
    setEdges((current) => {
      if (current.length !== missionGraph.edges.length) return missionGraph.edges;
      for (let i = 0; i < current.length; i += 1) {
        const prev = current[i];
        const next = missionGraph.edges[i];
        if (
          prev.id !== next.id ||
          prev.source !== next.source ||
          prev.target !== next.target ||
          prev.className !== next.className
        ) {
          return missionGraph.edges;
        }
      }
      return current;
    });
  }, [missionGraph.edges, setEdges]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const shouldBeSelected = Boolean(
          selectedNodeId && node.id === selectedNodeId,
        );
        if (Boolean(node.selected) === shouldBeSelected) return node;
        return {
          ...node,
          selected: shouldBeSelected,
        };
      }),
    );
  }, [selectedNodeId, setNodes]);

  useEffect(() => {
    if (!reactFlowInstance || !editMode || !selectedNodeId) return;
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) return;
    reactFlowInstance.fitView({
      nodes: [selectedNode],
      duration: GRAPH_THEME.nav.focusDurationMs,
      padding: 1.05,
      minZoom: GRAPH_THEME.nav.minZoom,
      maxZoom: GRAPH_THEME.nav.focusMaxZoom,
    });
  }, [editMode, nodes, reactFlowInstance, selectedNodeId]);

  const visibleEdges = useMemo(() => {
    if (!editMode || !selectedNodeId) return edges;
    return edges.map((edge) => {
      const connected =
        edge.source === selectedNodeId || edge.target === selectedNodeId;
      const baseClass = String(edge.className || '');
      const classes = new Set(
        baseClass
          .split(' ')
          .map((entry) => entry.trim())
          .filter(Boolean),
      );
      if (connected) classes.delete('edge-muted');
      else classes.add('edge-muted');
      const nextClassName = Array.from(classes).join(' ');
      const sourceIsWallEndpoint = edge.source === WALL_ORCH_ID;
      const targetIsWallEndpoint = edge.target === WALL_ORCH_ID;
      const nextData = {
        ...((edge.data || {}) as Record<string, unknown>),
        sourceIsWallEndpoint,
        targetIsWallEndpoint,
      };
      if (
        nextClassName === baseClass &&
        (edge.data as Record<string, unknown> | undefined)?.sourceIsWallEndpoint === sourceIsWallEndpoint &&
        (edge.data as Record<string, unknown> | undefined)?.targetIsWallEndpoint === targetIsWallEndpoint
      ) {
        return edge;
      }
      return {
        ...edge,
        className: nextClassName,
        data: nextData as PlanMissionFlowEdgeData,
      };
    });
  }, [WALL_ORCH_ID, editMode, edges, selectedNodeId]);

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      if (!onFocusChange) return next;
      const selectedChange = [...changes]
        .reverse()
        .find((change) => change.type === 'select' && change.selected);
      if (!selectedChange) {
        const hasSelectionMutation = changes.some(
          (change) => change.type === 'select',
        );
        if (hasSelectionMutation) onFocusChange(null);
        return next;
      }
      const selectedNode = next.find((node) => node.id === selectedChange.id);
      if (!selectedNode) {
        onFocusChange(null);
        return next;
      }
      const nodeData = (selectedNode.data || {}) as PlanMissionNodeData;
      onFocusChange({
        nodeId: selectedNode.id,
        nodeLabel: String(nodeData.label || selectedNode.id),
        nodeKind: String(nodeData.kind || 'Task'),
        nodeData: {
          label: String(nodeData.label || selectedNode.id),
          kind: String(nodeData.kind || 'Task') as PlanMissionNodeData['kind'],
          status: String(
            nodeData.status || 'seeded',
          ) as PlanMissionNodeData['status'],
          description: String(nodeData.description || ''),
          updateKey: String(nodeData.updateKey || ''),
          outputKey: String(nodeData.outputKey || ''),
          assignedAgentId: String(nodeData.assignedAgentId || ''),
          starterPrompt: String(nodeData.starterPrompt || ''),
          editable: Boolean(nodeData.editable ?? true),
        },
      });
      return next;
    });
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  };

  const commitWallConnection = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (
      connection.source !== WALL_ORCH_ID &&
      connection.target !== WALL_ORCH_ID
    ) {
      return;
    }
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: `plan_wall_${Math.random().toString(36).slice(2, 10)}`,
          type: 'turboFlow',
          className: 'edge-secondary',
          animated: false,
          data: {
            motion: 'active',
            sourceIsWallEndpoint: connection.source === WALL_ORCH_ID,
            targetIsWallEndpoint: connection.target === WALL_ORCH_ID,
          } as PlanMissionFlowEdgeData,
          style: { stroke: GRAPH_THEME.edge.neutral, strokeWidth: 1.45, opacity: 0.58 },
          markerEnd: 'agent-edge-circle',
        },
        current,
      ),
    );
  };

  const onConnect = (connection: Connection) => {
    commitWallConnection(connection);
    pendingConnectionRef.current = null;
  };

  const onConnectStart = (
    _event: unknown,
    params: { nodeId?: string | null; handleType?: 'source' | 'target' | null },
  ) => {
    pendingConnectionRef.current = {
      nodeId: params?.nodeId || null,
      handleType: params?.handleType || null,
    };
  };

  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    const pending = pendingConnectionRef.current;
    pendingConnectionRef.current = null;
    if (!pending?.nodeId || !pending.handleType) return;
    if (pending.nodeId === WALL_ORCH_ID) return;
    const host = flowHostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const clientX =
      'clientX' in event
        ? event.clientX
        : event.changedTouches && event.changedTouches.length > 0
          ? event.changedTouches[0].clientX
          : null;
    if (clientX == null) return;
    if (Math.abs(clientX - rect.left) > 20) return;
    const wallConnection =
      pending.handleType === 'target'
        ? { source: WALL_ORCH_ID, target: pending.nodeId }
        : { source: pending.nodeId, target: WALL_ORCH_ID };
    commitWallConnection(wallConnection);
  };

  return (
    <div
      ref={flowHostRef}
      className="plan-flow"
      data-testid="plan-mission-flow"
      data-edit-mode={editMode ? 'true' : 'false'}
      data-has-focus={selectedNodeId ? 'true' : 'false'}
      data-drawer-linked={drawerLinked ? 'true' : 'false'}
      style={{
        height: fullHeight ? '100%' : compact ? 240 : 420,
        minHeight: fullHeight ? 300 : undefined,
        width: '100%',
        borderRadius: 0,
        border: 'none',
        background: GRAPH_THEME.background.agentSurface,
        boxShadow: 'none',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>{`
        .plan-flow .react-flow__node {
          transition: filter 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .plan-flow .react-flow__node.selected {
          filter: drop-shadow(0 0 10px ${GRAPH_THEME.accent.primaryGlow});
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"] .react-flow__node:not(.selected) {
          opacity: 0.68;
          filter: saturate(0.84) brightness(0.86);
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"] .react-flow__node.selected {
          opacity: 1;
          filter: drop-shadow(0 0 11px ${GRAPH_THEME.accent.primaryGlow});
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"][data-drawer-linked="true"] .react-flow__node.selected {
          filter: drop-shadow(0 0 13px ${GRAPH_THEME.accent.primaryGlow}) drop-shadow(0 0 6px ${GRAPH_THEME.accent.primarySoft});
        }
        .plan-flow .react-flow__edge.selected {
          filter: none;
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"] .react-flow__edge.edge-muted {
          opacity: 0.18;
          filter: none;
        }
        .plan-flow .react-flow__handle {
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .plan-flow .react-flow__handle:hover,
        .plan-flow .react-flow__handle.connectionindicator {
          transform: scale(1.06);
          box-shadow:
            0 0 0 2px ${GRAPH_THEME.accent.primarySoft},
            0 0 0 5px ${GRAPH_THEME.accent.solarSoft};
        }
        .plan-flow .react-flow__controls {
          background: ${GRAPH_THEME.controls.background};
          border: 1px solid ${GRAPH_THEME.controls.border};
          border-radius: 10px;
          box-shadow: ${GRAPH_THEME.controls.shadow};
          overflow: hidden;
        }
        .plan-flow .react-flow__controls-button {
          background: ${GRAPH_THEME.controls.background};
          border-bottom: 1px solid ${GRAPH_THEME.controls.border};
          color: ${GRAPH_THEME.controls.text};
        }
        .plan-flow .react-flow__controls-button:hover {
          background: ${GRAPH_THEME.controls.hoverBackground};
        }
        .plan-flow .react-flow__attribution {
          display: none;
        }
      `}</style>
      {drawerLinked ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 16,
            right: 0,
            bottom: 16,
            width: 2,
            borderRadius: 999,
            background:
              'linear-gradient(180deg, rgba(55,173,170,0.08), rgba(55,173,170,0.28), rgba(55,173,170,0.08))',
            boxShadow: '0 0 18px rgba(55,173,170,0.18)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ) : null}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient
            id="agent-edge-gradient-intelligence"
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              stopColor={GRAPH_THEME.turboFlow.intelligenceGradientStart}
            />
            <stop
              offset="61.8%"
              stopColor={GRAPH_THEME.turboFlow.intelligenceGradientMid}
            />
            <stop
              offset="100%"
              stopColor={GRAPH_THEME.turboFlow.intelligenceGradientEnd}
            />
          </linearGradient>
          <linearGradient
            id="agent-edge-gradient-execution"
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              stopColor={GRAPH_THEME.turboFlow.executionGradientStart}
            />
            <stop
              offset="61.8%"
              stopColor={GRAPH_THEME.turboFlow.executionGradientMid}
            />
            <stop
              offset="100%"
              stopColor={GRAPH_THEME.turboFlow.executionGradientEnd}
            />
          </linearGradient>
          <linearGradient
            id="agent-edge-gradient-memory"
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              stopColor={GRAPH_THEME.turboFlow.memoryGradientStart}
            />
            <stop
              offset="61.8%"
              stopColor={GRAPH_THEME.turboFlow.memoryGradientMid}
            />
            <stop
              offset="100%"
              stopColor={GRAPH_THEME.turboFlow.memoryGradientEnd}
            />
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
            <circle
              stroke={GRAPH_THEME.turboFlow.markerStroke}
              strokeOpacity="0.9"
              r="2"
              cx="0"
              cy="0"
              fill="none"
            />
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
            <circle
              stroke={GRAPH_THEME.turboFlow.markerHotStroke}
              strokeOpacity="0.92"
              r="2"
              cx="0"
              cy="0"
              fill="none"
            />
          </marker>
        </defs>
      </svg>
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
          style={graphControlButtonStyle()}
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
        edges={visibleEdges}
        nodeTypes={missionNodeTypes}
        edgeTypes={missionEdgeTypes}
        onInit={setReactFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          setNodes((current) =>
            current.map((entry) => ({
              ...entry,
              selected: entry.id === node.id,
            })),
          );
          if (!onFocusChange) return;
          const nodeData = (node.data || {}) as PlanMissionNodeData;
          onFocusChange({
            nodeId: node.id,
            nodeLabel: String(nodeData.label || node.id),
            nodeKind: String(nodeData.kind || 'Task'),
            nodeData: {
              label: String(nodeData.label || node.id),
              kind: String(
                nodeData.kind || 'Task',
              ) as PlanMissionNodeData['kind'],
              status: String(
                nodeData.status || 'seeded',
              ) as PlanMissionNodeData['status'],
              description: String(nodeData.description || ''),
              updateKey: String(nodeData.updateKey || ''),
              outputKey: String(nodeData.outputKey || ''),
              assignedAgentId: String(nodeData.assignedAgentId || ''),
              starterPrompt: String(nodeData.starterPrompt || ''),
              editable: Boolean(nodeData.editable ?? true),
            },
          });
        }}
        onPaneClick={() => {
          if (!onFocusChange) return;
          onFocusChange(null);
        }}
        defaultViewport={{
          x: compact ? 56 : 72,
          y: compact ? 86 : 96,
          zoom: compact ? 0.52 : 0.62,
        }}
        minZoom={GRAPH_THEME.nav.minZoom}
        maxZoom={GRAPH_THEME.nav.maxZoom}
        nodesConnectable={false}
        nodesDraggable={!editMode && !layoutLocked}
        elementsSelectable
        nodesConnectable
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        edgesFocusable={false}
        edgesReconnectable={false}
        connectOnClick={false}
        zoomOnScroll={!editMode && !layoutLocked}
        zoomOnPinch={!editMode && !layoutLocked}
        panOnDrag={!editMode && !layoutLocked}
        connectionMode={ConnectionMode.Loose}
        snapToGrid
        snapGrid={[
          GRAPH_THEME.graphPaper.minorStep,
          GRAPH_THEME.graphPaper.minorStep,
        ]}
        proOptions={{ hideAttribution: true }}
        style={{
          background: 'transparent',
        }}
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
