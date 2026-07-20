import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  openClaudeConsoleClient,
  type ConsoleMode,
  type ConsoleOutputChunk,
  type ConsoleSessionInfo,
  type OpenClaudeConsoleClient,
} from './openClaudeConsoleClient';
import XtermView from './XtermView';
import { CODER_DISPLAY_NAMES, redactCoderBranding } from './coderConsoleNames';

/**
 * OpenClaude Console Bridge panel — the in-app terminal view of the real
 * OpenClaude CLI process. Mag One controls the task; OpenClaude does the work;
 * this panel shows the live session and (when interactive) takes input.
 *
 * It does not replace the Local Coder canvas card. Terminal output is not a
 * CoderReport; this surface reports session lifecycle and the bounded
 * transcript honestly.
 */

type ConsolePanelStatus = 'disconnected' | 'idle' | 'starting' | 'running' | 'failed' | 'complete';

export type OpenClaudeConsolePanelProps = {
  open: boolean;
  targetRoot: string;
  projectId?: string;
  provider?: string | null;
  model?: string | null;
  onClose?: () => void;
  /** Injectable for tests. Defaults to the real backend client. */
  client?: OpenClaudeConsoleClient;
  /** Test seam: a session already known to the host. */
  initialSession?: ConsoleSessionInfo | null;
  initialTranscript?: ConsoleOutputChunk[];
  /** Test seam: EventSource constructor (undefined in jsdom = no live stream). */
  eventSourceImpl?: typeof EventSource;
  /**
   * Optional display-only redaction of underlying-CLI branding for public/
   * non-developer terminals. Off by default so developers keep the exact raw
   * transcript. Never mutates stored/proof transcripts — display only.
   */
  redactBranding?: boolean;
};

function statusOf(session: ConsoleSessionInfo | null): ConsolePanelStatus {
  if (!session) return 'idle';
  if (session.state === 'starting') return 'starting';
  if (session.state === 'running') return 'running';
  if (session.state === 'failed') return 'failed';
  if (session.state === 'exited') return 'complete';
  return 'idle';
}

const STATUS_LABEL: Record<ConsolePanelStatus, string> = {
  disconnected: 'Disconnected',
  idle: 'Idle',
  starting: 'Starting',
  running: 'Running',
  failed: 'Failed',
  complete: 'Complete',
};

function OpenClaudeConsolePanelInner({
  open,
  targetRoot,
  projectId,
  provider,
  model,
  onClose,
  client = openClaudeConsoleClient,
  initialSession = null,
  initialTranscript = [],
  eventSourceImpl,
  redactBranding = false,
}: OpenClaudeConsolePanelProps) {
  const [session, setSession] = useState<ConsoleSessionInfo | null>(initialSession);
  const [chunks, setChunks] = useState<ConsoleOutputChunk[]>(initialTranscript);
  // Display-only view of the transcript; the raw `chunks` stay untouched.
  const displayChunks = redactBranding
    ? chunks.map((chunk) => ({ ...chunk, data: redactCoderBranding(chunk.data) }))
    : chunks;
  const [input, setInput] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<EventSource | null>(null);

  const status = statusOf(session);

  const appendChunk = useCallback((chunk: ConsoleOutputChunk) => {
    setChunks((prev) => [...prev, chunk].slice(-2000));
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
    async (mode: ConsoleMode) => {
      setBusy(true);
      setStartError(null);
      const result = await client.startSession({
        targetRoot,
        mode,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      });
      setBusy(false);
      if (result.ok) {
        setSession(result.session);
        setChunks([]);
      } else {
        setStartError(`${result.error}${result.missing.length ? `: ${result.missing.join(', ')}` : ''}`);
      }
    },
    [client, model, provider, targetRoot],
  );

  const sendInput = useCallback(async () => {
    if (!session?.id || !input) return;
    await client.sendInput(session.id, `${input}\n`);
    setInput('');
  }, [client, session?.id, input]);

  // Raw keystroke + resize forwarding from the xterm terminal.
  const sendRaw = useCallback(
    async (data: string) => {
      if (!session?.id) return;
      await client.sendInput(session.id, data);
    },
    [client, session?.id],
  );
  const resizeSession = useCallback(
    async (cols: number, rows: number) => {
      if (!session?.id) return;
      await client.resizeSession(session.id, cols, rows);
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
      data-testid="openclaude-console-panel"
      aria-label={CODER_DISPLAY_NAMES.console}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 'min(640px, 60%)',
        display: 'flex',
        flexDirection: 'column',
        background: '#0b0f14',
        color: '#d7e0ea',
        borderLeft: '1px solid #1c2733',
        zIndex: 40,
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
        <strong style={{ flex: 1 }}>{CODER_DISPLAY_NAMES.console}</strong>
        <span data-testid="openclaude-console-status" style={{ opacity: 0.8 }}>
          {STATUS_LABEL[status]}
        </span>
        {onClose ? (
          <button type="button" data-testid="openclaude-console-close" onClick={onClose}>
            ✕
          </button>
        ) : null}
      </header>

      <div style={{ padding: '6px 12px', borderBottom: '1px solid #11181f', opacity: 0.85 }}>
        <div data-testid="openclaude-console-target-root">root: {targetRoot}</div>
        <div data-testid="openclaude-console-session-id">
          session: {session?.id ?? '—'}
          {projectId ? ` · project: ${projectId}` : ''}
        </div>
        {session?.model ? <div>model: {session.model}</div> : null}
        {session ? (
          <div data-testid="openclaude-console-transport">transport: {session.transportMode}</div>
        ) : null}
        <div style={{ color: '#f0a35e', marginTop: 2 }}>
          Local process — runs with this machine&apos;s permissions. Not a sandbox.
        </div>
      </div>

      {session && (status === 'running' || status === 'starting' || status === 'complete') ? (
        <XtermView
          chunks={displayChunks}
          interactive={Boolean(session.interactiveSupported)}
          onInput={sendRaw}
          onResize={resizeSession}
        />
      ) : null}

      <pre
        data-testid="openclaude-console-transcript"
        style={{
          maxHeight: session ? 140 : undefined,
          flex: session ? undefined : 1,
          margin: 0,
          padding: '8px 12px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          borderTop: session ? '1px solid #11181f' : undefined,
        }}
      >
        {redactBranding ? (
          <span data-testid="openclaude-console-redacted-note" style={{ color: '#6b7785' }}>
            {'[display names cleaned — raw transcript available in developer mode]\n'}
          </span>
        ) : null}
        {displayChunks.map((chunk) => (
          <span key={chunk.seq} style={{ color: chunk.stream === 'stderr' ? '#e06c75' : chunk.stream === 'system' ? '#6b7785' : '#d7e0ea' }}>
            {chunk.data}
          </span>
        ))}
      </pre>

      {startError ? (
        <div data-testid="openclaude-console-error" style={{ padding: '6px 12px', color: '#e06c75' }}>
          {startError}
        </div>
      ) : null}

      <footer style={{ padding: '8px 12px', borderTop: '1px solid #1c2733', display: 'flex', gap: 8 }}>
        {!session || status === 'complete' || status === 'failed' ? (
          <button
            type="button"
            data-testid="openclaude-console-start"
            disabled={busy}
            onClick={() => startSession('interactive')}
          >
            Start interactive session
          </button>
        ) : (
          <>
            <input
              data-testid="openclaude-console-input"
              value={input}
              placeholder={session.interactiveSupported ? 'Type a command…' : 'Read-only session'}
              disabled={!session.interactiveSupported}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void sendInput();
                }
              }}
              style={{ flex: 1, background: '#11181f', color: '#d7e0ea', border: '1px solid #1c2733', padding: '4px 8px' }}
            />
            <button type="button" data-testid="openclaude-console-send" onClick={() => void sendInput()} disabled={!session.interactiveSupported}>
              Send
            </button>
            <button type="button" data-testid="openclaude-console-stop" onClick={() => void stopSession()}>
              Stop
            </button>
          </>
        )}
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
    console.error('[OpenClaudeConsolePanel] isolated render error:', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function OpenClaudeConsolePanel(props: OpenClaudeConsolePanelProps) {
  return (
    <ConsolePanelErrorBoundary>
      <OpenClaudeConsolePanelInner {...props} />
    </ConsolePanelErrorBoundary>
  );
}
