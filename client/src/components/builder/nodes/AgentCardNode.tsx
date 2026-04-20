import { Handle, Position } from '@xyflow/react';
import type { AgentCardInstance } from '../../../types/agentgraph';
import { GRAPH_THEME, graphGlassCardStyle } from '../../graph/graphVisualTokens';

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
  isInspecting?: boolean;
};

export default function AgentCardNode({
  data,
  selected,
}: {
  data: AgentCardNodeData;
  selected?: boolean;
}) {
  const runtimeType = String(data?.runtimeType || 'assistant_agent').trim();
  const isMagentic = runtimeType === 'magentic_one';
  const isGraph = runtimeType === 'graph_flow';
  if (isMagentic) return null;
  const canReceiveConnection = !isMagentic;
  const canStartConnection = isMagentic || runtimeType === 'assistant_agent';
  const shellActive = Boolean(selected || data?.isInspecting || data?.isRuntimeActive);
  const name = String(data?.title || '').trim() || 'Agent';
  const subtext = String(data?.subtitle || '').trim() || 'Operational agent';

  return (
    <div
      className="rounded-xl border bg-zinc-900 text-white"
      style={
        graphGlassCardStyle({
          position: 'relative',
          padding: '8px 10px',
          width: 214,
          minHeight: 72,
          borderWidth: 1,
          borderColor: shellActive
            ? 'rgba(55,173,170,0.6)'
            : selected
              ? GRAPH_THEME.accent.primaryBorder
              : GRAPH_THEME.card.glassBorder,
          background: isMagentic
            ? GRAPH_THEME.card.glassMagenticBackground
            : isGraph
              ? GRAPH_THEME.card.glassGraphBackground
              : GRAPH_THEME.card.glassBackground,
          boxShadow: shellActive
            ? `${GRAPH_THEME.card.glassInset}, 0 0 0 1px rgba(55,173,170,0.6), 0 14px 30px rgba(55,173,170,0.24), 0 0 16px rgba(242,166,74,0.16)`
            : selected
              ? `${GRAPH_THEME.card.glassInset}, 0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 14px 28px ${GRAPH_THEME.accent.primaryGlow}`
              : `${GRAPH_THEME.card.glassInset}, ${GRAPH_THEME.surface.shadow}`,
        })
      }
    >
      <style>{`
        @keyframes agent-shell-border-travel {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -1,
          borderRadius: 14,
          padding: 1,
          background:
            'conic-gradient(from 0deg, rgba(55,173,170,0.14), #37ADAA 20%, #2B8C8A 40%, #F2A64A 63%, #C97C2A 84%, rgba(55,173,170,0.14) 100%)',
          opacity: shellActive ? 0.92 : 0.12,
          animation: shellActive ? 'agent-shell-border-travel 6.8s linear infinite' : 'none',
          transition: 'opacity 220ms ease',
          pointerEvents: 'none',
          WebkitMask:
            'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          zIndex: 0,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        aria-label={`${name} input`}
        isConnectable={canReceiveConnection}
        style={{
          width: 12,
          height: 12,
          left: -7,
          borderRadius: '999px',
          border: `1.5px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: canReceiveConnection
            ? `radial-gradient(circle at 32% 28%, ${GRAPH_THEME.accent.primarySoft}, rgba(12,16,20,0.96))`
            : '#111315',
          boxShadow: canReceiveConnection ? `inset 0 0 0 1px ${GRAPH_THEME.accent.primarySoft}` : undefined,
          opacity: canReceiveConnection ? 1 : 0.4,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        aria-label={`${name} output`}
        isConnectable={canStartConnection}
        style={{
          width: 12,
          height: 12,
          right: -7,
          borderRadius: '999px',
          border: shellActive
            ? `1.5px solid ${GRAPH_THEME.accent.solar}`
            : `1.5px solid ${GRAPH_THEME.accent.primary}`,
          background: canStartConnection
            ? shellActive
              ? `radial-gradient(circle at 30% 26%, ${GRAPH_THEME.accent.solarSoft}, rgba(22,18,16,0.96))`
              : `radial-gradient(circle at 32% 28%, ${GRAPH_THEME.accent.primarySoft}, rgba(12,18,22,0.96))`
            : '#111315',
          boxShadow: canStartConnection
            ? shellActive
              ? `inset 0 0 0 1px rgba(255,200,160,0.12), 0 0 0 1px ${GRAPH_THEME.accent.solarSoft}`
              : `inset 0 0 0 1px ${GRAPH_THEME.accent.primarySoft}`
            : undefined,
          opacity: canStartConnection ? 1 : 0.4,
        }}
      />

      <div
        style={{
          display: 'grid',
          alignContent: 'center',
          gap: 4,
          position: 'relative',
          zIndex: 1,
          height: '100%',
          minHeight: 50,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: '-0.01em',
            color: GRAPH_THEME.surface.text,
            minWidth: 0,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 10.5,
            lineHeight: 1.3,
            color: GRAPH_THEME.surface.mutedText,
            opacity: 0.84,
            maxWidth: 172,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            minWidth: 0,
          }}
        >
          {subtext}
        </div>
      </div>
    </div>
  );
}
