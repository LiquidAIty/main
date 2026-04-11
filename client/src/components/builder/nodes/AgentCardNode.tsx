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
  const runtimeLabel = isMagentic ? 'MAGENTIC' : 'ASSIST';
  const structureLabel =
    data?.assistStructureMode === 'branch_merge'
      ? 'Branch+Merge'
      : data?.assistStructureMode === 'branch'
      ? 'Branch'
      : data?.assistStructureMode === 'merge'
        ? 'Merge'
      : data?.assistStructureMode === 'seq'
        ? 'Seq'
        : runtimeType === 'assistant_agent'
          ? 'Single'
          : null;
  const badges = [
    data?.isStartCard ? 'Start' : null,
    isCallableHead ? 'Callable' : null,
    isGraph ? 'Compat' : null,
    structureLabel,
    data?.swarmBadge || null,
  ].filter(Boolean);
  const isRuntimeActive = Boolean(data?.isRuntimeActive);
  const hoverRing =
    !selected && data?.isHovered
      ? `0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 14px 28px ${GRAPH_THEME.accent.primaryGlow}`
      : !selected && data?.isHoverRelated
        ? `0 0 0 1px rgba(79, 162, 173, 0.12), ${GRAPH_THEME.surface.shadow}`
        : null;
  return (
    <div
      className={`rounded-xl border p-4 min-w-[258px] bg-zinc-900 text-white ${
        selected ? 'ring-2 ring-cyan-400' : ''
      }`}
      style={
        {
          position: 'relative',
          borderWidth: isGraph ? 1.5 : 1,
          borderColor: selected
            ? GRAPH_THEME.accent.primary
            : isRuntimeActive
              ? GRAPH_THEME.accent.primary
            : isMagentic
              ? 'rgba(96, 194, 255, 0.82)'
              : isGraph
                ? GRAPH_THEME.accent.graph
              : isCallableHead
                ? GRAPH_THEME.accent.primaryBorder
              : GRAPH_THEME.surface.border,
          background: isMagentic
            ? 'linear-gradient(180deg, rgba(14,28,35,0.98), rgba(10,18,22,0.98))'
            : isGraph
              ? 'linear-gradient(180deg, rgba(31,34,38,0.98), rgba(18,21,24,0.98))'
            : 'linear-gradient(180deg, rgba(28,31,34,0.98), rgba(18,21,24,0.98))',
          boxShadow: selected
            ? `0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 18px 36px ${GRAPH_THEME.accent.primaryGlow}`
            : isRuntimeActive
              ? `0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 18px 36px ${GRAPH_THEME.accent.primaryGlow}`
            : hoverRing
              ? hoverRing
            : isMagentic
              ? 'inset 0 0 0 1px rgba(96, 194, 255, 0.14), 0 14px 30px rgba(9, 18, 20, 0.22)'
              : isGraph
                ? 'inset 0 0 0 1px rgba(154, 162, 172, 0.12), 0 12px 28px rgba(0, 0, 0, 0.2)'
              : isCallableHead
                ? 'inset 0 0 0 1px rgba(79, 162, 173, 0.14), 0 14px 30px rgba(9, 18, 20, 0.18)'
              : GRAPH_THEME.surface.shadow,
        }
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        aria-label={`${data.title} input`}
        isConnectable={canReceiveConnection}
        style={{
          width: 14,
          height: 14,
          left: -8,
          borderRadius: '999px',
          border: '2px solid rgba(148, 163, 184, 0.95)',
          background: canReceiveConnection ? GRAPH_THEME.surface.base : '#111315',
          opacity: canReceiveConnection ? 1 : 0.4,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        aria-label={`${data.title} output`}
        isConnectable={canStartConnection}
        style={{
          width: 14,
          height: 14,
          right: -8,
          borderRadius: '999px',
          border: `2px solid ${GRAPH_THEME.accent.primary}`,
          background: canStartConnection ? 'rgba(18,35,41,0.98)' : '#111315',
          opacity: canStartConnection ? 1 : 0.4,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 18,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 10,
          letterSpacing: '0.16em',
          color: GRAPH_THEME.surface.mutedText,
          pointerEvents: 'none',
        }}
      >
        IN
      </div>
      <div
        style={{
          position: 'absolute',
          right: 18,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 10,
          letterSpacing: '0.16em',
          color: GRAPH_THEME.accent.primary,
          pointerEvents: 'none',
        }}
      >
        OUT
      </div>

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
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 8px',
              marginBottom: 8,
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
          <div className="text-sm font-semibold" style={{ lineHeight: 1.3 }}>
            {data.title}
          </div>
        </div>
        {executionOrder ? (
          <div
            style={{
              padding: '3px 8px',
              borderRadius: 999,
              background: GRAPH_THEME.accent.primarySoft,
              border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
              color: GRAPH_THEME.surface.text,
              fontSize: 11,
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
          className="text-xs opacity-70 mt-1"
          style={{ lineHeight: 1.45, paddingRight: 18, color: GRAPH_THEME.surface.mutedText }}
        >
          {data.subtitle}
        </div>
      )}

      {badges.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 12,
          }}
        >
          {badges.map((badge) => (
            <div
              key={badge}
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                background:
                  badge === 'Callable'
                    ? 'rgba(79, 162, 173, 0.14)'
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
                    : badge === 'Compat Workflow'
                      ? '#ffe6d6'
                    : badge === 'In Workflow'
                      ? '#ffe6d6'
                      : String(badge).startsWith('Swarm x')
                        ? '#d8f2ff'
                      : GRAPH_THEME.surface.mutedText,
                fontSize: 11,
                lineHeight: 1,
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
