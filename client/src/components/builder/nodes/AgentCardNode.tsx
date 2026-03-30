import { Handle, Position } from '@xyflow/react';
import type { AgentCardInstance } from '../../../types/agentgraph';

type AgentCardNodeData = AgentCardInstance & {
  executionOrder?: number | null;
  isStartCard?: boolean;
  readsFromBlackboard?: boolean;
  writesToBlackboard?: boolean;
};

export default function AgentCardNode({
  data,
  selected,
}: {
  data: AgentCardNodeData;
  selected?: boolean;
}) {
  const isBlackboard = data?.kind === 'blackboard';
  const executionOrder = typeof data?.executionOrder === 'number' ? data.executionOrder : null;
  const runtimeLabel = isBlackboard
    ? 'BLACKBOARD'
    : data?.runtimeBinding
      ? String(data.runtimeBinding).split('_').join(' ').toUpperCase()
      : /summary/i.test(String(data?.title || ''))
        ? 'SUMMARY'
        : 'INTERNAL STEP';
  const badges = [
    data?.isStartCard ? 'Start' : null,
    data?.readsFromBlackboard ? 'Reads board' : null,
    data?.writesToBlackboard ? 'Writes board' : null,
  ].filter(Boolean);
  return (
    <div
      className={`rounded-xl border p-4 min-w-[258px] bg-zinc-900 text-white ${
        selected ? 'ring-2 ring-cyan-400' : ''
      }`}
      style={
        {
          position: 'relative',
          borderColor: selected
            ? 'rgba(79, 162, 173, 0.98)'
            : isBlackboard
              ? 'rgba(79, 162, 173, 0.72)'
              : 'rgba(64, 71, 78, 0.96)',
          background: isBlackboard
            ? 'linear-gradient(180deg, rgba(17,31,35,0.98), rgba(13,20,24,0.98))'
            : 'linear-gradient(180deg, rgba(28,31,34,0.98), rgba(18,21,24,0.98))',
          boxShadow: selected
            ? '0 0 0 1px rgba(79, 162, 173, 0.22), 0 18px 36px rgba(79, 162, 173, 0.18)'
            : isBlackboard
              ? 'inset 0 0 0 1px rgba(79, 162, 173, 0.22), 0 14px 30px rgba(9, 18, 20, 0.22)'
              : '0 14px 30px rgba(0,0,0,0.22)',
        }
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        aria-label={`${data.title} input`}
        style={{
          width: 14,
          height: 14,
          left: -8,
          borderRadius: '999px',
          border: '2px solid rgba(148, 163, 184, 0.95)',
          background: '#161a1d',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        aria-label={`${data.title} output`}
        style={{
          width: 14,
          height: 14,
          right: -8,
          borderRadius: '999px',
          border: '2px solid rgba(79, 162, 173, 0.96)',
          background: '#122329',
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
          color: 'rgba(148, 163, 184, 0.82)',
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
          color: 'rgba(79, 162, 173, 0.86)',
          pointerEvents: 'none',
        }}
      >
        OUT
      </div>

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
              background: isBlackboard ? 'rgba(79, 162, 173, 0.14)' : 'rgba(255,255,255,0.05)',
              border: isBlackboard
                ? '1px solid rgba(79, 162, 173, 0.3)'
                : '1px solid rgba(255,255,255,0.08)',
              color: isBlackboard ? '#d8ecee' : 'rgba(224, 222, 213, 0.88)',
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
        {!isBlackboard && executionOrder ? (
          <div
            style={{
              padding: '3px 8px',
              borderRadius: 999,
              background: 'rgba(79, 162, 173, 0.14)',
              border: '1px solid rgba(79, 162, 173, 0.34)',
              color: '#dce7ea',
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
        <div className="text-xs opacity-70 mt-1" style={{ lineHeight: 1.45, paddingRight: 18 }}>
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
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(224, 222, 213, 0.92)',
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
