import { useCallback, useRef, useState, type ReactNode } from 'react';
import ChatTerminalView from './ChatTerminalView';

/**
 * The left panel: the Harness chat surface on top (the passed `chat`, i.e.
 * BuilderChat with inline work), and a near-invisible pull-tab at the bottom that
 * reveals the real PTY terminal ("chat terminal" in the backend). The terminal:
 *   - has no UI name/label (no "shell"/"session"/"console" text)
 *   - is near-invisible until grabbed (a thin minimal handle)
 *   - renders transparent so its text sits on the panel background
 *   - is NOT where Harness replies/work appear (those are in chat)
 * The terminal PTY starts only on first open and stays mounted thereafter.
 */

const HANDLE_HEIGHT = 9;
const MIN_OPEN_HEIGHT = 120;
// The terminal is a contained window below chat — it must never grow tall enough
// to take over. Capped to a modest fixed height (and never past ~42% of the panel).
const MAX_OPEN_HEIGHT = 240;

export type HarnessChatPanelProps = {
  chat: ReactNode;
  targetRoot: string;
  projectId: string;
};

export default function HarnessChatPanel({ chat, targetRoot, projectId }: HarnessChatPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [opened, setOpened] = useState(false);
  const [height, setHeight] = useState(0);
  const dragRef = useRef(false);
  const movedRef = useRef(false);

  const onDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    dragRef.current = true;
    movedRef.current = false;
    const onMove = (move: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      movedRef.current = true;
      setOpened(true);
      const rect = containerRef.current.getBoundingClientRect();
      const next = rect.bottom - move.clientY;
      // Contained: a modest terminal window, never tall enough to take over chat.
      const max = Math.min(MAX_OPEN_HEIGHT, Math.max(MIN_OPEN_HEIGHT, Math.round(rect.height * 0.42)));
      setHeight(next < MIN_OPEN_HEIGHT / 2 ? 0 : Math.min(max, Math.max(MIN_OPEN_HEIGHT, next)));
    };
    const onUp = () => {
      dragRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Reveal is by PULLING the handle up (drag) — chat stays primary, the terminal
  // is uncovered beneath it. A plain click only collapses an already-open
  // terminal; it never jumps open / takes over the chat.
  const onHandleClick = useCallback(() => {
    if (movedRef.current) return;
    setHeight((h) => (h > 0 ? 0 : h));
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="harness-chat-panel"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <div data-testid="harness-chat" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {chat}
      </div>

      {/* Near-invisible pull tab — a thin minimal grab handle, no label. */}
      <div
        data-testid="chat-terminal-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        title=""
        onMouseDown={onDragStart}
        onClick={onHandleClick}
        style={{
          flex: '0 0 auto',
          height: HANDLE_HEIGHT,
          cursor: 'row-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: height > 0 ? 0.5 : 0.18,
          transition: 'opacity 120ms ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.opacity = '0.6';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.opacity = height > 0 ? '0.5' : '0.18';
        }}
      >
        <div style={{ width: 28, height: 3, borderRadius: 2, background: 'currentColor' }} />
      </div>

      {/* Terminal lives below chat: a contained, centered "window" using the same
          dark look as agent replies, inset to match the chat sides. Hidden until
          the handle is pulled up. */}
      <div
        data-testid="chat-terminal-region"
        style={{
          flex: '0 0 auto',
          height: opened ? height : 0,
          overflow: 'hidden',
          padding: opened && height > 0 ? '0 16px 12px' : 0,
          boxSizing: 'border-box',
        }}
      >
        {opened ? (
          <div
            data-testid="chat-terminal-window"
            style={{
              height: '100%',
              borderRadius: 14,
              overflow: 'hidden',
              background:
                'linear-gradient(180deg, rgba(28,30,34,0.55) 0%, rgba(22,24,28,0.72) 100%)',
              border: '1px solid rgba(255,255,255,0.06)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.18), 0 4px 18px rgba(0,0,0,0.14)',
            }}
          >
            <ChatTerminalView targetRoot={targetRoot} projectId={projectId} transparent minimal />
          </div>
        ) : null}
      </div>
    </div>
  );
}
