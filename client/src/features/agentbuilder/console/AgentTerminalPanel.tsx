import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import {
  agentTerminalClient,
  type AgentTerminalClient,
  type AgentTerminalIdentity,
  type AgentTerminalSession,
} from './agentTerminalClient';

type AgentTerminalPanelProps = {
  identity: AgentTerminalIdentity;
  client?: AgentTerminalClient;
};

const DEFAULT_SIZE = { cols: 80, rows: 24 };

type PendingOpen = {
  key: string;
  promise: Promise<AgentTerminalSession>;
};

function isRunning(session: AgentTerminalSession | null): session is AgentTerminalSession {
  return session?.status === 'running';
}

function isAttached(session: AgentTerminalSession | null): session is AgentTerminalSession {
  return isRunning(session) && Boolean(session.ptyId);
}

export default function AgentTerminalPanel({
  identity,
  client = agentTerminalClient,
}: AgentTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sizeRef = useRef(DEFAULT_SIZE);
  const sessionRef = useRef<AgentTerminalSession | null>(null);
  const lastResizeRef = useRef('');
  const pendingOpenRef = useRef<PendingOpen | null>(null);
  const identityKeyRef = useRef('');
  const [terminalReady, setTerminalReady] = useState(false);
  const [session, setSession] = useState<AgentTerminalSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stableIdentity = useMemo<AgentTerminalIdentity>(() => ({
    projectId: identity.projectId,
    deckId: identity.deckId,
    cardId: identity.cardId,
  }), [identity.cardId, identity.deckId, identity.projectId]);
  const identityKey = `${stableIdentity.projectId}:${stableIdentity.deckId}:${stableIdentity.cardId}`;

  sessionRef.current = session;
  identityKeyRef.current = identityKey;

  useEffect(() => {
    setSession(null);
    setError(null);
    lastResizeRef.current = '';
  }, [identityKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      convertEol: false,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: false,
      scrollback: 5_000,
      theme: { background: '#0b0f14', foreground: '#d7e0ea' },
    });
    const fit = new FitAddon();
    let frame: number | null = null;
    const resize = () => {
      if (!terminalRef.current) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      try {
        fit.fit();
        if (terminal.cols >= 2 && terminal.rows >= 1) {
          sizeRef.current = { cols: terminal.cols, rows: terminal.rows };
          const active = sessionRef.current;
          const sizeKey = `${terminal.cols}x${terminal.rows}`;
          if (isAttached(active) && lastResizeRef.current !== sizeKey) {
            lastResizeRef.current = sizeKey;
            const resizeIdentityKey = identityKey;
            const resizeSessionId = active.sessionId;
            void client.resize(stableIdentity, active.sessionId, terminal.cols, terminal.rows).catch((cause) => {
              if (lastResizeRef.current === sizeKey) lastResizeRef.current = '';
              if (
                identityKeyRef.current === resizeIdentityKey
                && sessionRef.current?.sessionId === resizeSessionId
              ) setError(cause instanceof Error ? cause.message : String(cause));
            });
          }
        }
      } catch {
        // A later layout notification retries once this panel is measurable.
      }
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
    terminalRef.current = terminal;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleResize);
    observer?.observe(container);
    window.addEventListener('resize', scheduleResize);
    scheduleResize();
    terminal.focus();
    setTerminalReady(true);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      terminal.dispose();
      terminalRef.current = null;
      setTerminalReady(false);
    };
  }, [client, identityKey, stableIdentity]);

  useEffect(() => {
    const needsOpen = !session || (isRunning(session) && !session.ptyId);
    if (!terminalReady || !needsOpen || error) return;
    const key = `${identityKey}:${session?.sessionId || 'new'}:native-tui`;
    let pending = pendingOpenRef.current;
    if (!pending || pending.key !== key) {
      pending = { key, promise: client.open(stableIdentity, sizeRef.current) };
      pendingOpenRef.current = pending;
    }
    let active = true;
    void pending.promise.then((opened) => {
      if (!active || pendingOpenRef.current !== pending || identityKeyRef.current !== identityKey) return;
      pendingOpenRef.current = null;
      lastResizeRef.current = '';
      setSession(opened);
      setError(opened.error || null);
    }).catch((cause) => {
      if (!active || pendingOpenRef.current !== pending || identityKeyRef.current !== identityKey) return;
      pendingOpenRef.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [client, error, identityKey, session, stableIdentity, terminalReady]);

  useEffect(() => {
    if (!session) return;
    let lastSequence = 0;
    const streamIdentityKey = identityKey;
    const stream = client.stream(
      stableIdentity,
      session.sessionId,
      lastSequence,
      {
      onOutput: ({ sequence, data }) => {
        if (identityKeyRef.current !== streamIdentityKey || sequence <= lastSequence) return;
        lastSequence = sequence;
        terminalRef.current?.write(data);
      },
      onState: (next) => {
        if (identityKeyRef.current !== streamIdentityKey) return;
        setSession((current) => current?.sessionId === session.sessionId
          ? { ...current, ...next }
          : current);
        if (typeof next.error === 'string' && next.error) setError(next.error);
      },
      onTransportError: () => undefined,
      },
    );
    return () => stream.close();
  }, [client, identityKey, session?.sessionId, stableIdentity]);

  const runtimeStatus = session?.status || (error ? 'failed' : 'opening');
  return (
    <section
      data-testid="agent-terminal-panel"
      data-session-id={session?.sessionId || ''}
      data-card-id={session?.cardId || identity.cardId}
      data-profile={session?.profile || ''}
      data-pid={session?.pid ?? ''}
      data-pty-id={session?.ptyId || ''}
      data-status={runtimeStatus}
      aria-label="Agent CLI"
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
