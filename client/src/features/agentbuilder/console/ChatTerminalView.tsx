import { useCallback, useEffect, useRef, useState } from 'react';
import {
  openClaudeConsoleClient,
  type ConsoleOutputChunk,
  type ConsoleSessionInfo,
  type OpenClaudeConsoleClient,
} from './openClaudeConsoleClient';
import XtermView from './XtermView';

/**
 * In-panel project terminal for the persistent LiquidAIty chat panel. It is the
 * Terminal view of BuilderChat: a REAL platform shell (PowerShell on Windows)
 * rooted at the active project, driven through the existing console/session
 * backend (`/api/coder/openclaude/console/*`, mode: 'shell') and rendered with
 * the existing XtermView. It fills the chat body — no drawer, no bottom tray.
 *
 * Product identity is LiquidAIty: no underlying-runtime branding is shown here.
 * There is no fake transcript — output is only what the real shell emits.
 */

export type ChatTerminalViewProps = {
  /** Repo/workspace root the shell is rooted at. */
  targetRoot: string;
  projectId?: string;
  /** Injectable for tests; defaults to the real backend client. */
  client?: OpenClaudeConsoleClient;
  /** Test seam: EventSource constructor (undefined in jsdom = no live stream). */
  eventSourceImpl?: typeof EventSource;
  /** Transparent background so text sits on the surrounding panel. */
  transparent?: boolean;
  /** Minimal chrome: no header/labels/names. */
  minimal?: boolean;
};

export default function ChatTerminalView({
  targetRoot,
  projectId,
  client = openClaudeConsoleClient,
  eventSourceImpl,
  transparent = false,
  minimal = false,
}: ChatTerminalViewProps) {
  const [session, setSession] = useState<ConsoleSessionInfo | null>(null);
  const [chunks, setChunks] = useState<ConsoleOutputChunk[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef<EventSource | null>(null);
  const startedRef = useRef(false);

  const appendChunk = useCallback((chunk: ConsoleOutputChunk) => {
    setChunks((prev) => [...prev, chunk].slice(-2000));
  }, []);

  const startShell = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    const result = await client.startSession({ targetRoot, mode: 'shell' });
    setStarting(false);
    if (result.ok) {
      setSession(result.session);
      setChunks([]);
    } else {
      setStartError(
        `${result.error}${result.missing.length ? `: ${result.missing.join(', ')}` : ''}`,
      );
    }
  }, [client, targetRoot]);

  // Auto-start the shell once when the terminal view first mounts.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startShell();
  }, [startShell]);

  // Live transcript stream for the active session.
  useEffect(() => {
    const ESImpl =
      eventSourceImpl ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
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

  // Stop the current shell and start a fresh one. This is the only control the
  // terminal window exposes — type directly into the xterm for everything else.
  const restart = useCallback(async () => {
    const current = session?.id;
    setSession(null);
    setChunks([]);
    if (current) {
      try {
        await client.stopSession(current);
      } catch {
        /* best-effort stop; a new session is started regardless */
      }
    }
    await startShell();
  }, [client, session?.id, startShell]);

  const live = session?.state === 'running' || session?.state === 'starting';

  return (
    <div
      data-testid="chat-terminal-view"
      style={{
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: transparent ? 'transparent' : '#0b0f14',
        color: '#d7e0ea',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        minHeight: 0,
        padding: minimal ? '6px 10px' : 0,
      }}
    >
      {/* Only control: stop this shell and start a fresh one. No label. */}
      <button
        type="button"
        data-testid="chat-terminal-restart"
        onClick={() => void restart()}
        disabled={starting}
        title=""
        aria-label="Restart terminal"
        style={{
          position: 'absolute',
          top: minimal ? 5 : 8,
          right: minimal ? 7 : 10,
          zIndex: 2,
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(20,22,26,0.55)',
          color: '#9aa6b2',
          cursor: starting ? 'default' : 'pointer',
          opacity: 0.45,
          transition: 'opacity 120ms ease',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.9')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.45')}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>

      {!minimal ? (
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid #11181f',
            opacity: 0.85,
            flex: '0 0 auto',
          }}
        >
          <div data-testid="chat-terminal-root">root: {targetRoot}</div>
          <div data-testid="chat-terminal-status">
            status: {session?.state ?? (starting ? 'starting' : 'idle')}
            {session?.transportMode ? ` · ${session.transportMode}` : ''}
            {projectId ? ` · project: ${projectId}` : ''}
          </div>
        </div>
      ) : null}

      {session && live ? (
        <XtermView
          chunks={chunks}
          interactive={Boolean(session.interactiveSupported)}
          onInput={sendRaw}
          onResize={resizeSession}
          transparent={transparent}
        />
      ) : (
        <pre
          data-testid="chat-terminal-transcript"
          style={{ flex: 1, margin: 0, padding: '8px 12px', overflow: 'auto', whiteSpace: 'pre-wrap' }}
        >
          {chunks.map((chunk) => (
            <span
              key={chunk.seq}
              style={{
                color:
                  chunk.stream === 'stderr'
                    ? '#e06c75'
                    : chunk.stream === 'system'
                      ? '#6b7785'
                      : '#d7e0ea',
              }}
            >
              {chunk.data}
            </span>
          ))}
        </pre>
      )}

      {startError ? (
        <div data-testid="chat-terminal-error" style={{ padding: '6px 12px', color: '#e06c75' }}>
          {startError}
          <button
            type="button"
            data-testid="chat-terminal-retry"
            onClick={() => void startShell()}
            style={{ marginLeft: 8 }}
            disabled={starting}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
