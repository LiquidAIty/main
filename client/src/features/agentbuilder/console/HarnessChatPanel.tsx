import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const HANDLE_HEIGHT = 12;

export type MainDriverSource = 'internal_chat' | 'external_plugin' | 'native_cli';

type HarnessChatPanelProps = {
  chat: ReactNode;
  terminal: ReactNode | ((state: { directInput: boolean }) => ReactNode);
  activeDriver?: Exclude<MainDriverSource, 'native_cli'> | null;
  storageKey?: string;
};

/** One Main conversation over one always-mounted Agent Builder work surface. */
export default function HarnessChatPanel({
  chat,
  terminal,
  activeDriver = null,
  storageKey = 'liquidaity.main.surface.split.v1',
}: HarnessChatPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef(false);
  const listenersRef = useRef<{
    move: (event: MouseEvent) => void;
    up: () => void;
  } | null>(null);
  const initialSplitHeight = (() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= 0 ? saved : 0;
    } catch {
      return 0;
    }
  })();
  const heightRef = useRef(0);
  const lastOpenHeightRef = useRef(initialSplitHeight);
  const dragMovedRef = useRef(false);
  const [height, setHeightState] = useState(0);
  const [manualFullCli, setManualFullCli] = useState(false);
  const [dragging, setDragging] = useState(false);

  const setHeight = useCallback((next: number) => {
    heightRef.current = next;
    setHeightState(next);
  }, []);

  const clampHeight = useCallback((next: number) => {
    const total = containerRef.current?.getBoundingClientRect().height ?? 0;
    const maximum = Math.max(0, total - HANDLE_HEIGHT);
    return next <= HANDLE_HEIGHT ? 0 : Math.min(maximum, Math.max(0, next));
  }, []);

  const rememberSplitHeight = useCallback((next: number) => {
    lastOpenHeightRef.current = next;
    try {
      window.localStorage.setItem(storageKey, String(Math.round(next)));
    } catch {
      // Presentation persistence is best-effort; layout remains usable in memory.
    }
  }, [storageKey]);

  const removeDragListeners = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener('mousemove', listeners.move, true);
    window.removeEventListener('mouseup', listeners.up, true);
    window.removeEventListener('blur', listeners.up);
    listenersRef.current = null;
    dragRef.current = false;
  }, []);

  useEffect(() => removeDragListeners, [removeDragListeners]);

  const onDragStart = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    removeDragListeners();
    dragRef.current = true;
    dragMovedRef.current = false;
    setDragging(true);
    const move = (nextEvent: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      if ((nextEvent.buttons & 1) === 0) {
        up();
        return;
      }
      nextEvent.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const nextHeight = clampHeight(rect.bottom - nextEvent.clientY);
      dragMovedRef.current = true;
      setHeight(nextHeight);
    };
    const up = () => {
      const total = containerRef.current?.getBoundingClientRect().height ?? 0;
      const maximum = Math.max(0, total - HANDLE_HEIGHT);
      const fullCli = heightRef.current >= maximum - 1;
      const settledHeight = fullCli
        ? maximum
        : clampHeight(heightRef.current);
      setManualFullCli(fullCli);
      if (!fullCli) rememberSplitHeight(settledHeight);
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
    window.addEventListener('blur', up);
  }, [clampHeight, rememberSplitHeight, removeDragListeners, setHeight]);

  const toggleTerminal = useCallback(() => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    if (manualFullCli) {
      setManualFullCli(false);
      setHeight(clampHeight(lastOpenHeightRef.current));
    } else {
      const total = containerRef.current?.getBoundingClientRect().height ?? 0;
      setManualFullCli(true);
      setHeight(Math.max(0, total - HANDLE_HEIGHT));
    }
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('liquidaity:terminal-layout-settled'));
    });
  }, [clampHeight, manualFullCli, setHeight]);

  const fullCli = manualFullCli;
  const driverSource: MainDriverSource = activeDriver || 'internal_chat';
  const terminalMode = fullCli ? 'expanded' : height === 0 ? 'collapsed' : 'split';

  return (
    <div
      ref={containerRef}
      data-testid="main-work-surface"
      data-main-driver={driverSource}
      data-terminal-mode={terminalMode}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      {!fullCli ? (
        <div data-testid="main-chat-region" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {chat}
        </div>
      ) : null}

      {activeDriver === 'external_plugin' ? (
        <div data-testid="main-driver-indicator" role="status" style={{ padding: '4px 8px' }}>
          External Chat driving Main
        </div>
      ) : null}

      <button
        type="button"
        data-testid="main-chat-agent-builder-divider"
        aria-expanded={fullCli || height > 0}
        aria-controls="agent-builder-region"
        aria-label="Resize Main Chat and Agent Builder"
        title="Resize Main Chat and Agent Builder"
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
        id="agent-builder-region"
        data-testid="agent-builder-region"
        aria-hidden={!fullCli && height === 0}
        style={{
          flex: fullCli ? '1 1 auto' : '0 0 auto',
          height: fullCli ? 'auto' : height,
          minHeight: 0,
          overflow: 'hidden',
          userSelect: dragging ? 'none' : 'auto',
        }}
      >
        {typeof terminal === 'function' ? terminal({ directInput: fullCli }) : terminal}
      </div>
    </div>
  );
}
