import { Handle, Position } from '@xyflow/react';
import type { AgentCardInstance } from '../../../types/agentgraph';
import { GRAPH_THEME, graphGlassCardStyle } from '../../graph/graphVisualTokens';
import { GRAPH_TEXT } from '../../graph/graphWorkspaceContract';
import { SEMANTIC_HANDLE_IDS } from '../deckValidation';

type AgentCardNodeData = AgentCardInstance & {
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
  const isGraph = runtimeType === 'graph_flow';
  const runtimeBinding = String(data?.runtimeBinding || '').trim();
  const isMainChat = runtimeBinding === 'main_chat';
  const isHermes = runtimeBinding === 'hermes_steward';
  const canJoinMagOne = !String(data?.parentGraphId || '').trim() && !isMainChat && !isHermes;
  const shellActive = Boolean(selected || data?.isInspecting || data?.isRuntimeActive);
  const name = String(data?.title || '').trim() || 'Agent';
  const subtext = String(data?.subtitle || '').replace(/\s+/g, ' ').trim() || 'Operational agent';
  const compactSubtext =
    subtext.length > 88 ? `${subtext.slice(0, 88).trimEnd()}…` : subtext;
  const tools = Array.isArray(data?.runtimeOptions?.tools)
    ? data.runtimeOptions.tools.map((tool) => String(tool).trim()).filter(Boolean)
    : [];
  const roleBadge = runtimeBinding === 'main_chat'
    ? 'Main'
    : runtimeBinding === 'hermes_steward'
      ? 'Hermes'
      : runtimeType === 'magentic_one'
        ? 'Mag One'
        : runtimeType === 'local_coder'
          ? 'Coder'
          : 'Worker';
  const graphToolCount = tools.filter((tool) => /thinkgraph|knowgraph|codegraph|hermes\.memory/.test(tool)).length;

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
        id={SEMANTIC_HANDLE_IDS.callInput}
        type="target"
        position={Position.Left}
        aria-label={`${name} direct call input`}
        title="Direct call input"
        isConnectable
        isConnectableStart={false}
        isConnectableEnd
        style={{
          width: 12,
          height: 12,
          left: -7,
          top: '72%',
          borderRadius: '999px',
          border: `1.5px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: `radial-gradient(circle at 32% 28%, ${GRAPH_THEME.accent.primarySoft}, rgba(12,16,20,0.96))`,
          boxShadow: `inset 0 0 0 1px ${GRAPH_THEME.accent.primarySoft}`,
        }}
      />
      <Handle
        id={SEMANTIC_HANDLE_IDS.callOutput}
        type="source"
        position={Position.Right}
        aria-label={`${name} direct call output`}
        title="Direct call output"
        isConnectable
        isConnectableStart
        isConnectableEnd={false}
        style={{
          width: 12,
          height: 12,
          right: -7,
          top: '72%',
          borderRadius: '999px',
          border: shellActive
            ? `1.5px solid ${GRAPH_THEME.accent.solar}`
            : `1.5px solid ${GRAPH_THEME.accent.primary}`,
          background: shellActive
            ? `radial-gradient(circle at 30% 26%, ${GRAPH_THEME.accent.solarSoft}, rgba(22,18,16,0.96))`
            : `radial-gradient(circle at 32% 28%, ${GRAPH_THEME.accent.primarySoft}, rgba(12,18,22,0.96))`,
          boxShadow: shellActive
            ? `inset 0 0 0 1px rgba(255,200,160,0.12), 0 0 0 1px ${GRAPH_THEME.accent.solarSoft}`
            : `inset 0 0 0 1px ${GRAPH_THEME.accent.primarySoft}`,
        }}
      />
      {canJoinMagOne ? (
        <>
          <Handle
            id={SEMANTIC_HANDLE_IDS.magOneMemberLeft}
            type="target"
            position={Position.Left}
            aria-label={`${name} Mag One membership input from the left`}
            title="Mag One team membership"
            isConnectable
            isConnectableStart={false}
            isConnectableEnd
            style={{ width: 9, height: 9, left: -5, top: '28%', background: '#22B8C7', border: '1px solid #9CF5F4' }}
          />
          <Handle
            id={SEMANTIC_HANDLE_IDS.magOneMemberRight}
            type="target"
            position={Position.Right}
            aria-label={`${name} Mag One membership input from the right`}
            title="Mag One team membership"
            isConnectable
            isConnectableStart={false}
            isConnectableEnd
            style={{ width: 9, height: 9, right: -5, top: '28%', background: '#22B8C7', border: '1px solid #9CF5F4' }}
          />
        </>
      ) : null}
      {isMainChat ? (
        <>
          <Handle
            id={SEMANTIC_HANDLE_IDS.magOneControlOutput}
            type="source"
            position={Position.Bottom}
            aria-label="Main Chat Mag One control submission output"
            title="Submit approved job to Mag One"
            isConnectable
            isConnectableStart
            isConnectableEnd={false}
            style={{ width: 14, height: 7, bottom: -4, left: '34%', background: '#52DCEB', border: '1px solid #BFFBFF' }}
          />
          <Handle
            id={SEMANTIC_HANDLE_IDS.hermesObserveOutput}
            type="source"
            position={Position.Top}
            aria-label="Main Chat Hermes observation output"
            title="Allow Hermes to observe Main Chat"
            isConnectable
            isConnectableStart
            isConnectableEnd={false}
            style={{ width: 12, height: 7, top: -4, left: '66%', background: '#77D6A6', border: '1px solid #C8F5DB' }}
          />
        </>
      ) : null}
      {isHermes ? (
        <Handle
          id={SEMANTIC_HANDLE_IDS.hermesObserveInput}
          type="target"
          position={Position.Top}
          aria-label="Hermes observation input from Main Chat"
          title="Observe Main Chat"
          isConnectable
          isConnectableStart={false}
          isConnectableEnd
          style={{ width: 12, height: 7, top: -4, left: '50%', background: '#77D6A6', border: '1px solid #C8F5DB' }}
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
        <div
          aria-label={`${roleBadge}; ${tools.length} granted tool${tools.length === 1 ? '' : 's'}`}
          style={{
            display: 'flex',
            gap: 4,
            alignItems: 'center',
            marginTop: 2,
            minWidth: 0,
            color: GRAPH_THEME.surface.mutedText,
            fontSize: 9,
            lineHeight: 1.1,
          }}
        >
          <span style={{ color: runtimeBinding === 'main_chat' ? GRAPH_THEME.accent.solar : GRAPH_THEME.accent.primary }}>
            {roleBadge}
          </span>
          <span>· {tools.length} tool{tools.length === 1 ? '' : 's'}</span>
          {graphToolCount > 0 ? <span title={`${graphToolCount} graph or memory permission${graphToolCount === 1 ? '' : 's'}`}>· graph</span> : null}
        </div>
      </div>
    </div>
  );
}
