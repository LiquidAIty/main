import { useCallback, useEffect, useRef, useState } from 'react';
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

export default function AgentTerminalPanel({
  identity,
  client = agentTerminalClient,
}: AgentTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sizeRef = useRef(DEFAULT_SIZE);
  const sessionRef = useRef<AgentTerminalSession | null>(null);
  const lastResizeRef = useRef('');
  const inputQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingOpenRef = useRef<PendingOpen | null>(null);
  const identityKeyRef = useRef('');
  const [terminalReady, setTerminalReady] = useState(false);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [session, setSession] = useState<AgentTerminalSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transportInterrupted, setTransportInterrupted] = useState(false);
  const [stopping, setStopping] = useState(false);
  const identityKey = `${identity.projectId}:${identity.deckId}:${identity.cardId}`;

  sessionRef.current = session;
  identityKeyRef.current = identityKey;

  useEffect(() => {
    setSession(null);
    setError(null);
    setTransportInterrupted(false);
    setStopping(false);
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
      disableStdin: true,
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
          if (isRunning(active) && lastResizeRef.current !== sizeKey) {
            lastResizeRef.current = sizeKey;
            const resizeIdentityKey = identityKey;
            const resizeSessionId = active.sessionId;
            void client.resize(identity, active.sessionId, terminal.cols, terminal.rows).catch((cause) => {
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
    const input = terminal.onData((data) => {
      const active = sessionRef.current;
      if (!isRunning(active)) return;
      const inputIdentityKey = identityKey;
      const inputSessionId = active.sessionId;
      inputQueueRef.current = inputQueueRef.current
        .then(() => client.input(identity, active.sessionId, data))
        .catch((cause) => {
          if (
            identityKeyRef.current === inputIdentityKey
            && sessionRef.current?.sessionId === inputSessionId
          ) setError(cause instanceof Error ? cause.message : String(cause));
        });
    });
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
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      setTerminalReady(false);
    };
  }, [client, identityKey]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const interactive = isRunning(session);
    terminal.options.disableStdin = !interactive;
    terminal.options.cursorBlink = interactive;
    if (interactive) terminal.focus();
  }, [session?.status]);

  useEffect(() => {
    if (!terminalReady || session || error || stopping) return;
    const key = `${identityKey}:${openAttempt}`;
    let pending = pendingOpenRef.current;
    if (!pending || pending.key !== key) {
      pending = { key, promise: client.open(identity, sizeRef.current) };
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
  }, [client, error, identityKey, openAttempt, session, stopping, terminalReady]);

  useEffect(() => {
    if (!session) return;
    let lastSequence = 0;
    const streamIdentityKey = identityKey;
    const stream = client.stream(identity, session.sessionId, lastSequence, {
      onOutput: ({ sequence, data }) => {
        if (identityKeyRef.current !== streamIdentityKey) return;
        if (sequence <= lastSequence) return;
        lastSequence = sequence;
        terminalRef.current?.write(data);
        setTransportInterrupted(false);
      },
      onState: (next) => {
        if (identityKeyRef.current !== streamIdentityKey) return;
        setSession((current) => current?.sessionId === session.sessionId
          ? { ...current, ...next }
          : current);
        setStopping(false);
        setTransportInterrupted(false);
        if (typeof next.error === 'string' && next.error) setError(next.error);
      },
      onTransportError: () => {
        if (identityKeyRef.current !== streamIdentityKey) return;
        setTransportInterrupted(true);
      },
    });
    return () => stream.close();
  }, [client, identityKey, session?.sessionId]);

  const start = useCallback(() => {
    pendingOpenRef.current = null;
    setError(null);
    setTransportInterrupted(false);
    setStopping(false);
    setSession(null);
    setOpenAttempt((value) => value + 1);
  }, []);

  const stop = useCallback(async () => {
    const active = sessionRef.current;
    if (!isRunning(active)) return;
    const stopIdentityKey = identityKey;
    const stopSessionId = active.sessionId;
    setStopping(true);
    setError(null);
    try {
      const next = await client.stop(identity, active.sessionId);
      if (identityKeyRef.current !== stopIdentityKey || sessionRef.current?.sessionId !== stopSessionId) return;
      setSession((current) => current?.sessionId === active.sessionId
        ? { ...current, ...next }
        : current);
    } catch (cause) {
      if (identityKeyRef.current !== stopIdentityKey || sessionRef.current?.sessionId !== stopSessionId) return;
      setStopping(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, identityKey]);

  const status = session?.status || (error ? 'failed' : 'opening');
  return (
    <section
      data-testid="agent-terminal-panel"
      data-session-id={session?.sessionId || ''}
      data-card-id={session?.cardId || identity.cardId}
      data-profile={session?.profile || ''}
      data-pid={session?.pid ?? ''}
      data-pty-id={session?.ptyId || ''}
      data-status={status}
      aria-label="Agent CLI"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 360, background: '#0b0f14', color: '#d7e0ea' }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', fontSize: 12 }}>
        <span role="status">{status}</span>
        {transportInterrupted ? <span role="status">Reconnecting…</span> : null}
        {isRunning(session) ? <button type="button" data-testid="agent-terminal-stop" onClick={() => { void stop(); }} disabled={stopping}>
          {stopping ? 'Stopping…' : 'Stop'}
        </button> : null}
        {(session && !isRunning(session)) || error ? <button type="button" data-testid="agent-terminal-start" onClick={start}>Start</button> : null}
      </div>
      {error ? <div role="alert" style={{ padding: '0 8px 6px', fontSize: 12 }}>{error}</div> : null}
      <div ref={containerRef} data-testid="agent-terminal-xterm" style={{ flex: 1, minHeight: 0, padding: '6px 8px' }} />
    </section>
  );
}
