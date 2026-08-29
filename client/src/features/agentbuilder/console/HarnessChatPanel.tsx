import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const HANDLE_HEIGHT = 12;
const MIN_OPEN_HEIGHT = 160;
const DEFAULT_PEEK_HEIGHT = 240;

export type MainDriverSource = 'internal_chat' | 'external_plugin' | 'native_cli';

type HarnessChatPanelProps = {
  chat: ReactNode;
  terminal: ReactNode;
  activeDriver?: Exclude<MainDriverSource, 'native_cli'> | null;
  storageKey?: string;
};

/** Two presentation drivers over one always-mounted Main CLI surface. */
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
      return Number.isFinite(saved) && saved >= MIN_OPEN_HEIGHT ? saved : DEFAULT_PEEK_HEIGHT;
    } catch {
      return DEFAULT_PEEK_HEIGHT;
    }
  })();
  const heightRef = useRef(initialSplitHeight);
  const lastOpenHeightRef = useRef(initialSplitHeight);
  const dragMovedRef = useRef(false);
  const [height, setHeightState] = useState(initialSplitHeight);
  const [manualFullCli, setManualFullCli] = useState(false);
  const [dragging, setDragging] = useState(false);

  const setHeight = useCallback((next: number) => {
    heightRef.current = next;
    setHeightState(next);
  }, []);

  const clampHeight = useCallback((next: number) => {
    const total = containerRef.current?.getBoundingClientRect().height ?? 0;
    const maximum = Math.max(MIN_OPEN_HEIGHT, total - HANDLE_HEIGHT);
    return Math.min(maximum, Math.max(MIN_OPEN_HEIGHT, next));
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
    listenersRef.current = null;
    dragRef.current = false;
  }, []);

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
      const fullCli = heightRef.current >= maximum - 1;
      const settledHeight = fullCli
        ? maximum
        : Math.min(maximum, Math.max(MIN_OPEN_HEIGHT, heightRef.current));
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
      setHeight(Math.max(MIN_OPEN_HEIGHT, total - HANDLE_HEIGHT));
    }
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('liquidaity:terminal-layout-settled'));
    });
  }, [clampHeight, manualFullCli, setHeight]);

  const forcedFullCli = activeDriver === 'external_plugin';
  const fullCli = forcedFullCli || manualFullCli;
  const driverSource: MainDriverSource = activeDriver || (manualFullCli ? 'native_cli' : 'internal_chat');
  const terminalMode = fullCli ? 'expanded' : 'split';

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

      {forcedFullCli ? (
        <div data-testid="main-driver-indicator" role="status" style={{ padding: '4px 8px' }}>
          External Chat driving Main
        </div>
      ) : null}

      <button
        type="button"
        data-testid="main-chat-cli-divider"
        aria-expanded={fullCli}
        aria-controls="main-cli-region"
        aria-label="Resize Main Chat and Main CLI"
        title="Resize Main Chat and Main CLI"
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
        id="main-cli-region"
        data-testid="main-cli-region"
        aria-hidden="false"
        style={{
          flex: fullCli ? '1 1 auto' : '0 0 auto',
          height: fullCli ? 'auto' : height,
          minHeight: 0,
          overflow: 'hidden',
          userSelect: dragging ? 'none' : 'auto',
        }}
      >
        {terminal}
      </div>
    </div>
  );
}
