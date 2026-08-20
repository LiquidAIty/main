import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  coderTerminalClient,
  type ConsoleSessionInfo,
  type CoderTerminalClient,
} from './coderTerminalClient';
import XtermView from './XtermView';

/** The saved Coder Card's genuine Hermes CLI pseudoterminal. */

type CoderTerminalPanelProps = {
  open: boolean;
  targetRoot?: string;
  title?: string;
  placement?: 'overlay' | 'docked';
  testIdPrefix?: string;
  projectId?: string;
  deckId?: string;
  conversationId?: string;
  onClose?: () => void;
  /** Injectable for tests. Defaults to the real backend client. */
  client?: CoderTerminalClient;
  /** Test seam: a session already known to the host. */
  initialSession?: ConsoleSessionInfo | null;
};

function CoderTerminalPanelInner({
  open,
  targetRoot = '',
  title = 'Coder',
  placement = 'overlay',
  testIdPrefix = 'coder-terminal',
  projectId,
  deckId,
  conversationId,
  onClose,
  client = coderTerminalClient,
  initialSession = null,
}: CoderTerminalPanelProps) {
  const [session, setSession] = useState<ConsoleSessionInfo | null>(initialSession);
  const [startError, setStartError] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const status = session?.state ?? 'idle';

  useEffect(() => {
    if (!open || session || !projectId || !deckId || !conversationId) return;
    let cancelled = false;
    void client.listSessions().then((sessions) => {
      if (cancelled) return;
      const live = sessions.find((candidate) => (
        candidate.projectId === projectId
        && candidate.deckId === deckId
        && candidate.conversationId === conversationId
        && candidate.ownerCardId === 'card_local_coder'
        && candidate.runtimeSource === 'repository_hermes_cli'
        && ['starting', 'running'].includes(candidate.state)
        && Boolean(candidate.pid)
      ));
      if (live) setSession(live);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, conversationId, deckId, open, projectId, session]);

  const startSession = useCallback(
    async () => {
      if (!projectId || !deckId || !conversationId) {
        setStartError('coder_terminal_identity_required');
        return;
      }
      setBusy(true);
      setStartError(null);
      setTerminalError(null);
      try {
        const result = await client.startSession({
          projectId,
          deckId,
          conversationId,
          ...(targetRoot.trim() ? { targetRoot } : {}),
          mode: 'interactive',
        });
        if (result.ok) {
          setSession(result.session);
        } else if (result.session) {
          setSession(result.session);
          setStartError(result.error);
        } else {
          setStartError(`${result.error}${result.missing.length ? `: ${result.missing.join(', ')}` : ''}`);
        }
      } catch (error) {
        setStartError(
          `console_start_failed:${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [client, conversationId, deckId, projectId, targetRoot],
  );

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
      if (!session?.id) return;
      await client.resize(session.id, cols, rows);
    },
    [client, session?.id],
  );

  const stopSession = useCallback(async () => {
    if (!session?.id) return;
    setTerminalError(null);
    try {
      await client.stopSession(session.id);
      setSession((current) => current ? { ...current, state: 'stopping' } : current);
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error));
    }
  }, [client, session?.id]);

  if (!open) return null;

  return (
    <section
      data-testid={`${testIdPrefix}-panel`}
      aria-label={title}
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

      {session ? (
        <>
          <div
            data-testid={`${testIdPrefix}-process`}
            style={{ padding: '5px 8px', color: '#8fa6bc', overflowWrap: 'anywhere' }}
          >
            {session.executable || 'Hermes CLI'}
            {session.pid ? ` · PID ${session.pid}` : ` · ${session.state}`}
          </div>
          <XtermView
            key={session.id}
            interactive={status === 'starting' || status === 'running'}
            connectOutput={status === 'starting' || status === 'running' ? connectOutput : undefined}
            onData={sendData}
            onResize={resizeTerminal}
            onOutputClosed={refreshSession}
            onError={(message) => {
              if (message === 'The operation was aborted.') return;
              setTerminalError(message);
            }}
            launchError={session.error || startError}
          />
        </>
      ) : null}

      {!session ? <div style={{ flex: 1 }} /> : null}

      {startError || terminalError ? (
        <div data-testid={`${testIdPrefix}-error`} style={{ padding: '6px 12px', color: '#e06c75' }}>
          {startError || terminalError}
        </div>
      ) : null}

      {!session ? (
        <div style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 1 }}>
          <button
            type="button"
            data-testid={`${testIdPrefix}-start`}
            disabled={busy}
            onClick={() => void startSession()}
          >
            Start
          </button>
        </div>
      ) : session && (status === 'failed' || status === 'stopped') ? (
        <div style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 1 }}>
          <button
            type="button"
            data-testid={`${testIdPrefix}-start`}
            disabled={busy}
            onClick={() => void startSession()}
          >
            Restart
          </button>
        </div>
      ) : session && (status === 'starting' || status === 'running') ? (
        <div style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 1 }}>
          <button type="button" data-testid={`${testIdPrefix}-stop`} onClick={() => void stopSession()}>
            Stop
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Isolation boundary so a fault in the console panel can NEVER blank the
 * AgentBuilder canvas. On error it renders nothing (the panel simply does not
 * appear); the rest of the workspace keeps working.
 */
class ConsolePanelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    // Surface for debugging without taking down the canvas.
    console.error('[CoderTerminalPanel] isolated render error:', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function CoderTerminalPanel(props: CoderTerminalPanelProps) {
  return (
    <ConsolePanelErrorBoundary>
      <CoderTerminalPanelInner {...props} />
    </ConsolePanelErrorBoundary>
  );
}
