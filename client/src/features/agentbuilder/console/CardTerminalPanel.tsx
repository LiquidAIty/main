import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import {
  cardTerminalClient,
  type CardTerminalAttachment,
  type CardTerminalClient,
  type CardTerminalConnectionState,
  type CardTerminalIdentity,
} from './cardTerminalClient';

type CardTerminalPanelProps = {
  identity: CardTerminalIdentity;
  client?: CardTerminalClient;
};

const DEFAULT_SIZE = { cols: 80, rows: 24 };

type PendingOpen = {
  key: string;
  promise: Promise<CardTerminalAttachment>;
};

export default function CardTerminalPanel({
  identity,
  client = cardTerminalClient,
}: CardTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sizeRef = useRef(DEFAULT_SIZE);
  const streamRef = useRef<ReturnType<CardTerminalClient['stream']> | null>(null);
  const connectionStateRef = useRef<CardTerminalConnectionState>('opening');
  const lastResizeRef = useRef('');
  const pendingOpenRef = useRef<PendingOpen | null>(null);
  const identityKeyRef = useRef('');
  const [terminalReady, setTerminalReady] = useState(false);
  const [attachment, setAttachment] = useState<CardTerminalAttachment | null>(null);
  const [connectionState, setConnectionState] = useState<CardTerminalConnectionState>('opening');
  const [error, setError] = useState<string | null>(null);
  const stableIdentity = useMemo<CardTerminalIdentity>(() => ({
    projectId: identity.projectId,
    deckId: identity.deckId,
    cardId: identity.cardId,
    conversationId: identity.conversationId,
  }), [identity.cardId, identity.conversationId, identity.deckId, identity.projectId]);
  const identityKey = `${stableIdentity.projectId}:${stableIdentity.deckId}:${stableIdentity.cardId}:${stableIdentity.conversationId}`;

  identityKeyRef.current = identityKey;
  connectionStateRef.current = connectionState;

  useEffect(() => {
    setAttachment(null);
    setConnectionState('opening');
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
          const sizeKey = `${terminal.cols}x${terminal.rows}`;
          if (connectionStateRef.current === 'connected' && lastResizeRef.current !== sizeKey) {
            lastResizeRef.current = sizeKey;
            streamRef.current?.resize(terminal.cols, terminal.rows);
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
    const input = terminal.onData((data) => streamRef.current?.write(data));
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
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      setTerminalReady(false);
    };
  }, [identityKey]);

  useEffect(() => {
    if (!terminalReady || attachment || error) return;
    const key = `${identityKey}:hermes-tui`;
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
      setAttachment(opened);
      setConnectionState('opening');
      setError(null);
    }).catch((cause) => {
      if (!active || pendingOpenRef.current !== pending || identityKeyRef.current !== identityKey) return;
      pendingOpenRef.current = null;
      setConnectionState('failed');
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [attachment, client, error, identityKey, stableIdentity, terminalReady]);

  useEffect(() => {
    if (!attachment) return;
    let lastSequence = 0;
    const streamIdentityKey = identityKey;
    let stream: ReturnType<CardTerminalClient['stream']>;
    stream = client.stream(attachment, {
      onOutput: ({ sequence, data }) => {
        if (identityKeyRef.current !== streamIdentityKey || sequence <= lastSequence) return;
        lastSequence = sequence;
        terminalRef.current?.write(data);
      },
      onState: (next) => {
        if (identityKeyRef.current !== streamIdentityKey) return;
        setConnectionState(next.state);
        if (next.state === 'connected') {
          lastResizeRef.current = `${sizeRef.current.cols}x${sizeRef.current.rows}`;
          stream.resize(sizeRef.current.cols, sizeRef.current.rows);
        }
        if (next.error) setError(next.error);
      },
      onTransportError: () => {
        if (identityKeyRef.current !== streamIdentityKey) return;
        setConnectionState('failed');
        setError('card_terminal_transport_failed');
      },
    });
    streamRef.current = stream;
    return () => {
      if (streamRef.current === stream) streamRef.current = null;
      stream.close();
    };
  }, [attachment, client, identityKey]);

  return (
    <section
      data-testid="card-terminal-panel"
      data-stored-session-id={attachment?.storedSessionId || ''}
      data-card-id={attachment?.cardId || identity.cardId}
      data-profile={attachment?.profile || ''}
      data-attach-identity={attachment?.attachIdentity || ''}
      data-status={connectionState}
      aria-label="Card terminal"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        overflow: 'hidden', background: '#0b0f14', color: '#d7e0ea',
      }}
    >
      {error ? <div role="alert" style={{ padding: '0 8px 6px', fontSize: 12 }}>{error}</div> : null}
      <div ref={containerRef} data-testid="card-terminal-xterm" style={{ flex: 1, minHeight: 0, padding: '6px 8px' }} />
    </section>
  );
}
