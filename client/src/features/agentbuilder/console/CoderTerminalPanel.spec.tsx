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

function session(): ConsoleSessionInfo {
  return {
    id: 'coder-terminal-1',
    targetRoot: 'C:/Projects/main',
    mode: 'interactive',
    state: 'running',
    commandPath: 'hermes chat --cli --toolsets file,terminal,memory',
    runtimeSource: 'hermes_installed',
    transportMode: 'pty',
    provider: null,
    model: null,
    interactiveSupported: true,
    pid: 42,
    startedAt: 'now',
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
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
    resizeSession: vi.fn(async () => true),
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

describe('CoderTerminalPanel', () => {
  it('renders the saved Coder terminal without another agent identity', async () => {
    await render(<CoderTerminalPanel open targetRoot="C:/Projects/main" client={client()} />);
    expect(host?.textContent).toContain('Coder');
    expect(host?.textContent).toContain('C:/Projects/main');
    expect(host?.querySelector('[data-testid="coder-terminal-start"]')).not.toBeNull();
  });

  it('starts one interactive Hermes terminal session', async () => {
    const terminalClient = client();
    await render(
      <CoderTerminalPanel open targetRoot="C:/Projects/main" client={terminalClient} />,
    );
    const start = host?.querySelector('[data-testid="coder-terminal-start"]') as HTMLButtonElement;
    await act(async () => start.click());
    expect(terminalClient.startSession).toHaveBeenCalledWith(expect.objectContaining({
      targetRoot: 'C:/Projects/main',
      mode: 'interactive',
    }));
    expect(host?.querySelector('[data-testid="coder-terminal-status"]')?.textContent).toBe('Running');
  });

  it('uses xterm as the sole transcript surface without duplicate command controls', async () => {
    await render(
      <CoderTerminalPanel
        open
        targetRoot="C:/Projects/main"
        client={client()}
        initialSession={session()}
        initialTranscript={[{ seq: 1, stream: 'system', data: '# Exact IDF', at: 'now' }]}
      />,
    );
    expect(host?.querySelector('[data-testid="coder-terminal-xterm"]')).not.toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-transcript"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-input"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-send"]')).toBeNull();
    expect(host?.querySelector('[data-testid="coder-terminal-stop"]')).not.toBeNull();
  });
});
