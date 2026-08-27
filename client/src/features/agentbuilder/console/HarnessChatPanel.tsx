import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const HANDLE_HEIGHT = 12;
const MIN_OPEN_HEIGHT = 160;
const DEFAULT_PEEK_HEIGHT = 240;
const COLLAPSE_THRESHOLD = 72;

type HarnessChatPanelProps = {
  chat: ReactNode;
  terminal: ReactNode;
  focusTerminalRequest?: number;
};

/** Main Chat with the saved Coder Card's persistent Hermes terminal beneath it. */
export default function HarnessChatPanel({ chat, terminal, focusTerminalRequest = 0 }: HarnessChatPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef(false);
  const listenersRef = useRef<{
    move: (event: MouseEvent) => void;
    up: () => void;
  } | null>(null);
  const heightRef = useRef(0);
  const lastOpenHeightRef = useRef(DEFAULT_PEEK_HEIGHT);
  const dragMovedRef = useRef(false);
  const [height, setHeightState] = useState(0);
  const [dragging, setDragging] = useState(false);

  const setHeight = useCallback((next: number) => {
    heightRef.current = next;
    setHeightState(next);
  }, []);

  const clampHeight = useCallback((next: number) => {
    const total = containerRef.current?.getBoundingClientRect().height ?? 0;
    const maximum = Math.max(MIN_OPEN_HEIGHT, total - HANDLE_HEIGHT);
    return Math.min(maximum, Math.max(0, next));
  }, []);

  const removeDragListeners = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener('mousemove', listeners.move, true);
    window.removeEventListener('mouseup', listeners.up, true);
    listenersRef.current = null;
    dragRef.current = false;
  }, []);

  useEffect(() => {
    if (!focusTerminalRequest) return;
    setHeight(clampHeight(lastOpenHeightRef.current));
    const frame = window.requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLElement>('[data-testid="coder-console-panel"]')?.focus();
      window.dispatchEvent(new Event('liquidaity:terminal-layout-settled'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusTerminalRequest, clampHeight, setHeight]);

  useEffect(() => removeDragListeners, [removeDragListeners]);

  const onDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    removeDragListeners();
    dragRef.current = true;
    dragMovedRef.current = false;
    setDragging(true);
    const move = (nextEvent: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      nextEvent.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const nextHeight = clampHeight(rect.bottom - nextEvent.clientY);
      dragMovedRef.current = true;
      setHeight(nextHeight);
    };
    const up = () => {
      const total = containerRef.current?.getBoundingClientRect().height ?? 0;
      const maximum = Math.max(MIN_OPEN_HEIGHT, total - HANDLE_HEIGHT);
      const settledHeight = heightRef.current < COLLAPSE_THRESHOLD
        ? 0
        : Math.min(maximum, Math.max(MIN_OPEN_HEIGHT, heightRef.current));
      if (settledHeight > 0) lastOpenHeightRef.current = settledHeight;
      setHeight(settledHeight);
      removeDragListeners();
      setDragging(false);
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('liquidaity:terminal-layout-settled'));
      });
    };
    listenersRef.current = { move, up };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  }, [clampHeight, removeDragListeners, setHeight]);

  const toggleTerminal = useCallback(() => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    if (heightRef.current > 0) {
      lastOpenHeightRef.current = heightRef.current;
      setHeight(0);
    } else {
      setHeight(clampHeight(lastOpenHeightRef.current));
    }
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('liquidaity:terminal-layout-settled'));
    });
  }, [clampHeight, setHeight]);

  const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 0;
  const terminalMode = height === 0
    ? 'collapsed'
    : containerHeight > 0 && height >= Math.max(MIN_OPEN_HEIGHT, containerHeight - HANDLE_HEIGHT) - 1
      ? 'expanded'
      : 'peek';

  return (
    <div
      ref={containerRef}
      data-testid="harness-chat-panel"
      data-main-mode={terminalMode === 'expanded' ? 'chatgpt' : 'native'}
      data-terminal-mode={terminalMode}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      {terminalMode !== 'expanded' ? (
        <div data-testid="harness-chat" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {chat}
        </div>
      ) : null}

      <button
        type="button"
        data-testid="chat-coder-terminal-handle"
        aria-expanded={height > 0}
        aria-controls="chat-coder-terminal-region"
        aria-label="Resize Chat and Coder terminal"
        title="Resize Chat and Coder terminal"
        onMouseDown={onDragStart}
        onClick={toggleTerminal}
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
        aria-hidden={height === 0}
        style={{
          flex: '0 0 auto',
          height,
          minHeight: 0,
          overflow: 'hidden',
          visibility: height === 0 ? 'hidden' : 'visible',
          userSelect: dragging ? 'none' : 'auto',
        }}
      >
        {terminal}
      </div>
    </div>
  );
}
