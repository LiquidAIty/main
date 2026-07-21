import { Handle, Position } from '@xyflow/react';
import { SEMANTIC_HANDLE_IDS } from '../deckValidation';

const leftHandles = [
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberLeftPrefix}1`, top: 48 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberLeftPrefix}2`, top: 120 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberLeftPrefix}3`, top: 192 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberLeftPrefix}4`, top: 264 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberLeftPrefix}5`, top: 336 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberLeftPrefix}6`, top: 408 },
];

const rightHandles = [
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberRightPrefix}1`, top: 48 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberRightPrefix}2`, top: 120 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberRightPrefix}3`, top: 192 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberRightPrefix}4`, top: 264 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberRightPrefix}5`, top: 336 },
  { id: `${SEMANTIC_HANDLE_IDS.magOneMemberRightPrefix}6`, top: 408 },
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
      {/* Main Chat's approved magentic_control edge enters here. */}
      <Handle
        id={SEMANTIC_HANDLE_IDS.magOneControlInput}
        type="target"
        position={Position.Top}
        aria-label="Mag One control input — Main Chat submits an approved job"
        title="Control input: approved Main Chat job"
        isConnectable
        isConnectableStart={false}
        isConnectableEnd
        style={{
          ...handleBaseStyle,
          width: 16,
          height: 6,
          top: -3,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: 0.65,
          background: 'rgba(84, 221, 214, 0.8)',
          border: '1px solid rgba(191, 255, 250, 0.5)',
        }}
      />
      {leftHandles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={Position.Left}
          aria-label={handle.id}
          title="Mag One worker membership port"
          isConnectable
          isConnectableStart
          isConnectableEnd={false}
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
          title="Mag One worker membership port"
          isConnectable
          isConnectableStart
          isConnectableEnd={false}
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
