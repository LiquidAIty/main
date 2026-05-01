import { Handle, Position } from '@xyflow/react';

const leftHandles = [
  { id: 'bus-in-1', top: 48 },
  { id: 'bus-in-2', top: 120 },
  { id: 'bus-in-3', top: 192 },
  { id: 'bus-in-4', top: 264 },
  { id: 'bus-in-5', top: 336 },
  { id: 'bus-in-6', top: 408 },
];

const rightHandles = [
  { id: 'bus-out-1', top: 48 },
  { id: 'bus-out-2', top: 120 },
  { id: 'bus-out-3', top: 192 },
  { id: 'bus-out-4', top: 264 },
  { id: 'bus-out-5', top: 336 },
  { id: 'bus-out-6', top: 408 },
];

const handleBaseStyle = {
  width: 6,
  height: 16,
  borderRadius: 4,
  pointerEvents: 'all' as const,
  zIndex: 100,
};

const leftHandleStyle = {
  ...handleBaseStyle,
  opacity: 0.35,
  background: 'rgba(156, 145, 111, 0.6)',
  border: '1px solid rgba(214, 204, 162, 0.4)',
};

const rightHandleStyle = {
  ...handleBaseStyle,
  opacity: 0.65,
  background: 'rgba(84, 221, 214, 0.8)',
  border: '1px solid rgba(191, 255, 250, 0.5)',
};

export default function MagenticBusNode() {
  return (
    <div
      style={{
        position: 'relative',
        width: 26,
        height: 456,
        borderRadius: 8,
        border: '1px solid rgba(84, 221, 214, 0.15)',
        background: 'rgba(5, 7, 10, 0.85)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 8,
          bottom: 8,
          left: '50%',
          width: 1,
          transform: 'translateX(-50%)',
          background: 'rgba(84, 221, 214, 0.1)',
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
            ...leftHandleStyle,
            left: -3,
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
            ...rightHandleStyle,
            right: -3,
            top: handle.top,
          }}
        />
      ))}
    </div>
  );
}
