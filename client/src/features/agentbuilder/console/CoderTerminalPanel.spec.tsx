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
    default: () => react.createElement('div', { 'data-testid': 'coder-terminal-xterm' }),
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function session(state: ConsoleSessionInfo['state'] = 'ready'): ConsoleSessionInfo {
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
    transportMode: 'acp-stdio',
    profile: 'coder',
    provider: 'openai',
    model: 'gpt-5.6-luna',
    interactiveSupported: true,
    pid: 42,
    nativeSessionId: 'native-coder-session',
    activeRunId: state === 'working' ? 'run-1' : null,
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
    sendInput: vi.fn(async () => true),
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
    expect(host?.querySelector('[data-testid="coder-terminal-status"]')?.textContent).toBe('Ready');
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')).not.toBeNull();
  });

  it('does not expose the removed shell, root, transport, or manual-start controls', async () => {
    await render(
      <CoderTerminalPanel
        open
        client={client()}
        initialSession={session()}
        initialTranscript={[{ seq: 1, stream: 'system', data: 'Coder ready.\r\n› ', at: 'now' }]}
        {...identityProps}
      />,
    );
    expect(host?.textContent).toContain('Coder');
    expect(host?.textContent).not.toContain('Local process');
    expect(host?.textContent).not.toContain('transport:');
    expect(host?.textContent).not.toContain('root:');
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-transcript"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-input"]')).toBeNull();
  });

  it('shows Stop only while a real Hermes turn is active', async () => {
    await render(
      <CoderTerminalPanel open client={client()} initialSession={session('working')} {...identityProps} />,
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
});
