// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CoderTerminalPanel from './CoderTerminalPanel';
import type {
  CoderTerminalClient,
  ConsoleSessionInfo,
} from './coderTerminalClient';

vi.mock('./XtermView', async () => {
  const react = await import('react');
  return {
    default: ({ launchError }: { launchError?: string | null }) => react.createElement(
      'div',
      { 'data-testid': 'coder-terminal-xterm' },
      launchError || '',
    ),
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
  it('starts the repository Hermes CLI only after the operator clicks Start', async () => {
    const terminalClient = client();
    await render(
      <CoderTerminalPanel
        open
        targetRoot="C:/Projects/LiquidAIty/main"
        client={terminalClient}
        {...identityProps}
      />,
    );
    expect(terminalClient.startSession).not.toHaveBeenCalled();
    const start = host?.querySelector('[data-testid="coder-terminal-start"]') as HTMLButtonElement;
    await act(async () => start.click());
    expect(terminalClient.startSession).toHaveBeenCalledWith({
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
      targetRoot: 'C:/Projects/LiquidAIty/main',
      mode: 'interactive',
    });
    expect(host?.querySelector('[data-testid="coder-terminal-status"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')).not.toBeNull();
  });

  it('reattaches only to an already-live repository Hermes process without replay or auto-start', async () => {
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
    expect(host?.querySelector('[data-testid="coder-terminal-process"]')?.textContent).toContain(
      'Hermes/venv/Scripts/hermes.exe · PID 42',
    );
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).not.toBeNull();
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
    expect(host?.querySelector('[data-testid="coder-terminal-process"]')?.textContent).toContain(
      'Hermes/venv/Scripts/hermes.exe · PID 42',
    );
  });

  it('shows Stop only while the real Hermes process is active', async () => {
    await render(
      <CoderTerminalPanel open client={client()} initialSession={session('running')} {...identityProps} />,
    );
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).not.toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
  });

  it('shows Restart only after a stopped or failed session', async () => {
    await render(
      <CoderTerminalPanel open client={client()} initialSession={session('stopped')} {...identityProps} />,
    );
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')?.textContent).toBe('Restart');
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).toBeNull();
  });

  it('renders the exact native startup failure in xterm without the generic 502 label', async () => {
    const failed = session('failed');
    failed.error = 'hermes_acp_rpc_error:native_startup_failed';
    await render(
      <CoderTerminalPanel
        open
        client={client({
          startSession: vi.fn(async () => ({
            ok: false as const,
            error: failed.error!,
            missing: [],
            session: failed,
          })),
        })}
        {...identityProps}
      />,
    );
    const start = host?.querySelector('[data-testid="coder-terminal-start"]') as HTMLButtonElement;
    await act(async () => start.click());
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')?.textContent).toBe(
      'hermes_acp_rpc_error:native_startup_failed',
    );
    expect(host?.textContent).not.toContain('console_start_failed_502');
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).not.toBeNull();
  });
});
