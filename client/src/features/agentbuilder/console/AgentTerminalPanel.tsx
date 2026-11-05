// Entity: Card Terminals
// Relationship: Attaches the existing xterm surface directly to Hermes's authenticated /api/pty endpoint for the selected saved profile.

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { hermesPtyUrl } from '../../hermes/hermesHost';

type AgentTerminalIdentity = {
  projectId: string;
  deckId: string;
  cardId: string;
  profile: string;
};

type AgentTerminalPanelProps = {
  identity: AgentTerminalIdentity;
};

const KEEPALIVE_MS = 20_000;

function attachToken(identity: AgentTerminalIdentity): string {
  const key = `hermes.pty.attach:${identity.projectId}:${identity.deckId}:${identity.cardId}:${identity.profile}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

function resumeControl(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return parsed?.type === 'resume' && typeof parsed.id === 'string';
  } catch {
    return false;
  }
}

export default function AgentTerminalPanel({ identity }: AgentTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'opening' | 'connected' | 'closed' | 'failed'>('opening');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let frame: number | null = null;
    const terminal = new Terminal({
      convertEol: false,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: false,
      scrollback: 5_000,
      theme: { background: '#0b0f14', foreground: '#d7e0ea' },
    });
    const fit = new FitAddon();
    const sendResize = () => {
      if (socket?.readyState === WebSocket.OPEN && terminal.cols >= 2 && terminal.rows >= 1) {
        socket.send(`\x1b[RESIZE:${terminal.cols};${terminal.rows}]`);
      }
    };
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      try {
        fit.fit();
        sendResize();
      } catch { /* A later layout notification retries. */ }
    };
    const scheduleResize = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        resize();
      });
    };
    terminal.loadAddon(fit);
    terminal.open(container);
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data);
    });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleResize);
    observer?.observe(container);
    window.addEventListener('resize', scheduleResize);
    scheduleResize();
    setStatus('opening');
    setError(null);
    const channel = `card:${identity.projectId}:${identity.deckId}:${identity.cardId}`;
    void hermesPtyUrl(identity.profile, {
      channel,
      attach: attachToken(identity),
    }).then((url) => {
      if (disposed) return;
      const ws = new WebSocket(url);
      socket = ws;
      ws.binaryType = 'arraybuffer';
      const decoder = new TextDecoder();
      ws.onopen = () => {
        if (disposed) return;
        setStatus('connected');
        sendResize();
        keepalive = setInterval(sendResize, KEEPALIVE_MS);
        terminal.focus();
      };
      ws.onmessage = (event) => {
        if (disposed) return;
        if (typeof event.data === 'string' && resumeControl(event.data)) return;
        const output = typeof event.data === 'string'
          ? event.data
          : decoder.decode(new Uint8Array(event.data as ArrayBuffer), { stream: true });
        if (output) terminal.write(output);
      };
      ws.onerror = () => {
        if (!disposed) setStatus('failed');
      };
      ws.onclose = (event) => {
        if (keepalive) clearInterval(keepalive);
        keepalive = null;
        if (disposed) return;
        const expected = event.code === 1000 || event.code === 4409 || event.code === 4410;
        setStatus(expected ? 'closed' : 'failed');
        if (!expected) setError(event.reason || `Hermes terminal closed (${event.code}).`);
      };
    }).catch((cause) => {
      if (disposed) return;
      setStatus('failed');
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      disposed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (keepalive) clearInterval(keepalive);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      input.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [identity.cardId, identity.deckId, identity.profile, identity.projectId]);

  return (
    <section
      data-testid="agent-terminal-panel"
      data-card-id={identity.cardId}
      data-profile={identity.profile}
      data-status={status}
      aria-label="Card terminal"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        overflow: 'hidden', background: '#0b0f14', color: '#d7e0ea',
      }}
    >
      {error ? <div role="alert" style={{ padding: '0 8px 6px', fontSize: 12 }}>{error}</div> : null}
      <div ref={containerRef} data-testid="agent-terminal-xterm" style={{ flex: 1, minHeight: 0, padding: '6px 8px' }} />
    </section>
  );
}
