import { Handle, Position } from '@xyflow/react';
import type { AgentCardInstance, KanbanCardRunStatus } from '../../../types/agentgraph';
import { GRAPH_THEME, graphGlassCardStyle } from '../../graph/graphVisualTokens';
import { GRAPH_TEXT } from '../../graph/graphWorkspaceContract';

type AgentCardNodeData = AgentCardInstance & {
  assistStructureMode?: 'single' | 'seq' | 'branch' | 'merge' | 'branch_merge' | null;
  swarmBadge?: string | null;
  isRuntimeActive?: boolean;
  isHovered?: boolean;
  isHoverRelated?: boolean;
  isFlowLinked?: boolean;
  isInspecting?: boolean;
  kanbanRunStatus?: KanbanCardRunStatus | null;
};

function compactCount(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function compactElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function AgentCardNode({
  data,
  selected,
}: {
  data: AgentCardNodeData;
  selected?: boolean;
}) {
  const canReceiveConnection = true;
  const canStartConnection = true;
  const shellActive = Boolean(selected || data?.isInspecting || data?.isRuntimeActive);
  const isHermesCard = data?.runtime?.kind === 'hermes';
  const isKanbanCard = isHermesCard && data?.runtime?.mode === 'kanban';
  const kanban = isKanbanCard ? data.kanbanRunStatus : null;
  const name = String(data?.title || '').trim() || 'Agent';
  const subtext = String(data?.subtitle || '').replace(/\s+/g, ' ').trim() || 'Operational agent';
  const compactSubtext =
    subtext.length > 88 ? `${subtext.slice(0, 88).trimEnd()}…` : subtext;

  return (
    <div
      className="border bg-zinc-900 text-white"
      data-runtime-kind={data?.runtime?.kind || 'unknown'}
      style={
        graphGlassCardStyle({
          position: 'relative',
          padding: '8px 9px',
          width: kanban ? 224 : isHermesCard ? 112 : 124,
          minHeight: kanban ? 182 : isHermesCard ? 112 : 90,
          aspectRatio: kanban ? undefined : isHermesCard ? '1 / 1' : undefined,
          borderRadius: isHermesCard ? 28 : 12,
          borderWidth: 1,
          borderColor: shellActive
            ? 'rgba(55,173,170,0.6)'
            : selected
              ? GRAPH_THEME.accent.primaryBorder
              : GRAPH_THEME.card.glassBorder,
          background: GRAPH_THEME.card.glassBackground,
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
        {kanban ? (
          <div
            data-testid="kanban-card-run-status"
            data-run-id={kanban.runId}
            style={{
              display: 'grid',
              gap: 5,
              marginTop: 3,
              paddingTop: 6,
              borderTop: `1px solid ${GRAPH_THEME.card.glassBorder}`,
              color: GRAPH_THEME.surface.mutedText,
              fontSize: 9,
              lineHeight: 1.2,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ color: GRAPH_THEME.accent.primary, textTransform: 'uppercase' }}>
                {kanban.status}
              </strong>
              <span>{kanban.tasksCompleted}/{kanban.tasksTotal} tasks · {kanban.activeWorkers} active · {compactElapsed(kanban.elapsedMs)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px' }}>
              <span>Tools {compactCount(kanban.toolCallCount)}</span>
              <span>Graph {kanban.graphReads}R/{kanban.graphWrites}W</span>
              <span>Tokens {compactCount(kanban.inputTokens)} in/{compactCount(kanban.outputTokens)} out</span>
              <span>Cache {compactCount(kanban.cachedTokens)} · Reason {compactCount(kanban.reasoningTokens)}</span>
              <span>Cost ${kanban.costUsd.toFixed(4)}</span>
              <span>{kanban.resultReady ? 'Result ready' : 'Result pending'}</span>
            </div>
            <div
              title={kanban.nativeRootId || undefined}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.78 }}
            >
              Root {kanban.nativeRootId || 'pending'}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
