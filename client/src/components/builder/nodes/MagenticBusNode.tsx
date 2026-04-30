import { Handle, Position } from '@xyflow/react';

const leftHandles = [
  { id: 'bus-in-1', top: '35%' },
  { id: 'bus-in-2', top: '65%' },
];

const rightHandles = [
  { id: 'bus-out-1', top: '18%' },
  { id: 'bus-out-2', top: '39%' },
  { id: 'bus-out-3', top: '60%' },
  { id: 'bus-out-4', top: '81%' },
];

const handleBaseStyle = {
  width: 14,
  height: 20,
  borderRadius: 8,
  pointerEvents: 'all' as const,
  zIndex: 100,
  opacity: 0.86,
  background: 'linear-gradient(180deg, rgba(83, 234, 226, 0.86), rgba(29, 114, 111, 0.9))',
  border: '1px solid rgba(209, 255, 251, 0.56)',
  boxShadow: '0 0 0 1px rgba(10, 17, 22, 0.72), 0 4px 10px rgba(55, 173, 170, 0.14)',
};

export default function MagenticBusNode() {
  return (
    <div
      style={{
        position: 'relative',
        width: 36,
        height: 420,
        borderRadius: 12,
        border: '1px solid rgba(148, 163, 184, 0.24)',
        background:
          'linear-gradient(180deg, rgba(17, 24, 32, 0.92), rgba(8, 12, 17, 0.96))',
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 -1px 0 rgba(255, 255, 255, 0.035), 0 12px 24px rgba(0, 0, 0, 0.22)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 18,
          bottom: 18,
          left: '50%',
          width: 1,
          transform: 'translateX(-50%)',
          background: 'linear-gradient(180deg, transparent, rgba(148, 163, 184, 0.28), transparent)',
          pointerEvents: 'none',
        }}
      />
      {leftHandles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="target"
          position={Position.Left}
          aria-label={handle.id}
          style={{
            ...handleBaseStyle,
            left: -7,
            top: handle.top,
          }}
        />
      ))}
      {rightHandles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={Position.Right}
          aria-label={handle.id}
          style={{
            ...handleBaseStyle,
            right: -7,
            top: handle.top,
          }}
        />
      ))}
    </div>
  );
}
