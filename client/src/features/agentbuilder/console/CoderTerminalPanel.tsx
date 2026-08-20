import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  coderTerminalClient,
  type ConsoleOutputChunk,
  type ConsoleSessionInfo,
  type CoderTerminalClient,
} from './coderTerminalClient';
import XtermView from './XtermView';

/** The saved Coder Card's genuine Hermes ACP terminal face. */

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
  /** Test seam: EventSource constructor (undefined in jsdom = no live stream). */
  eventSourceImpl?: typeof EventSource;
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

  const status = disconnected ? 'disconnected' : session?.state ?? 'idle';

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
    source.onopen = () => setDisconnected(false);
    source.onerror = () => setDisconnected(true);
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
          setChunks(result.transcript);
        } else if (result.session) {
          setSession(result.session);
          setChunks(result.transcript ?? []);
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
      setTerminalError(null);
      await client.sendInput(session.id, message);
    },
    [client, session?.id],
  );

  const stopSession = useCallback(async () => {
    if (!session?.id) return;
    setTerminalError(null);
    try {
      await client.stopSession(session.id);
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
        <XtermView
          key={session.id}
          chunks={chunks}
          interactive={status === 'ready' || status === 'waiting'}
          onSubmit={sendLine}
          onError={setTerminalError}
        />
      ) : null}

      {!session ? <div style={{ flex: 1 }} /> : null}

      {startError || terminalError ? (
        <div data-testid={`${testIdPrefix}-error`} style={{ padding: '6px 12px', color: '#e06c75' }}>
          {startError || terminalError}
        </div>
      ) : null}

      {session && (status === 'failed' || status === 'stopped' || status === 'auth_required') ? (
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
      ) : session && (status === 'working' || status === 'waiting') ? (
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
