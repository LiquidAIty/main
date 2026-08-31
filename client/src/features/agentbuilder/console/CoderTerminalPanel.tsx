import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  coderTerminalClient,
  type ConsoleSessionInfo,
  type CoderTerminalClient,
} from './coderTerminalClient';
import XtermView from './XtermView';
import AdaptiveCardTerminal, {
  RuntimeEventList,
  type CardTerminalEvent,
  type TerminalRun,
} from './AdaptiveCardTerminal';

/** A saved Hermes Card's genuine CLI pseudoterminal. */

type CoderTerminalPanelProps = {
  open: boolean;
  title?: string;
  placement?: 'overlay' | 'docked';
  testIdPrefix?: string;
  ownerCardId?: string;
  onClose?: () => void;
  /** Injectable for tests. Defaults to the real backend client. */
  client?: CoderTerminalClient;
  /** Test seam: a session already known to the host. */
  initialSession?: ConsoleSessionInfo | null;
  cardRun?: TerminalRun | null;
  cardRunBusy?: boolean;
  cardIdentity?: { projectId: string; deckId: string; cardId: string; profile: string };
  onStopCardRun?: () => void;
  onRejoinCardRun?: () => void;
  /** Keep the actual PTY attached while preventing this projection from becoming another composer. */
  readOnly?: boolean;
  activityState?: 'idle' | 'connecting' | 'running';
  /** Main-only semantic execution projection from this same native session. */
  semanticEvents?: CardTerminalEvent[];
  semanticError?: string | null;
};

function CoderTerminalPanelInner({
  open,
  title = 'Coder',
  placement = 'overlay',
  testIdPrefix = 'coder-terminal',
  ownerCardId = 'card_local_coder',
  onClose,
  client = coderTerminalClient,
  initialSession = null,
  cardRun = null,
  cardRunBusy = false,
  cardIdentity,
  onStopCardRun,
  onRejoinCardRun,
  readOnly = false,
  activityState,
  semanticEvents,
  semanticError = null,
}: CoderTerminalPanelProps) {
  const [projection, setProjection] = useState<'cli' | 'run'>('cli');
  useEffect(() => {
    if (cardIdentity && (cardRun?.runId || cardRunBusy)) setProjection('run');
  }, [cardIdentity?.cardId, cardRun?.runId, cardRunBusy]);
  const showingRun = Boolean(cardIdentity && projection === 'run');
  const [session, setSession] = useState<ConsoleSessionInfo | null>(initialSession);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const inputQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const sessionRef = useRef<ConsoleSessionInfo | null>(initialSession);
  const lastResizeRef = useRef('');

  const status = session?.state ?? 'idle';
  const showingSemanticProjection = readOnly && semanticEvents !== undefined;
  sessionRef.current = session;
  useEffect(() => {
    if (!open || session) return;
    let cancelled = false;
    void client.listSessions()
      .then((sessions) => {
        if (cancelled) return;
        const live = sessions.find((candidate) => (
          candidate.ownerCardId === ownerCardId
          && candidate.runtimeSource === 'repository_hermes_cli'
          && ['starting', 'running'].includes(candidate.state)
          && Boolean(candidate.pid)
        ));
        if (live) {
          setSession(live);
          return;
        }
        setTerminalError(`${ownerCardId}_terminal_startup_session_unavailable`);
      })
      .catch((error) => {
        if (!cancelled) {
          setTerminalError(error instanceof Error ? error.message : String(error));
        }
      })
    return () => {
      cancelled = true;
    };
  }, [client, open, ownerCardId, session]);

  const connectOutput = useCallback(
    async (onData: (data: string) => void, signal: AbortSignal) => {
      if (!session?.id) return;
      await client.streamOutput(session.id, onData, signal);
    },
    [client, session?.id],
  );

  const refreshSession = useCallback(async () => {
    if (!session?.id) return;
    const refreshed = await client.getSession(session.id);
    if (refreshed) setSession(refreshed);
  }, [client, session?.id]);

  const sendData = useCallback(
    async (data: string) => {
      if (!session?.id) return;
      setTerminalError(null);
      const sessionId = session.id;
      const queued = inputQueueRef.current.then(() => client.sendInput(sessionId, data));
      inputQueueRef.current = queued.catch(() => undefined);
      await queued;
    },
    [client, session?.id],
  );

  const resizeTerminal = useCallback(
    async (cols: number, rows: number) => {
      const current = sessionRef.current;
      if (
        !current?.id
        || !['starting', 'running'].includes(current.state)
        || !Number.isInteger(cols)
        || !Number.isInteger(rows)
        || cols < 2
        || rows < 1
      ) return;
      const resizeIdentity = `${current.id}:${cols}x${rows}`;
      if (lastResizeRef.current === resizeIdentity) return;
      lastResizeRef.current = resizeIdentity;
      try {
        await client.resize(current.id, cols, rows);
      } catch (error) {
        const latest = sessionRef.current;
        if (!latest || latest.id !== current.id || !['starting', 'running'].includes(latest.state)) {
          return;
        }
        lastResizeRef.current = '';
        throw error;
      }
    },
    [client],
  );

  useEffect(() => {
    lastResizeRef.current = '';
  }, [session?.id]);

  if (!open) return null;

  return (
    <section
      data-testid={`${testIdPrefix}-panel`}
      aria-label={title}
      tabIndex={-1}
      style={{
        position: placement === 'overlay' ? 'absolute' : 'relative',
        right: placement === 'overlay' ? 0 : undefined,
        top: placement === 'overlay' ? 0 : undefined,
        bottom: placement === 'overlay' ? 0 : undefined,
        width: placement === 'overlay' ? 'min(640px, 60%)' : '100%',
        height: placement === 'docked' ? '100%' : undefined,
        display: 'flex',
        flexDirection: 'column',
        background: '#0b0f14',
        color: '#d7e0ea',
        borderLeft: placement === 'overlay' ? '1px solid #1c2733' : undefined,
        borderTop: placement === 'docked' ? '1px solid #1c2733' : undefined,
        zIndex: placement === 'overlay' ? 40 : undefined,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
      }}
    >
      {onClose ? (
        <button
          type="button"
          aria-label={`Close ${title}`}
          data-testid={`${testIdPrefix}-close`}
          onClick={onClose}
          style={{ position: 'absolute', right: 6, top: 6, zIndex: 1 }}
        >
          ✕
        </button>
      ) : null}

      {cardIdentity ? <div style={{ display: 'flex', gap: 8, padding: 6 }}>
        <button type="button" aria-pressed={showingRun} onClick={() => setProjection('run')}>Card Run</button>
        <button type="button" aria-pressed={!showingRun} onClick={() => setProjection('cli')}>Native CLI</button>
      </div> : null}
      {readOnly ? (
        <div
          data-testid={`${testIdPrefix}-connection-status`}
          role="status"
          style={{ padding: '5px 8px', color: '#8fa6bc', borderBottom: '1px solid #1c2733' }}
        >
          {session
            ? activityState === 'running'
              ? 'Working'
              : activityState === 'connecting'
                ? 'Starting turn'
                : 'Ready · idle'
            : `${title} connecting`}
        </div>
      ) : null}
      {showingRun && cardIdentity ? <div data-testid="coder-console-card-run" style={{ overflow: 'auto', minHeight: 0 }}>
        <AdaptiveCardTerminal enabled projectId={cardIdentity.projectId} deckId={cardIdentity.deckId}
          cardId={cardIdentity.cardId} runtime={{ kind: 'hermes', mode: 'delegate', profile: cardIdentity.profile }}
          run={cardRun} busy={cardRunBusy} onStop={onStopCardRun} onRejoin={onRejoinCardRun}>
          <div>Supply the mission from this Card's CLI tab.</div>
        </AdaptiveCardTerminal>
      </div> : null}
      <div style={{ display: showingRun ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {session ? (
        showingSemanticProjection ? (
          <div
            data-testid={`${testIdPrefix}-semantic-output`}
            data-session-id={session.id}
            role="log"
            aria-live="polite"
            style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}
          >
            <RuntimeEventList main events={semanticEvents} />
            {semanticError ? <div role="alert">{semanticError}</div> : null}
          </div>
        ) : (
          <XtermView
            key={session.id}
            interactive={!readOnly && (status === 'starting' || status === 'running')}
            connectOutput={status === 'starting' || status === 'running' ? connectOutput : undefined}
            onData={sendData}
            onResize={status === 'starting' || status === 'running' ? resizeTerminal : undefined}
            onOutputClosed={refreshSession}
            onError={(message) => {
              if (message === 'The operation was aborted.') return;
              setTerminalError(message);
            }}
            launchError={session.error || terminalError}
          />
        )
      ) : null}

      {!session ? (
        <div style={{ flex: 1, padding: 8, color: '#8fa6bc' }} role={terminalError ? 'alert' : 'status'}>
          {terminalError || `${title} connecting`}
        </div>
      ) : null}
      </div>
    </section>
  );
}

/**
 * Isolation boundary so a terminal-rendering fault cannot blank the AgentBuilder
 * canvas. The failure remains visible when the terminal region is opened.
 */
class ConsolePanelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[CoderTerminalPanel] isolated render error:', error);
  }
  render() {
    return this.state.failed ? (
      <div data-testid="coder-terminal-unavailable" role="alert" style={{ padding: 8 }}>
        coder_terminal_surface_unavailable
      </div>
    ) : this.props.children;
  }
}

export default function CoderTerminalPanel(props: CoderTerminalPanelProps) {
  return (
    <ConsolePanelErrorBoundary>
      <CoderTerminalPanelInner {...props} />
    </ConsolePanelErrorBoundary>
  );
}
