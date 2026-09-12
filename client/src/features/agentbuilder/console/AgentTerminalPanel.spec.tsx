// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const terminal = vi.hoisted(() => ({
  onData: null as ((data: string) => void) | null,
  writes: [] as string[],
  dispose: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    constructor(_options: Record<string, unknown>) {}
    loadAddon() {}
    open(_container: HTMLElement) {}
    focus() {}
    write(data: string) { terminal.writes.push(data); }
    dispose() { terminal.dispose(); }
    onData(listener: (data: string) => void) {
      terminal.onData = listener;
      return { dispose: () => undefined };
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

import AgentTerminalPanel from './AgentTerminalPanel';
import type {
  AgentTerminalClient,
  AgentTerminalSession,
} from './agentTerminalClient';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const identity = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_agent_cli' };
const session = (status: AgentTerminalSession['status'] = 'running'): AgentTerminalSession => ({
  sessionId: 'session-1', cardId: identity.cardId, profile: 'agent-cli-proof', pid: 42, ptyId: 'pty-1',
  status, cols: 80, rows: 24,
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  terminal.onData = null;
  terminal.writes.length = 0;
  vi.clearAllMocks();
});

async function render(client: AgentTerminalClient) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<AgentTerminalPanel identity={identity} client={client} />);
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('AgentTerminalPanel', () => {
  it('opens one saved-card session, writes only raw PTY output, and sends native input bytes', async () => {
    let handlers: Parameters<AgentTerminalClient['stream']>[3] | null = null;
    const client: AgentTerminalClient = {
      open: vi.fn(async () => session()),
      stream: vi.fn((_identity, _sessionId, _after, candidate) => {
        handlers = candidate;
        return { close: vi.fn() };
      }),
      input: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      stop: vi.fn(async () => ({})),
    };
    await render(client);

    expect(client.open).toHaveBeenCalledOnce();
    expect(client.open).toHaveBeenCalledWith(identity, { cols: 80, rows: 24 });
    expect(host!.querySelector('[data-testid="agent-terminal-panel"]')?.getAttribute('data-session-id'))
      .toBe('session-1');
    expect(host!.querySelector('[data-testid="agent-terminal-panel"]')?.getAttribute('data-profile'))
      .toBe('agent-cli-proof');
    await act(async () => {
      handlers?.onOutput({ sequence: 1, data: '\u001b[32mnative\u001b[0m\r\n' });
      terminal.onData?.('abc\u007f\r');
      await Promise.resolve();
    });
    expect(terminal.writes).toEqual(['\u001b[32mnative\u001b[0m\r\n']);
    expect(client.input).toHaveBeenCalledWith(identity, 'session-1', 'abc\u007f\r');
  });

  it('keeps the same stream through interruption, stops only the active session, and starts explicitly after exit', async () => {
    let handlers: Parameters<AgentTerminalClient['stream']>[3] | null = null;
    const closed = vi.fn();
    const client: AgentTerminalClient = {
      open: vi.fn(async () => session()),
      stream: vi.fn((_identity, _sessionId, _after, candidate) => {
        handlers = candidate;
        return { close: closed };
      }),
      input: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      stop: vi.fn(async () => ({})),
    };
    await render(client);
    await act(async () => {
      handlers?.onTransportError();
      await Promise.resolve();
    });
    expect(host!.textContent).toContain('Reconnecting…');
    expect(client.stream).toHaveBeenCalledOnce();
    await act(async () => {
      (host!.querySelector('[data-testid="agent-terminal-stop"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(client.stop).toHaveBeenCalledWith(identity, 'session-1');
    await act(async () => {
      handlers?.onState({ status: 'exited', exitCode: 0 });
      await Promise.resolve();
    });
    const start = host!.querySelector('[data-testid="agent-terminal-start"]') as HTMLButtonElement;
    expect(start).toBeTruthy();
    await act(async () => { start.click(); await Promise.resolve(); });
    expect(client.open).toHaveBeenCalledTimes(2);
    await act(async () => root?.unmount());
    expect(closed).toHaveBeenCalled();
  });

  it('shares one in-flight open across React Strict Mode mounting', async () => {
    const pending = deferred<AgentTerminalSession>();
    const client: AgentTerminalClient = {
      open: vi.fn(() => pending.promise),
      stream: vi.fn(() => ({ close: vi.fn() })),
      input: vi.fn(async () => undefined), resize: vi.fn(async () => undefined), stop: vi.fn(async () => ({})),
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<StrictMode><AgentTerminalPanel identity={identity} client={client} /></StrictMode>);
      await Promise.resolve();
    });
    expect(client.open).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(session()); await Promise.resolve(); });
    expect(host.querySelector('[data-session-id="session-1"]')).toBeTruthy();
  });

  it('does not attach an earlier card open or its failure after the saved identity changes', async () => {
    const first = deferred<AgentTerminalSession>();
    const second = deferred<AgentTerminalSession>();
    const nextIdentity = { ...identity, cardId: 'card_second' };
    const client: AgentTerminalClient = {
      open: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      stream: vi.fn(() => ({ close: vi.fn() })),
      input: vi.fn(async () => undefined), resize: vi.fn(async () => undefined), stop: vi.fn(async () => ({})),
    };
    await render(client);
    await act(async () => {
      root?.render(<AgentTerminalPanel identity={nextIdentity} client={client} />);
      await Promise.resolve();
    });
    expect(client.open).toHaveBeenCalledTimes(2);
    await act(async () => { first.reject(new Error('old_card_failure')); await Promise.resolve(); });
    expect(host!.textContent).not.toContain('old_card_failure');
    await act(async () => {
      second.resolve({ ...session(), sessionId: 'session-2', cardId: nextIdentity.cardId });
      await Promise.resolve();
    });
    const panel = host!.querySelector('[data-testid="agent-terminal-panel"]');
    expect(panel?.getAttribute('data-card-id')).toBe(nextIdentity.cardId);
    expect(panel?.getAttribute('data-session-id')).toBe('session-2');
  });

  it('offers an explicit restart after an open fails before a session exists', async () => {
    const client: AgentTerminalClient = {
      open: vi.fn().mockRejectedValueOnce(new Error('open_failed')).mockResolvedValueOnce(session()),
      stream: vi.fn(() => ({ close: vi.fn() })),
      input: vi.fn(async () => undefined), resize: vi.fn(async () => undefined), stop: vi.fn(async () => ({})),
    };
    await render(client);
    await act(async () => { await Promise.resolve(); });
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe('open_failed');
    const start = host!.querySelector('[data-testid="agent-terminal-start"]') as HTMLButtonElement;
    expect(start).toBeTruthy();
    await act(async () => { start.click(); await Promise.resolve(); });
    expect(client.open).toHaveBeenCalledTimes(2);
    expect(host!.querySelector('[data-session-id="session-1"]')).toBeTruthy();
  });
});
