import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const HANDLE_HEIGHT = 12;
const MIN_OPEN_HEIGHT = 160;
const MIN_CHAT_HEIGHT = 180;
const DEFAULT_OPEN_HEIGHT = 300;

type HarnessChatPanelProps = {
  chat: ReactNode;
  terminal: ReactNode;
};

/** Main Chat with the persistent OpenClaude Code terminal docked beneath it. */
export default function HarnessChatPanel({ chat, terminal }: HarnessChatPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef(false);
  const movedRef = useRef(false);
  const listenersRef = useRef<{
    move: (event: MouseEvent) => void;
    up: () => void;
  } | null>(null);
  const [height, setHeight] = useState(0);

  const clampHeight = useCallback((next: number) => {
    const total = containerRef.current?.getBoundingClientRect().height ?? 0;
    const maximum = Math.max(MIN_OPEN_HEIGHT, total - MIN_CHAT_HEIGHT - HANDLE_HEIGHT);
    if (next < MIN_OPEN_HEIGHT / 2) return 0;
    return Math.min(maximum, Math.max(MIN_OPEN_HEIGHT, next));
  }, []);

  const removeDragListeners = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener('mousemove', listeners.move);
    window.removeEventListener('mouseup', listeners.up);
    listenersRef.current = null;
    dragRef.current = false;
  }, []);

  useEffect(() => removeDragListeners, [removeDragListeners]);

  const onDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    removeDragListeners();
    dragRef.current = true;
    movedRef.current = false;
    const move = (nextEvent: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      movedRef.current = true;
      const rect = containerRef.current.getBoundingClientRect();
      setHeight(clampHeight(rect.bottom - nextEvent.clientY));
    };
    const up = () => removeDragListeners();
    listenersRef.current = { move, up };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [clampHeight, removeDragListeners]);

  const onHandleClick = useCallback(() => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    setHeight((current) => (current > 0 ? 0 : clampHeight(DEFAULT_OPEN_HEIGHT)));
  }, [clampHeight]);

  const open = height > 0;
  return (
    <div
      ref={containerRef}
      data-testid="harness-chat-panel"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <div data-testid="harness-chat" style={{ flex: 1, minHeight: MIN_CHAT_HEIGHT, overflow: 'hidden' }}>
        {chat}
      </div>

      <button
        type="button"
        data-testid="chat-openclaude-handle"
        aria-expanded={open}
        aria-controls="chat-openclaude-region"
        aria-label={open ? 'Collapse OpenClaude Code terminal' : 'Expand OpenClaude Code terminal'}
        title={open ? 'Slide down OpenClaude Code' : 'Slide up OpenClaude Code'}
        onMouseDown={onDragStart}
        onClick={onHandleClick}
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
        id="chat-openclaude-region"
        data-testid="chat-openclaude-region"
        aria-hidden={!open}
        style={{
          flex: '0 0 auto',
          height,
          minHeight: 0,
          overflow: 'hidden',
          visibility: open ? 'visible' : 'hidden',
        }}
      >
        {terminal}
      </div>
    </div>
  );
}
