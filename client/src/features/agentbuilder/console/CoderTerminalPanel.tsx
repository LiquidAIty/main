import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  coderTerminalClient,
  type ConsoleOutputChunk,
  type ConsoleSessionState,
  type ConsoleSessionInfo,
  type CoderTerminalClient,
} from './coderTerminalClient';
import XtermView from './XtermView';

/** The saved Coder Card's genuine Hermes ACP terminal face. */

type ConsolePanelStatus = 'disconnected' | 'idle' | ConsoleSessionState;

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
  initialTranscript?: ConsoleOutputChunk[];
  /** Optional host wording for lifecycle states. */
  idleLabel?: string;
  /** Test seam: EventSource constructor (undefined in jsdom = no live stream). */
  eventSourceImpl?: typeof EventSource;
};

function statusOf(session: ConsoleSessionInfo | null): ConsolePanelStatus {
  if (!session) return 'idle';
  return session.state;
}

const STATUS_LABEL: Record<ConsolePanelStatus, string> = {
  disconnected: 'Disconnected',
  idle: 'Idle',
  starting: 'Starting',
  ready: 'Ready',
  working: 'Working',
  waiting: 'Waiting',
  stopped: 'Stopped',
  failed: 'Failed',
  auth_required: 'Login required',
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
  initialTranscript = [],
  idleLabel = 'Idle',
  eventSourceImpl,
}: CoderTerminalPanelProps) {
  const [session, setSession] = useState<ConsoleSessionInfo | null>(initialSession);
  const [chunks, setChunks] = useState<ConsoleOutputChunk[]>(initialTranscript);
  const [startError, setStartError] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const streamRef = useRef<EventSource | null>(null);
  const attemptedIdentityRef = useRef('');

  const status = disconnected ? 'disconnected' : statusOf(session);
  const statusLabel = status === 'idle'
    ? idleLabel
    : STATUS_LABEL[status];

  const appendChunk = useCallback((chunk: ConsoleOutputChunk) => {
    setChunks((prev) => {
      if (prev.some((current) => current.seq === chunk.seq)) return prev;
      return [...prev, chunk].slice(-2000);
    });
  }, []);

  // Subscribe to the live transcript stream for the active session.
  useEffect(() => {
    const ESImpl = eventSourceImpl ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
    if (!session?.id || !ESImpl) return;
    const source = new ESImpl(client.streamUrl(session.id));
    streamRef.current = source;
    source.addEventListener('chunk', (event) => {
      try {
        appendChunk(JSON.parse((event as MessageEvent).data));
      } catch {
        /* ignore malformed frame */
      }
    });
    source.addEventListener('lifecycle', (event) => {
      try {
        setSession(JSON.parse((event as MessageEvent).data) as ConsoleSessionInfo);
      } catch {
        /* ignore malformed frame */
      }
    });
    return () => {
      source.close();
      streamRef.current = null;
    };
  }, [session?.id, client, appendChunk, eventSourceImpl]);

  const startSession = useCallback(
    async () => {
      if (!projectId || !deckId || !conversationId) {
        setStartError('coder_terminal_identity_required');
        return;
      }
      setBusy(true);
      setDisconnected(false);
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
          setChunks([]);
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

  useEffect(() => {
    if (!open || session || busy || !projectId || !deckId || !conversationId) return;
    const identity = `${projectId}:${deckId}:${conversationId}`;
    if (attemptedIdentityRef.current === identity) return;
    attemptedIdentityRef.current = identity;
    void startSession();
  }, [busy, conversationId, deckId, open, projectId, session, startSession]);

  const sendLine = useCallback(
    async (message: string) => {
      if (!session?.id) return;
      await client.sendInput(session.id, message);
    },
    [client, session?.id],
  );

  const stopSession = useCallback(async () => {
    if (!session?.id) return;
    await client.stopSession(session.id);
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
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid #1c2733',
        }}
      >
        <strong style={{ flex: 1 }}>{title}</strong>
        <span data-testid={`${testIdPrefix}-status`} style={{ opacity: 0.8 }}>
          {statusLabel}
        </span>
        {onClose ? (
          <button type="button" data-testid={`${testIdPrefix}-close`} onClick={onClose}>
            ✕
          </button>
        ) : null}
      </header>

      {session ? (
        <XtermView
          key={session.id}
          chunks={chunks}
          interactive={status === 'ready' || status === 'waiting'}
          onSubmit={sendLine}
          onError={setTerminalError}
        />
      ) : null}

      {!session ? <div style={{ flex: 1 }} /> : null}

      {startError || terminalError || session?.error ? (
        <div data-testid={`${testIdPrefix}-error`} style={{ padding: '6px 12px', color: '#e06c75' }}>
          {startError || terminalError || session?.error}
        </div>
      ) : null}

      <footer style={{ padding: '6px 12px', borderTop: '1px solid #1c2733', display: 'flex', justifyContent: 'flex-end' }}>
        {session && (status === 'failed' || status === 'stopped' || status === 'auth_required') ? (
          <button
            type="button"
            data-testid={`${testIdPrefix}-start`}
            disabled={busy}
            onClick={() => void startSession()}
          >
            Restart
          </button>
        ) : session && (status === 'working' || status === 'waiting') ? (
          <button type="button" data-testid={`${testIdPrefix}-stop`} onClick={() => void stopSession()}>
            Stop
          </button>
        ) : null}
      </footer>
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
