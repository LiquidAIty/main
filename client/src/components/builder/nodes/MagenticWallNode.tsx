import { Handle, Position } from '@xyflow/react';
import { GRAPH_THEME, graphGlassPillStyle } from '../../graph/graphVisualTokens';

type MagenticWallNodeData = {
  title?: string;
  subtitle?: string;
  isInspecting?: boolean;
};

export default function MagenticWallNode({
  data,
  selected,
}: {
  data: MagenticWallNodeData;
  selected?: boolean;
}) {
  const title = String(data?.title || 'Magentic-One');
  const subtitle = String(data?.subtitle || 'Orchestration wall');
  const isActive = Boolean(selected || data?.isInspecting);

  return (
    <div
      style={{
        position: 'relative',
        width: 26,
        minHeight: 200,
        borderRadius: 12,
        border: `1px solid ${isActive ? 'rgba(55,173,170,0.56)' : 'rgba(55,173,170,0.24)'}`,
        background:
          'linear-gradient(180deg, rgba(17,22,29,0.94), rgba(11,14,18,0.98))',
        boxShadow: isActive
          ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 22px rgba(55,173,170,0.22)'
          : 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 16px rgba(0,0,0,0.18)',
        pointerEvents: 'all',
      }}
      title={`${title}: ${subtitle}`}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="wall-out"
        style={{
          width: 12,
          height: 12,
          right: -7,
          top: '30%',
          borderRadius: '999px',
          border: `1.5px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background:
            'radial-gradient(circle at 32% 28%, rgba(55,173,170,0.4), rgba(12,16,20,0.96))',
        }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="wall-in"
        style={{
          width: 12,
          height: 12,
          right: -7,
          top: '70%',
          borderRadius: '999px',
          border: `1.5px solid ${GRAPH_THEME.accent.solarSoft}`,
          background:
            'radial-gradient(circle at 32% 28%, rgba(242,166,74,0.34), rgba(22,18,16,0.96))',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 3,
          top: 34,
          width: 20,
          height: 32,
          borderRadius: 8,
          border: `1px solid ${isActive ? 'rgba(55,173,170,0.52)' : 'rgba(55,173,170,0.22)'}`,
          background:
            'linear-gradient(180deg, rgba(55,173,170,0.14), rgba(43,140,138,0.1), rgba(242,166,74,0.08))',
          boxShadow: isActive ? '0 0 12px rgba(55,173,170,0.22)' : 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 32,
          top: 24,
          whiteSpace: 'nowrap',
          ...graphGlassPillStyle({
            padding: '4px 8px',
            fontSize: 10.5,
            color: GRAPH_THEME.surface.text,
            border: `1px solid ${isActive ? 'rgba(55,173,170,0.42)' : GRAPH_THEME.card.pillBorder}`,
            background: 'rgba(11,14,18,0.92)',
          }),
        }}
      >
        {title}
      </div>
    </div>
  );
}

