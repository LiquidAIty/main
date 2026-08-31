// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CoderTerminalPanel from './CoderTerminalPanel';
import type {
  CoderTerminalClient,
  ConsoleSessionInfo,
} from './coderTerminalClient';

const xtermProps = vi.hoisted(() => ({
  current: null as Record<string, any> | null,
  fail: false,
}));

vi.mock('./XtermView', async () => {
  const react = await import('react');
  return {
    default: (props: Record<string, any>) => {
      if (xtermProps.fail) throw new Error('xterm_render_failed');
      xtermProps.current = props;
      return react.createElement(
        'div',
        { 'data-testid': 'coder-terminal-xterm' },
        props.launchError || '',
      );
    },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function session(state: ConsoleSessionInfo['state'] = 'running'): ConsoleSessionInfo {
  return {
    id: 'coder-terminal-1',
    ownerCardId: 'card_local_coder',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'main',
    targetRoot: 'C:/Projects/LiquidAIty/main',
    mode: 'interactive',
    state,
    runtimeSource: 'repository_hermes_cli',
    transportMode: 'pty',
    profile: 'coder',
    executable: 'C:/Projects/LiquidAIty/main/Hermes/venv/Scripts/hermes.exe',
    hermesHome: 'C:/Projects/LiquidAIty/main/Hermes/.hermes',
    interactiveSupported: true,
    pid: 42,
    startedAt: 'now',
    updatedAt: 'now',
    stoppedAt: null,
    warnings: [],
    error: null,
  };
}

function client(overrides: Partial<CoderTerminalClient> = {}): CoderTerminalClient {
  return {
    listSessions: vi.fn(async () => []),
    getSession: vi.fn(async () => null),
    streamOutput: vi.fn(async () => undefined),
    sendInput: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    ...overrides,
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  xtermProps.current = null;
  xtermProps.fail = false;
});

async function render(element: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
}

describe('CoderTerminalPanel', () => {
  it('attaches only to the startup-owned terminal without lifecycle controls', async () => {
    const terminalClient = client({ listSessions: vi.fn(async () => [session()]) });
    await render(
      <CoderTerminalPanel
        open
        client={terminalClient}
      />,
    );
    await act(async () => Promise.resolve());
    expect(terminalClient.listSessions).toHaveBeenCalledOnce();
    expect(host?.querySelector('[data-testid="coder-terminal-status"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')).not.toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('keeps Main attached and idle without exposing another PTY composer', async () => {
    const terminalClient = client({ listSessions: vi.fn(async () => [
      { ...session(), ownerCardId: 'card_main_chat', profile: 'liquidaity-main' },
    ]) });
    await render(
      <CoderTerminalPanel
        open
        client={terminalClient}
        ownerCardId="card_main_chat"
        testIdPrefix="main-cli"
        title="Main CLI Terminal"
        readOnly
        activityState="idle"
      />,
    );
    await act(async () => Promise.resolve());

    expect(terminalClient.listSessions).toHaveBeenCalledOnce();
    expect(host?.querySelector('[data-testid="main-cli-connection-status"]')?.textContent).toBe('Ready · idle');
    expect(xtermProps.current?.interactive).toBe(false);
    expect(xtermProps.current?.connectOutput).toBeTypeOf('function');
  });

  it('reports a missing startup-owned terminal without trying to create one from the UI', async () => {
    const terminalClient = client();
    await render(<CoderTerminalPanel open client={terminalClient} />);
    await act(async () => Promise.resolve());
    expect(terminalClient.listSessions).toHaveBeenCalledOnce();
    expect(host?.textContent).toContain('coder_terminal_startup_session_unavailable');
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('reattaches to the same already-live repository Hermes process without replay', async () => {
    const live = session();
    const terminalClient = client({ listSessions: vi.fn(async () => [live]) });
    await render(
      <CoderTerminalPanel
        open
        client={terminalClient}
      />,
    );
    await act(async () => Promise.resolve());
    expect(terminalClient.listSessions).toHaveBeenCalledOnce();
    expect(host?.querySelector('[data-testid="coder-terminal-process"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('does not expose the removed shell, root, transport, or transcript controls', async () => {
    await render(
      <CoderTerminalPanel
        open
        client={client()}
        initialSession={session()}
      />,
    );
    expect(host?.textContent).not.toContain('Coder');
    expect(host?.textContent).not.toContain('Ready');
    expect(host?.textContent).not.toContain('Local process');
    expect(host?.textContent).not.toContain('transport:');
    expect(host?.textContent).not.toContain('root:');
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-transcript"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-input"]')).toBeNull();
    expect(host?.textContent).not.toContain('Hermes/venv/Scripts/hermes.exe');
    expect(host?.textContent).not.toContain('PID 42');
  });

  it('never exposes Start or Stop while the real Hermes process is active', async () => {
    await render(
      <CoderTerminalPanel open client={client()} initialSession={session('running')} />,
    );
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
  });

  it('coalesces valid live resizes and never resizes a stopped session', async () => {
    const resize = vi.fn(async () => true);
    const terminalClient = client({ resize });
    await render(
      <CoderTerminalPanel open client={terminalClient} initialSession={session('running')} />,
    );
    await act(async () => {
      await xtermProps.current?.onResize?.(120, 30);
      await xtermProps.current?.onResize?.(120, 30);
    });
    expect(resize).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledWith('coder-terminal-1', 120, 30);

    await act(async () => root?.render(
      <CoderTerminalPanel key="stopped" open client={terminalClient} initialSession={session('stopped')} />,
    ));
    expect(xtermProps.current?.onResize).toBeUndefined();
  });

  it('does not turn a stopped or failed native session into a user lifecycle control', async () => {
    await render(
      <CoderTerminalPanel open client={client()} initialSession={session('stopped')} />,
    );
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('shows the same ACP Card Run in the existing external console without sending it to the CLI', async () => {
    const terminalClient = client();
    const identity = { projectId: 'p', deckId: 'd', cardId: 'card_local_coder', cardName: 'Coder',
      runId: 'coder-run', parentRunId: 'main-run', nativeChildId: null };
    await render(<CoderTerminalPanel open client={terminalClient} initialSession={session()}
      cardIdentity={{ projectId: 'p', deckId: 'd', cardId: 'card_local_coder', profile: 'coder' }}
      cardRun={{ runId: 'coder-run', cardId: 'card_local_coder', state: 'running', status: 'running', output: '', error: null,
        terminal: { ...identity, observation: 'live', activeAgentCount: 1, unavailableReason: null,
          finalText: '', errorCode: null, errorSummary: '', transcript: { sessionId: 'acp-native', unavailableReason: null },
          events: [{ ...identity, id: 'coder-run:text:1', kind: 'model', sequence: 1, timestamp: null, text: 'Actual ACP output' }],
        } }} />);
    expect(host?.querySelector('[data-testid="adaptive-card-terminal"]')?.getAttribute('data-run-id')).toBe('coder-run');
    expect(host?.querySelector('[data-testid="coder-console-card-run"]')?.textContent).toContain('Actual ACP output');
    expect(host?.querySelectorAll('[data-testid="coder-terminal-xterm"]')).toHaveLength(1);
    expect(terminalClient.sendInput).not.toHaveBeenCalled();
  });

  it('renders the exact native failure in xterm without lifecycle controls', async () => {
    const failed = session('failed');
    failed.error = 'hermes_acp_rpc_error:native_startup_failed';
    await render(
      <CoderTerminalPanel
        open
        client={client()}
        initialSession={failed}
      />,
    );
    await act(async () => Promise.resolve());
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')?.textContent).toBe(
      'hermes_acp_rpc_error:native_startup_failed',
    );
    expect(host?.textContent).not.toContain('console_start_failed_502');
    expect(host?.querySelector('[data-testid="coder-terminal-error"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('shows a truthful unavailable state when the terminal surface itself fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    xtermProps.fail = true;
    await render(<CoderTerminalPanel open client={client()} initialSession={session()} />);
    expect(host?.querySelector('[data-testid="coder-terminal-unavailable"]')?.textContent).toBe(
      'coder_terminal_surface_unavailable',
    );
    consoleError.mockRestore();
  });
});
