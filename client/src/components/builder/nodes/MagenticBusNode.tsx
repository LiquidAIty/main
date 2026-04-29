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
  width: 18,
  height: 24,
  borderRadius: 8,
  pointerEvents: 'all' as const,
  zIndex: 100,
  opacity: 1,
  background: 'linear-gradient(180deg, rgba(83, 234, 226, 0.95), rgba(29, 114, 111, 0.98))',
  border: '1px solid rgba(209, 255, 251, 0.8)',
  boxShadow: '0 0 0 1px rgba(10, 17, 22, 0.9), 0 8px 16px rgba(55, 173, 170, 0.24)',
};

export default function MagenticBusNode() {
  return (
    <div
      style={{
        position: 'relative',
        width: 44,
        height: 480,
        borderRadius: 14,
        border: '1px solid rgba(148, 163, 184, 0.28)',
        background:
          'linear-gradient(180deg, rgba(17, 24, 32, 0.92), rgba(8, 12, 17, 0.96))',
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(255, 255, 255, 0.04), 0 18px 36px rgba(0, 0, 0, 0.28)',
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
            left: -10,
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
            right: -10,
            top: handle.top,
          }}
        />
      ))}
    </div>
  );
}
