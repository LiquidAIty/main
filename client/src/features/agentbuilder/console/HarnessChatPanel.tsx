import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const HANDLE_HEIGHT = 12;
const MIN_OPEN_HEIGHT = 160;
const MIN_CHAT_HEIGHT = 160;
const DEFAULT_OPEN_HEIGHT = 300;

type HarnessChatPanelProps = {
  chat: ReactNode;
  terminal: ReactNode;
};

/** Main Chat with the saved Coder Card's persistent Hermes terminal beneath it. */
export default function HarnessChatPanel({ chat, terminal }: HarnessChatPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef(false);
  const listenersRef = useRef<{
    move: (event: MouseEvent) => void;
    up: () => void;
  } | null>(null);
  const [height, setHeight] = useState(DEFAULT_OPEN_HEIGHT);
  const [dragging, setDragging] = useState(false);

  const clampHeight = useCallback((next: number) => {
    const total = containerRef.current?.getBoundingClientRect().height ?? 0;
    const maximum = Math.max(MIN_OPEN_HEIGHT, total - HANDLE_HEIGHT - MIN_CHAT_HEIGHT);
    return Math.min(maximum, Math.max(MIN_OPEN_HEIGHT, next));
  }, []);

  const removeDragListeners = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener('mousemove', listeners.move, true);
    window.removeEventListener('mouseup', listeners.up, true);
    listenersRef.current = null;
    dragRef.current = false;
  }, []);

  useEffect(() => removeDragListeners, [removeDragListeners]);

  const onDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    removeDragListeners();
    dragRef.current = true;
    setDragging(true);
    const move = (nextEvent: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      nextEvent.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const nextHeight = clampHeight(rect.bottom - nextEvent.clientY);
      setHeight(nextHeight);
    };
    const up = () => {
      removeDragListeners();
      setDragging(false);
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('liquidaity:terminal-layout-settled'));
      });
    };
    listenersRef.current = { move, up };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  }, [clampHeight, removeDragListeners]);

  return (
    <div
      ref={containerRef}
      data-testid="harness-chat-panel"
      data-main-mode="native"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <div data-testid="harness-chat" style={{ flex: 1, minHeight: MIN_CHAT_HEIGHT, overflow: 'hidden' }}>
        {chat}
      </div>

      <button
        type="button"
        data-testid="chat-coder-terminal-handle"
        aria-expanded="true"
        aria-controls="chat-coder-terminal-region"
        aria-label="Resize Chat and Coder terminal"
        title="Resize Chat and Coder terminal"
        onMouseDown={onDragStart}
        style={{
          flex: '0 0 auto',
          height: HANDLE_HEIGHT,
          cursor: 'row-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 0,
          borderTop: '1px solid rgba(79,162,173,0.18)',
          background: 'rgba(11,15,20,0.78)',
          color: 'rgba(215,224,234,0.72)',
          padding: 0,
        }}
      >
        <span aria-hidden="true" style={{ width: 34, height: 3, borderRadius: 2, background: 'currentColor' }} />
      </button>

      <div
        id="chat-coder-terminal-region"
        data-testid="chat-coder-terminal-region"
        aria-hidden="false"
        style={{
          flex: '0 0 auto',
          height,
          minHeight: 0,
          overflow: 'hidden',
          visibility: 'visible',
          userSelect: dragging ? 'none' : 'auto',
        }}
      >
        {terminal}
      </div>
    </div>
  );
}
