// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const terminal = vi.hoisted(() => ({
  onData: null as ((data: string) => void) | null,
  options: null as Record<string, unknown> | null,
  writes: [] as string[],
  dispose: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    constructor(options: Record<string, unknown>) { terminal.options = options; }
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
import HarnessChatPanel from './HarnessChatPanel';
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
  terminal.options = null;
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
  it('attaches the dedicated under-chat Builder presentation to Builder\'s native PTY stream', async () => {
    const builderIdentity = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder' };
    let handlers: Parameters<AgentTerminalClient['stream']>[3] | null = null;
    const client: AgentTerminalClient = {
      open: vi.fn(async () => ({
        ...session(), cardId: 'builder', profile: 'builder', pid: 4242, ptyId: 'builder-native-pty',
      })),
      stream: vi.fn((_identity, _sessionId, _after, candidate) => {
        handlers = candidate;
        return { close: vi.fn() };
      }),
      resize: vi.fn(async () => undefined),
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <HarnessChatPanel
          chat={<div data-testid="main-chat">Main Chat</div>}
          terminal={(
            <div data-testid="under-chat-card-work-surface">
              <AgentTerminalPanel
                identity={builderIdentity}
                client={client}
              />
            </div>
          )}
        />,
      );
      await Promise.resolve();
    });
    expect(client.open).toHaveBeenCalledOnce();
    expect(client.open).toHaveBeenCalledWith(builderIdentity, { cols: 80, rows: 24 });
    const panel = host.querySelector('[data-testid="agent-terminal-panel"]');
    expect(panel?.getAttribute('data-card-id')).toBe('builder');
    expect(panel?.getAttribute('data-profile')).toBe('builder');
    await act(async () => {
      handlers?.onOutput({ sequence: 1, data: '\u001b[36mbuilder native tui\u001b[0m\r\n' });
      await Promise.resolve();
    });
    expect(terminal.writes).toEqual(['\u001b[36mbuilder native tui\u001b[0m\r\n']);
    expect(panel?.getAttribute('data-status')).toBe('running');
    expect(host!.querySelector('[data-testid="under-chat-card-work-surface"]')).not.toBeNull();
    expect(host!.querySelector('[data-testid="main-chat"]')).not.toBeNull();
  });

  it('opens one saved-card session and writes only its raw PTY output to xterm', async () => {
    let handlers: Parameters<AgentTerminalClient['stream']>[3] | null = null;
    const client: AgentTerminalClient = {
      open: vi.fn(async () => session()),
      stream: vi.fn((_identity, _sessionId, _after, candidate) => {
        handlers = candidate;
        return { close: vi.fn() };
      }),
      resize: vi.fn(async () => undefined),
    };
    await render(client);

    expect(client.open).toHaveBeenCalledOnce();
    expect(client.open).toHaveBeenCalledWith(identity, { cols: 80, rows: 24 });
    expect(terminal.options).toMatchObject({ scrollback: 5_000 });
    expect(terminal.options).not.toHaveProperty('disableStdin');
    expect(host!.querySelector('[data-testid="agent-terminal-panel"]')?.getAttribute('data-session-id'))
      .toBe('session-1');
    expect(host!.querySelector('[data-testid="agent-terminal-panel"]')?.getAttribute('data-profile'))
      .toBe('agent-cli-proof');
    await act(async () => {
      handlers?.onOutput({ sequence: 1, data: '\u001b[32mnative\u001b[0m\r\n' });
      await Promise.resolve();
    });
    expect(terminal.writes).toEqual(['\u001b[32mnative\u001b[0m\r\n']);
    expect(host!.querySelector('[data-testid="agent-terminal-start"]')).toBeNull();
    expect(host!.querySelector('[data-testid="agent-terminal-stop"]')).toBeNull();
  });

  it('keeps the same stream through interruption and automatically rebinds a missing TUI', async () => {
    let handlers: Parameters<AgentTerminalClient['stream']>[3] | null = null;
    const closed = vi.fn();
    const client: AgentTerminalClient = {
      open: vi.fn(async () => session()),
      stream: vi.fn((_identity, _sessionId, _after, candidate) => {
        handlers = candidate;
        return { close: closed };
      }),
      resize: vi.fn(async () => undefined),
    };
    await render(client);
    await act(async () => {
      handlers?.onTransportError();
      await Promise.resolve();
    });
    expect(host!.textContent).not.toContain('Reconnecting…');
    expect(client.stream).toHaveBeenCalledOnce();
    await act(async () => {
      handlers?.onState({ status: 'running', ptyId: null, exitCode: 0 });
      await Promise.resolve();
    });
    expect(client.open).toHaveBeenCalledTimes(2);
    expect(host!.querySelector('[data-testid="agent-terminal-start"]')).toBeNull();
    expect(host!.querySelector('[data-testid="agent-terminal-stop"]')).toBeNull();
    await act(async () => root?.unmount());
    expect(closed).toHaveBeenCalled();
  });

  it('shares one in-flight open across React Strict Mode mounting', async () => {
    const pending = deferred<AgentTerminalSession>();
    const client: AgentTerminalClient = {
      open: vi.fn(() => pending.promise),
      stream: vi.fn(() => ({ close: vi.fn() })),
      resize: vi.fn(async () => undefined),
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
      resize: vi.fn(async () => undefined),
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

  it('surfaces an automatic-open failure without exposing a manual connection workflow', async () => {
    const client: AgentTerminalClient = {
      open: vi.fn().mockRejectedValueOnce(new Error('open_failed')),
      stream: vi.fn(() => ({ close: vi.fn() })),
      resize: vi.fn(async () => undefined),
    };
    await render(client);
    await act(async () => { await Promise.resolve(); });
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe('open_failed');
    expect(client.open).toHaveBeenCalledOnce();
    expect(host!.querySelector('[data-testid="agent-terminal-start"]')).toBeNull();
    expect(host!.querySelector('[data-testid="agent-terminal-stop"]')).toBeNull();
  });
});
