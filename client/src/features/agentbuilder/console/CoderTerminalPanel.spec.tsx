// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CoderTerminalPanel from './CoderTerminalPanel';
import type {
  CoderTerminalClient,
  ConsoleSessionInfo,
} from './coderTerminalClient';

const xtermProps = vi.hoisted(() => ({ current: null as Record<string, any> | null }));

vi.mock('./XtermView', async () => {
  const react = await import('react');
  return {
    default: (props: Record<string, any>) => {
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
    startSession: vi.fn(async () => ({ ok: true as const, session: session() })),
    listSessions: vi.fn(async () => []),
    getSession: vi.fn(async () => null),
    streamOutput: vi.fn(async () => undefined),
    sendInput: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    stopSession: vi.fn(async () => true),
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
});

async function render(element: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
}

const identityProps = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  conversationId: 'main',
};

describe('CoderTerminalPanel', () => {
  it('attaches only to the startup-owned terminal without lifecycle controls', async () => {
    const terminalClient = client({ listSessions: vi.fn(async () => [session()]) });
    await render(
      <CoderTerminalPanel
        open
        targetRoot="C:/Projects/LiquidAIty/main"
        client={terminalClient}
        {...identityProps}
      />,
    );
    await act(async () => Promise.resolve());
    expect(terminalClient.startSession).not.toHaveBeenCalled();
    expect(host?.querySelector('[data-testid="coder-terminal-status"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')).not.toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('reports a missing startup-owned terminal without trying to create one from the UI', async () => {
    const terminalClient = client();
    await render(<CoderTerminalPanel open client={terminalClient} {...identityProps} />);
    await act(async () => Promise.resolve());
    expect(terminalClient.startSession).not.toHaveBeenCalled();
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
        {...identityProps}
      />,
    );
    await act(async () => Promise.resolve());
    expect(terminalClient.startSession).not.toHaveBeenCalled();
    expect(host?.querySelector('[data-testid="coder-terminal-process"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('does not expose the removed shell, root, transport, or transcript controls', async () => {
    await render(
      <CoderTerminalPanel
        open
        client={client()}
        initialSession={session()}
        {...identityProps}
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
      <CoderTerminalPanel open client={client()} initialSession={session('running')} {...identityProps} />,
    );
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
  });

  it('coalesces valid live resizes and never resizes a stopped session', async () => {
    const resize = vi.fn(async () => true);
    const terminalClient = client({ resize });
    await render(
      <CoderTerminalPanel open client={terminalClient} initialSession={session('running')} {...identityProps} />,
    );
    await act(async () => {
      await xtermProps.current?.onResize?.(120, 30);
      await xtermProps.current?.onResize?.(120, 30);
    });
    expect(resize).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledWith('coder-terminal-1', 120, 30);

    await act(async () => root?.render(
      <CoderTerminalPanel key="stopped" open client={terminalClient} initialSession={session('stopped')} {...identityProps} />,
    ));
    expect(xtermProps.current?.onResize).toBeUndefined();
  });

  it('does not turn a stopped or failed native session into a user lifecycle control', async () => {
    await render(
      <CoderTerminalPanel open client={client()} initialSession={session('stopped')} {...identityProps} />,
    );
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('renders the exact native failure in xterm without lifecycle controls', async () => {
    const failed = session('failed');
    failed.error = 'hermes_acp_rpc_error:native_startup_failed';
    await render(
      <CoderTerminalPanel
        open
        client={client()}
        initialSession={failed}
        {...identityProps}
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
});
