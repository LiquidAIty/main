import { useMemo } from 'react';

import type { NativeHermesCardView } from './nativeHermesCard';

type LearningGraph = NativeHermesCardView['native']['learning']['graph'];

type PositionedNode = LearningGraph['nodes'][number] & { x: number; y: number };

const WIDTH = 680;
const HEIGHT = 360;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const MAX_RADIUS = 145;

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** A small pure SVG port of Hermes' native starmap semantics: time is radial,
 * category controls angle, skills are stars/circles, memories are diamonds,
 * and only native producer edges are drawn. It owns no learning data. */
export default function HermesSkillGraph({
  graph,
  profile,
  onOpenNode,
}: {
  graph: LearningGraph;
  profile: string;
  onOpenNode: (id: string) => void;
}) {
  const layout = useMemo(() => {
    const timestamps = graph.nodes
      .map((node) => Number(node.timestamp || 0))
      .filter((value) => value > 0);
    const oldest = timestamps.length ? Math.min(...timestamps) : 0;
    const newest = timestamps.length ? Math.max(...timestamps) : oldest;
    const span = Math.max(1, newest - oldest);
    const categories = [...new Set(graph.nodes.map((node) => String(node.category || node.kind || 'general')))].sort();
    const categoryIndex = new Map(categories.map((category, index) => [category, index]));
    const positioned: PositionedNode[] = graph.nodes.map((node, index) => {
      const category = String(node.category || node.kind || 'general');
      const categorySlot = categoryIndex.get(category) || 0;
      const baseAngle = (Math.PI * 2 * categorySlot) / Math.max(1, categories.length);
      const jitter = ((hash(node.id) % 1000) / 1000 - 0.5) * Math.min(0.8, Math.PI / Math.max(2, categories.length));
      const timestamp = Number(node.timestamp || 0);
      const recency = timestamp > 0 ? (timestamp - oldest) / span : index / Math.max(1, graph.nodes.length - 1);
      const radius = 34 + recency * (MAX_RADIUS - 34);
      return {
        ...node,
        x: CX + Math.cos(baseAngle + jitter) * radius,
        y: CY + Math.sin(baseAngle + jitter) * radius * 0.72,
      };
    });
    return { nodes: positioned, byId: new Map(positioned.map((node) => [node.id, node])) };
  }, [graph]);

  if (!graph.nodes.length) {
    return (
      <div role="status" style={{ padding: 12, color: '#91A9B8', fontSize: 11 }}>
        Profile {profile} has no native learned-skill or memory nodes yet. Nothing is synthesized.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Hermes learning starmap for profile ${profile}`}
        style={{ width: '100%', minHeight: 280, borderRadius: 8, background: 'radial-gradient(circle, #182526 0%, #111718 72%)' }}
      >
        {[0.28, 0.52, 0.76, 1].map((ratio) => (
          <ellipse
            key={ratio}
            cx={CX}
            cy={CY}
            rx={MAX_RADIUS * ratio}
            ry={MAX_RADIUS * ratio * 0.72}
            fill="none"
            stroke="#496267"
            strokeOpacity={0.28}
            strokeWidth={1}
          />
        ))}
        {graph.edges.map((edge) => {
          const source = layout.byId.get(edge.source);
          const target = layout.byId.get(edge.target);
          return source && target ? (
            <line
              key={`${edge.source}:${edge.target}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="#76A7AD"
              strokeOpacity={0.38}
              strokeWidth={1}
            />
          ) : null;
        })}
        {layout.nodes.map((node) => {
          const memory = node.kind === 'memory';
          const size = memory ? 7 : Math.min(10, 5 + Math.log2(1 + Number(node.useCount || 0)));
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`${node.kind}: ${node.label}`}
              onClick={() => onOpenNode(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpenNode(node.id);
              }}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              {memory ? (
                <rect
                  x={node.x - size / 2}
                  y={node.y - size / 2}
                  width={size}
                  height={size}
                  transform={`rotate(45 ${node.x} ${node.y})`}
                  fill="#D2A86B"
                  stroke="#F1D5A8"
                />
              ) : (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={size}
                  fill={node.createdBy === 'agent' ? '#72D7C7' : '#79A7D8'}
                  stroke={node.pinned ? '#FFF0B6' : '#C8F5EE'}
                  strokeWidth={node.pinned ? 2 : 1}
                />
              )}
              <title>{`${node.label} · ${node.category || node.kind}${node.useCount ? ` · ${node.useCount} uses` : ''}`}</title>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, color: '#91A9B8', fontSize: 10, flexWrap: 'wrap' }}>
        <span>○ learned skill</span>
        <span>◇ profile memory</span>
        <span>center → older · outer rings → newer</span>
        <span>{graph.nodes.length} native nodes · {graph.edges.length} native edges</span>
      </div>
    </div>
  );
}
