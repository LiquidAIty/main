import { useCallback, useRef, useState, type ReactNode } from 'react';

/**
 * The left panel: the Harness chat surface on top (the passed `chat`, i.e.
 * BuilderChat with inline work), and a near-invisible pull-tab at the bottom
 * that reveals the under-chat surface. That surface is the live native Hermes
 * child terminal — one surface, nothing else lives under the chat. The separate
 * Code Console remains the Local Coder terminal.
 *   - no UI name/label beyond what the Hermes feed renders itself
 *   - near-invisible until grabbed (a thin minimal handle)
 *   - Hermes child activity/prose only; Main's reply remains in chat
 */

const HANDLE_HEIGHT = 9;
const MIN_OPEN_HEIGHT = 120;
// A contained window below chat — it must never grow tall enough to take
// over. Capped to a modest fixed height (and never past ~42% of the panel).
const MAX_OPEN_HEIGHT = 240;

export type HarnessChatPanelProps = {
  chat: ReactNode;
  /** Main's native Hermes child stream — the ONE under-chat surface. */
  hermes: ReactNode;
};

export default function HarnessChatPanel({ chat, hermes }: HarnessChatPanelProps) {
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
      // Contained: a modest window, never tall enough to take over chat.
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

  // Reveal is by PULLING the handle up (drag) — chat stays primary, Hermes
  // is uncovered beneath it. A plain click only collapses an already-open
  // panel; it never jumps open / takes over the chat.
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
        data-testid="chat-hermes-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize Hermes panel"
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

      {/* Hermes lives below chat: a contained, centered "window" using the
          same dark look as agent replies, inset to match the chat sides.
          Hidden until the handle is pulled up. */}
      <div
        data-testid="chat-hermes-region"
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
            data-testid="chat-hermes-window"
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 14,
              overflow: 'hidden',
              background:
                'linear-gradient(180deg, rgba(28,30,34,0.55) 0%, rgba(22,24,28,0.72) 100%)',
              border: '1px solid rgba(255,255,255,0.06)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.18), 0 4px 18px rgba(0,0,0,0.14)',
            }}
          >
            {hermes}
          </div>
        ) : null}
      </div>
    </div>
  );
}
