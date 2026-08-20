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
    default: ({ chunks = [] }: { chunks?: Array<{ data: string }> }) => react.createElement(
      'div',
      { 'data-testid': 'coder-terminal-xterm' },
      chunks.map((chunk) => chunk.data).join(''),
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
    runtimeSource: 'saved_hermes_card',
    transportMode: 'pty',
    profile: 'coder',
    provider: 'openai',
    model: 'gpt-5.6-luna',
    interactiveSupported: true,
    pid: 42,
    nativeSessionId: 'native-coder-session',
    activeRunId: state === 'running' ? 'run-1' : null,
    startedAt: 'now',
    updatedAt: 'now',
    stoppedAt: null,
    warnings: [],
    error: null,
  };
}

function client(overrides: Partial<CoderTerminalClient> = {}): CoderTerminalClient {
  return {
    startSession: vi.fn(async () => ({ ok: true as const, session: session(), transcript: [] })),
    listSessions: vi.fn(async () => []),
    getSession: vi.fn(async () => null),
    sendInput: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    stopSession: vi.fn(async () => true),
    streamUrl: (id) => `/api/coder/hermes/coder-terminal/sessions/${id}/stream`,
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
  it('automatically acquires the saved Coder session with server-owned identity', async () => {
    const terminalClient = client();
    await render(
      <CoderTerminalPanel
        open
        targetRoot="C:/Projects/LiquidAIty/main"
        client={terminalClient}
        {...identityProps}
      />,
    );
    await act(async () => undefined);
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

  it('does not expose the removed shell, root, transport, or manual-start controls', async () => {
    await render(
      <CoderTerminalPanel
        open
        client={client()}
        initialSession={session()}
        initialTranscript={[]}
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
            transcript: [{ seq: 1, stream: 'pty' as const, data: `${failed.error}\r\n`, at: 'now' }],
          })),
        })}
        {...identityProps}
      />,
    );
    await act(async () => undefined);
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')?.textContent).toBe(
      'hermes_acp_rpc_error:native_startup_failed\r\n',
    );
    expect(host?.textContent).not.toContain('console_start_failed_502');
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).not.toBeNull();
  });
});
