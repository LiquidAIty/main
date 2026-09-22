import { Handle, Position } from '@xyflow/react';
import type { AgentCardInstance } from '../../../types/agentgraph';
import { GRAPH_THEME, graphGlassCardStyle } from '../../graph/graphVisualTokens';
import { GRAPH_TEXT } from '../../graph/graphWorkspaceContract';
import { hasMainBotAuthority } from '../../../features/agentbuilder/deck/deckPrimitives';

type AgentCardNodeData = AgentCardInstance & {
  busX?: number;
  assistStructureMode?: 'single' | 'seq' | 'branch' | 'merge' | 'branch_merge' | null;
  swarmBadge?: string | null;
  isRuntimeActive?: boolean;
  isHovered?: boolean;
  isHoverRelated?: boolean;
  isFlowLinked?: boolean;
  isInspecting?: boolean;
  activeAgentCount?: number;
};

export default function AgentCardNode({
  data,
  selected,
}: {
  data: AgentCardNodeData;
  selected?: boolean;
}) {
  const canReceiveConnection = true;
  const canStartConnection = true;
  const mainBotSource = hasMainBotAuthority(data);
  const isMainCard = data.kind === 'agent'
    && data.runtime.kind === 'hermes'
    && data.runtime.mode === 'main';
  const busOnRight = data.busX === undefined || data.position.x < data.busX;
  const bluePosition = busOnRight ? Position.Right : Position.Left;
  const orangePosition = busOnRight ? Position.Left : Position.Right;
  const blueSide = busOnRight ? { right: -7, left: 'auto' } : { left: -7, right: 'auto' };
  const orangeSide = busOnRight ? { left: -7, right: 'auto' } : { right: -7, left: 'auto' };
  const shellActive = Boolean(selected || data?.isInspecting || data?.isRuntimeActive);
  const activeAgentCount = Number.isSafeInteger(data?.activeAgentCount) && Number(data.activeAgentCount) > 0
    ? Number(data.activeAgentCount)
    : 0;
  const name = String(data?.title || '').trim() || 'Agent';
  const subtext = String(data?.subtitle || '').replace(/\s+/g, ' ').trim() || 'Operational agent';
  const compactSubtext =
    subtext.length > 88 ? `${subtext.slice(0, 88).trimEnd()}…` : subtext;
  const shellBorderColor = shellActive
    ? 'rgba(55,173,170,0.6)'
    : selected
      ? GRAPH_THEME.accent.primaryBorder
      : GRAPH_THEME.card.glassBorder;
  const shellShadow = shellActive
    ? `${GRAPH_THEME.card.glassInset}, 0 0 0 1px rgba(55,173,170,0.6), 0 14px 30px rgba(55,173,170,0.24), 0 0 16px rgba(242,166,74,0.16)`
    : selected
      ? `${GRAPH_THEME.card.glassInset}, 0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 14px 28px ${GRAPH_THEME.accent.primaryGlow}`
      : `${GRAPH_THEME.card.glassInset}, ${GRAPH_THEME.surface.shadow}`;

  return (
    <div
      className={isMainCard ? 'text-white' : 'rounded-xl border bg-zinc-900 text-white'}
      data-card-shape={isMainCard ? 'hexagon' : 'rounded'}
      style={
        graphGlassCardStyle({
          position: 'relative',
          padding: isMainCard ? '13px 22px' : '8px 9px',
          width: isMainCard ? 136 : 124,
          minHeight: isMainCard ? 104 : 90,
          borderWidth: isMainCard ? 0 : 1,
          borderColor: shellBorderColor,
          borderRadius: isMainCard ? 0 : 14,
          background: isMainCard ? 'transparent' : GRAPH_THEME.card.glassBackground,
          boxShadow: isMainCard ? 'none' : shellShadow,
          backdropFilter: isMainCard ? 'none' : 'blur(14px) saturate(120%)',
          WebkitBackdropFilter: isMainCard ? 'none' : 'blur(14px) saturate(120%)',
        })
      }
    >
      {isMainCard ? (
        <div
          aria-hidden="true"
          data-testid="main-card-hexagon"
          style={{
            position: 'absolute',
            inset: 0,
            clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
            background: shellBorderColor,
            filter: shellActive
              ? 'drop-shadow(0 14px 24px rgba(55,173,170,0.24))'
              : 'drop-shadow(0 12px 20px rgba(0,0,0,0.28))',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 1,
              clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
              background: GRAPH_THEME.card.glassBackground,
              boxShadow: shellShadow,
              backdropFilter: 'blur(14px) saturate(120%)',
              WebkitBackdropFilter: 'blur(14px) saturate(120%)',
            }}
          />
        </div>
      ) : null}
      <Handle
        id="card-control-target"
        className="card-control-target"
        type="target"
        position={orangePosition}
        aria-label={`${name} bot input`}
        isConnectable={canReceiveConnection}
        style={{
          width: 10,
          height: 30,
          ...orangeSide,
          border: 'none',
          borderRadius: 5,
          background: 'transparent',
          boxShadow: 'none',
          opacity: 0,
          pointerEvents: 'all',
        }}
      />
      <Handle
        type="target"
        position={bluePosition}
        aria-label={`${name} input`}
        isConnectable={canReceiveConnection}
        style={{
          width: 12,
          height: 12,
          ...blueSide,
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
        position={bluePosition}
        aria-label={`${name} Magnetic worker output`}
        isConnectable={canStartConnection}
        style={{
          width: 12,
          height: 12,
          ...blueSide,
          borderRadius: '999px',
          border: `1.5px solid ${GRAPH_THEME.accent.primary}`,
          background: canStartConnection
            ? `radial-gradient(circle at 32% 28%, ${GRAPH_THEME.accent.primarySoft}, rgba(12,18,22,0.96))`
            : '#111315',
          boxShadow: canStartConnection
            ? `inset 0 0 0 1px ${GRAPH_THEME.accent.primarySoft}`
            : undefined,
          opacity: canStartConnection ? 1 : 0.4,
        }}
      />
      {mainBotSource ? (
        <Handle
          id="card-control"
          type="source"
          position={orangePosition}
          aria-label={`${name} bot output`}
          style={{
            width: 12,
            height: 12,
            ...orangeSide,
            borderRadius: '999px',
            border: `1.5px solid ${GRAPH_THEME.accent.solar}`,
            background: `radial-gradient(circle at 30% 26%, ${GRAPH_THEME.accent.solarSoft}, rgba(22,18,16,0.96))`,
          }}
        />
      ) : null}

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
          <span>{name}</span>
          {activeAgentCount > 0 ? (
            <span
              data-testid="active-agent-count"
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                minWidth: 15,
                height: 15,
                padding: '0 4px',
                borderRadius: 999,
                background: GRAPH_THEME.accent.primarySoft,
                color: GRAPH_THEME.surface.text,
                fontSize: 9,
                fontWeight: 800,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {activeAgentCount}
            </span>
          ) : null}
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
