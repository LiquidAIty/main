import type { MouseEvent } from 'react';

type AgentBuilderSplitterProps = {
  active: boolean;
  dragging: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

export default function AgentBuilderSplitter({
  active,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
}: AgentBuilderSplitterProps) {
  return (
    <div
      data-testid="workspace-chat-resize-handle"
      aria-label="Resize chat panel"
      title="Drag to resize chat"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      style={{
        width: 10,
        height: '100%',
        cursor: 'col-resize',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        borderLeft: `1px solid ${active ? 'rgba(79,162,173,0.34)' : 'rgba(79,162,173,0.18)'}`,
        borderRight: `1px solid ${active ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(79,162,173,0.16), 0 0 10px rgba(79,162,173,0.12)'
          : 'none',
        background:
          'linear-gradient(90deg, rgba(79,162,173,0.05), rgba(255,255,255,0.09), rgba(79,162,173,0.05))',
        transition:
          'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
      }}
    />
  );
}
