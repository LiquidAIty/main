import { Handle, Position } from '@xyflow/react';
import type { AgentCardInstance } from '../../../types/agentgraph';
import { GRAPH_THEME } from '../../graph/graphVisualTokens';

type AgentCardNodeData = AgentCardInstance & {
  executionOrder?: number | null;
  isStartCard?: boolean;
  isCallableHead?: boolean;
  assistStructureMode?: 'single' | 'seq' | 'branch' | 'merge' | 'branch_merge' | null;
  swarmBadge?: string | null;
  isRuntimeActive?: boolean;
  isHovered?: boolean;
  isHoverRelated?: boolean;
  isFlowLinked?: boolean;
};

export default function AgentCardNode({
  data,
  selected,
}: {
  data: AgentCardNodeData;
  selected?: boolean;
}) {
  const executionOrder = typeof data?.executionOrder === 'number' ? data.executionOrder : null;
  const runtimeType = String(data?.runtimeType || 'assistant_agent').trim();
  const isMagentic = runtimeType === 'magentic_one';
  const isGraph = runtimeType === 'graph_flow';
  const isGraphStep = runtimeType === 'assistant_agent' && Boolean(String(data?.parentGraphId || '').trim());
  const isCallableHead = Boolean(data?.isCallableHead) && !isMagentic && !isGraphStep;
  const canReceiveConnection = !isMagentic;
  const canStartConnection = isMagentic || runtimeType === 'assistant_agent';
  // Only show label for Magentic, not for Assist agents
  const runtimeLabel = isMagentic ? 'MAINCHAT' : null;
  const structureLabel =
    data?.assistStructureMode === 'branch_merge'
      ? 'Branch+Merge'
      : data?.assistStructureMode === 'branch'
        ? 'Branch'
        : data?.assistStructureMode === 'merge'
          ? 'Merge'
          : null;

  // Operator-first: keep Assist cards quiet by default.
  // Preserve only meaningful state badges that indicate actionable differences.
  const badges = [
    data?.isStartCard ? 'Start' : null,
    isCallableHead ? 'Callable' : null,
    data?.swarmBadge || null,
    structureLabel,
  ].filter(Boolean);
  const isRuntimeActive = Boolean(data?.isRuntimeActive);
  const isFlowLinked = Boolean(data?.isFlowLinked);
  const hoverRing =
    !selected && data?.isHovered
      ? `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(79, 162, 173, 0.22), 0 10px 24px rgba(79, 162, 173, 0.09)`
      : !selected && data?.isHoverRelated
        ? `inset 0 1px 0 rgba(255,255,255,0.02), 0 0 0 1px rgba(79, 162, 173, 0.1), ${GRAPH_THEME.surface.shadow}`
        : null;
  const ambientShell =
    "radial-gradient(circle at 14% 20%, rgba(140,116,204,0.055), transparent 38%), radial-gradient(circle at 86% 14%, rgba(79,162,173,0.085), transparent 40%), linear-gradient(180deg, rgba(30,33,36,0.98), rgba(18,21,24,0.985))";
  return (
    <div
      className="rounded-xl border min-w-[248px] bg-zinc-900 text-white"
      style={
        {
          position: 'relative',
          padding: "14px 18px 15px",
          borderWidth: isGraph ? 1.5 : 1,
          borderColor: selected
            ? GRAPH_THEME.accent.primary
            : isRuntimeActive
              ? GRAPH_THEME.accent.primary
            : isFlowLinked
              ? "rgba(79, 162, 173, 0.24)"
            : isMagentic
              ? 'rgba(96, 194, 255, 0.82)'
              : isGraph
                ? GRAPH_THEME.accent.graph
              : isCallableHead
                ? GRAPH_THEME.accent.primaryBorder
              : GRAPH_THEME.surface.border,
          background: isMagentic
            ? 'radial-gradient(circle at 18% 20%, rgba(140,116,204,0.08), transparent 38%), radial-gradient(circle at 80% 16%, rgba(96,194,255,0.12), transparent 36%), radial-gradient(circle at 50% 92%, rgba(223,146,84,0.05), transparent 42%), linear-gradient(180deg, rgba(14,28,35,0.98), rgba(10,18,22,0.98))'
            : isGraph
              ? 'radial-gradient(circle at 82% 18%, rgba(79,162,173,0.07), transparent 36%), linear-gradient(180deg, rgba(31,34,38,0.98), rgba(18,21,24,0.98))'
            : ambientShell,
          boxShadow: selected
            ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 14px 32px rgba(79, 162, 173, 0.1)`
            : isRuntimeActive
              ? `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 14px 28px rgba(79, 162, 173, 0.1), 0 0 12px rgba(223, 146, 84, 0.09)`
            : isFlowLinked
              ? `inset 0 1px 0 rgba(255,255,255,0.03), 0 0 0 1px rgba(79, 162, 173, 0.16), 0 10px 22px rgba(79, 162, 173, 0.07)`
            : hoverRing
              ? hoverRing
            : isMagentic
              ? 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 0 0 1px rgba(96, 194, 255, 0.12), 0 12px 26px rgba(9, 18, 20, 0.2)'
              : isGraph
                ? 'inset 0 1px 0 rgba(255,255,255,0.03), inset 0 0 0 1px rgba(154, 162, 172, 0.1), 0 10px 24px rgba(0, 0, 0, 0.18)'
              : isCallableHead
                ? `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 0 0 1px rgba(79, 162, 173, 0.12), 0 12px 26px rgba(9, 18, 20, 0.16), 0 0 10px rgba(223, 146, 84, 0.06)`
              : `inset 0 1px 0 rgba(255,255,255,0.03), ${GRAPH_THEME.surface.shadow}`,
        }
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        aria-label={`${data.title} input`}
        isConnectable={canReceiveConnection}
        style={{
          width: 12,
          height: 12,
          left: -7,
          borderRadius: '999px',
          border: isFlowLinked
            ? '1.5px solid rgba(140, 116, 204, 0.42)'
            : '1.5px solid rgba(79, 162, 173, 0.38)',
          background: canReceiveConnection
            ? "radial-gradient(circle at 32% 28%, rgba(79,162,173,0.35), rgba(12,16,20,0.96))"
            : '#111315',
          boxShadow: canReceiveConnection
            ? isFlowLinked
              ? "inset 0 0 0 1px rgba(140,116,204,0.12), 0 0 0 1px rgba(79,162,173,0.1)"
              : "inset 0 0 0 1px rgba(79,162,173,0.12)"
            : undefined,
          opacity: canReceiveConnection ? 1 : 0.4,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        aria-label={`${data.title} output`}
        isConnectable={canStartConnection}
        style={{
          width: 12,
          height: 12,
          right: -7,
          borderRadius: '999px',
          border: isRuntimeActive
            ? `1.5px solid ${GRAPH_THEME.accent.solar}`
            : isFlowLinked
              ? '1.5px solid rgba(79, 162, 173, 0.48)'
              : `1.5px solid ${GRAPH_THEME.accent.primary}`,
          background: canStartConnection
            ? isRuntimeActive
              ? "radial-gradient(circle at 30% 26%, rgba(223,146,84,0.45), rgba(22,18,16,0.96))"
              : "radial-gradient(circle at 32% 28%, rgba(79,162,173,0.32), rgba(12,18,22,0.96))"
            : '#111315',
          boxShadow: canStartConnection
            ? isRuntimeActive
              ? "inset 0 0 0 1px rgba(255,200,160,0.12), 0 0 0 1px rgba(223,146,84,0.12)"
              : "inset 0 0 0 1px rgba(79,162,173,0.1)"
            : undefined,
          opacity: canStartConnection ? 1 : 0.4,
        }}
      />

      {isGraph ? (
        <div
          style={{
            position: 'absolute',
            left: 14,
            right: 14,
            top: 10,
            height: 4,
            borderRadius: 999,
            background: 'linear-gradient(90deg, rgba(154,162,172,0.92), rgba(210,214,221,0.4))',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0, paddingLeft: 2, paddingRight: 2 }}>
          {runtimeLabel && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 7px',
                marginBottom: 7,
                borderRadius: 999,
                  background: isMagentic
                    ? 'rgba(96, 194, 255, 0.14)'
                    : isGraph
                      ? 'rgba(154, 162, 172, 0.14)'
                      : isRuntimeActive
                        ? 'rgba(79, 162, 173, 0.18)'
                      : 'rgba(255,255,255,0.05)',
                  border: isMagentic
                    ? '1px solid rgba(96, 194, 255, 0.3)'
                    : isGraph
                      ? '1px solid rgba(154, 162, 172, 0.26)'
                      : isRuntimeActive
                        ? '1px solid rgba(79, 162, 173, 0.34)'
                      : '1px solid rgba(255,255,255,0.08)',
                  color: isMagentic
                    ? '#d8f2ff'
                    : isGraph
                      ? '#e8edf4'
                      : isRuntimeActive
                        ? '#d8f2ff'
                      : GRAPH_THEME.surface.mutedText,
                fontSize: 10,
                letterSpacing: '0.14em',
              }}
            >
              {runtimeLabel}
            </div>
          )}
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              lineHeight: 1.28,
              letterSpacing: "-0.015em",
            }}
          >
            {data.title}
          </div>
        </div>
        {executionOrder ? (
          <div
            style={{
              padding: '2px 7px',
              borderRadius: 999,
              background: 'rgba(223, 146, 84, 0.11)',
              border: '1px solid rgba(223, 146, 84, 0.22)',
              color: GRAPH_THEME.surface.text,
              fontSize: 10.5,
              fontWeight: 600,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            Step {executionOrder}
          </div>
        ) : null}
      </div>

      {data.subtitle && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            lineHeight: 1.5,
            paddingLeft: 2,
            paddingRight: 4,
            color: GRAPH_THEME.surface.mutedText,
            opacity: 0.72,
          }}
        >
          {data.subtitle}
        </div>
      )}

      {badges.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 5,
            marginTop: 11,
          }}
        >
          {badges.map((badge) => (
            <div
              key={badge}
              style={{
                padding: '3px 7px',
                borderRadius: 999,
                background:
                  badge === 'Callable'
                    ? 'rgba(79, 162, 173, 0.14)'
                    : badge === 'Branch+Merge'
                      ? GRAPH_THEME.accent.memorySoft
                    : badge === 'Compat Workflow'
                      ? 'rgba(234, 146, 77, 0.14)'
                    : badge === 'In Workflow'
                      ? 'rgba(234, 146, 77, 0.12)'
                      : String(badge).startsWith('Swarm x')
                        ? 'rgba(96, 194, 255, 0.14)'
                      : 'rgba(255,255,255,0.04)',
                border:
                  badge === 'Callable'
                    ? '1px solid rgba(79, 162, 173, 0.34)'
                    : badge === 'Branch+Merge'
                      ? `1px solid ${GRAPH_THEME.accent.memory}`
                    : badge === 'Compat Workflow'
                      ? '1px solid rgba(234, 146, 77, 0.3)'
                    : badge === 'In Workflow'
                      ? '1px solid rgba(234, 146, 77, 0.22)'
                      : String(badge).startsWith('Swarm x')
                        ? '1px solid rgba(96, 194, 255, 0.3)'
                      : '1px solid rgba(255,255,255,0.08)',
                color:
                  badge === 'Callable'
                    ? '#d8f2ff'
                    : badge === 'Branch+Merge'
                      ? '#e6ddff'
                    : badge === 'Compat Workflow'
                      ? '#ffe6d6'
                    : badge === 'In Workflow'
                      ? '#ffe6d6'
                      : String(badge).startsWith('Swarm x')
                        ? '#d8f2ff'
                      : GRAPH_THEME.surface.mutedText,
                fontSize: 10.5,
                lineHeight: 1.05,
              }}
            >
              {badge}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
