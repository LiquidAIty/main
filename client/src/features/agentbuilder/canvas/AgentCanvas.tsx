import type { CSSProperties } from 'react';
import { ConnectionMode, Controls, ReactFlow } from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import { GRAPH_THEME, graphDrawerSectionStyle, graphPillButtonStyle } from '../../../components/graph/graphVisualTokens';
import { GraphPaperBackground } from '../../../components/graph/GraphCanvasChrome';
import TurboFlowEdge from './edges/TurboFlowEdge';
import DeckCardNode from './nodes/DeckCardNode';
import MagneticWorkerBusNode from './nodes/MagneticWorkerBusNode';
import useAgentCanvasInteractions, { type AgentCanvasGraphProps } from './useAgentCanvasInteractions';

const nodeTypes = { deckCard: DeckCardNode, magneticWorkerBus: MagneticWorkerBusNode };
const edgeTypes = { turboFlow: TurboFlowEdge };

const canvasStyles = `
  .agent-canvas-flow .react-flow__edge { cursor: pointer; transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1); }
  .agent-canvas-flow .react-flow__edge:hover { opacity: 1; }
  .agent-canvas-flow .react-flow__edge.selected,
  .agent-canvas-flow .react-flow__edge.edge-selected,
  .agent-canvas-flow .react-flow__edge.edge-active,
  .agent-canvas-flow .react-flow__edge.edge-loop,
  .agent-canvas-flow .react-flow__edge.edge-return { filter: none; }
  .agent-canvas-flow .react-flow__node { transition: filter 180ms cubic-bezier(0.22, 1, 0.36, 1); }
  .agent-canvas-flow .react-flow__node.selected { filter: drop-shadow(0 0 4px ${GRAPH_THEME.accent.primaryGlow}); }
  .agent-canvas-flow .react-flow__handle { transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease; }
  .agent-canvas-flow .react-flow__handle:hover,
  .agent-canvas-flow .react-flow__handle.connectionindicator {
    transform: scale(1.06);
    box-shadow: 0 0 0 2px ${GRAPH_THEME.accent.primarySoft}, 0 0 0 5px ${GRAPH_THEME.accent.solarSoft};
  }
  .agent-canvas-flow .react-flow__connection-path { stroke: ${GRAPH_THEME.accent.primary}; stroke-width: 2.35; }
  .agent-canvas-flow .react-flow__edge-interaction { cursor: pointer; }
  .agent-canvas-flow .react-flow__controls {
    background: ${GRAPH_THEME.controls.background}; border: 1px solid ${GRAPH_THEME.controls.border};
    border-radius: 10px; box-shadow: ${GRAPH_THEME.controls.shadow}; overflow: hidden;
  }
  .agent-canvas-flow .react-flow__controls-button {
    background: ${GRAPH_THEME.controls.background}; border-bottom: 1px solid ${GRAPH_THEME.controls.border};
    color: ${GRAPH_THEME.controls.text};
  }
  .agent-canvas-flow .react-flow__controls-button:hover { background: ${GRAPH_THEME.controls.hoverBackground}; }
  .agent-canvas-flow .react-flow__controls-button svg { fill: ${GRAPH_THEME.controls.text}; }
  .agent-canvas-flow .react-flow__attribution { display: none; }
`;

type AgentCanvasProps = AgentCanvasGraphProps & {
  surfaceRole: 'large' | 'companion';
  shellStyle: CSSProperties;
  ready: boolean;
  loadError: string | null;
};

function AgentCanvasGraph(props: AgentCanvasGraphProps) {
  const { selectedEdgeId, onSelectCard, onSelectEdge, onDeleteSelectedEdge, onPersistGraphMutation, setDocument } = props;
  const {
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
  } = useAgentCanvasInteractions(props);

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
      <style>{canvasStyles}</style>
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
