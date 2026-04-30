import { Handle, Position } from '@xyflow/react';
import type { AgentCardInstance } from '../../../types/agentgraph';
import { GRAPH_THEME, graphGlassCardStyle } from '../../graph/graphVisualTokens';
import { GRAPH_TEXT } from '../../graph/graphWorkspaceContract';

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

function NrgSimCubeIcon() {
  return (
    <svg
      width="22"
      height="18"
      viewBox="0 0 22 18"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 auto' }}
    >
      <path
        d="M7.2 4.2 13.2 1.6 19 4.7v8.5l-6 3.2-6-3.1V4.2Z"
        stroke="rgba(157, 239, 238, 0.9)"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M7.2 4.2 13 7.4l6-2.7M13 7.4v9M4 6.7l3.2-2.5M4 6.7v8.5l6 1.2"
        stroke="rgba(224, 247, 246, 0.62)"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AgentCardNode({
  data,
  selected,
}: {
  data: AgentCardNodeData;
  selected?: boolean;
}) {
  const runtimeType = String(data?.runtimeType || 'assistant_agent').trim();
  const isGraph = runtimeType === 'graph_flow';
  const canReceiveConnection = true;
  const canStartConnection = true;
  const shellActive = Boolean(selected || data?.isInspecting || data?.isRuntimeActive);
  const name = String(data?.title || '').trim() || 'Agent';
  const subtext = String(data?.subtitle || '').replace(/\s+/g, ' ').trim() || 'Operational agent';
  const isEnergyWorkbench =
    String(data?.id || '').trim() === 'card_energy_workbench' ||
    String(data?.templateId || '').trim() === 'template_energy_workbench';
  const compactSubtext =
    subtext.length > 88 ? `${subtext.slice(0, 88).trimEnd()}…` : subtext;

  return (
    <div
      className="rounded-xl border bg-zinc-900 text-white"
      style={
        graphGlassCardStyle({
          position: 'relative',
          padding: '8px 9px',
          width: 124,
          minHeight: 90,
          borderWidth: 1,
          borderColor: shellActive
            ? 'rgba(55,173,170,0.6)'
            : selected
              ? GRAPH_THEME.accent.primaryBorder
              : GRAPH_THEME.card.glassBorder,
          background: isGraph
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
          alignContent: 'start',
          gap: 3,
          position: 'relative',
          zIndex: 1,
          height: '100%',
          minHeight: 54,
        }}
      >
        <div
          style={{
            fontSize: GRAPH_TEXT.titlePx,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: '-0.01em',
            color: GRAPH_THEME.surface.text,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {isEnergyWorkbench ? <NrgSimCubeIcon /> : null}
          <span>{name}</span>
        </div>
        <div
          style={{
            fontSize: GRAPH_TEXT.bodyPx,
            lineHeight: 1.24,
            color: GRAPH_THEME.surface.mutedText,
            opacity: 0.84,
            maxWidth: 104,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {compactSubtext}
        </div>
      </div>
    </div>
  );
}
