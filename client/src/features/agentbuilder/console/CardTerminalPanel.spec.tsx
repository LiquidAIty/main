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

import CardTerminalPanel from './CardTerminalPanel';
import SharedChatTerminalSplit from './SharedChatTerminalSplit';
import type {
  CardTerminalAttachment,
  CardTerminalClient,
} from './cardTerminalClient';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const identity = {
  projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder', conversationId: 'main',
};
const attachment = (): CardTerminalAttachment => ({
  storedSessionId: 'session-1', cardId: identity.cardId, profile: 'builder',
  attachIdentity: 'attach-1', cols: 80, rows: 24,
  websocketUrl: 'ws://127.0.0.1:9119/api/pty?ticket=builder-ticket',
});

const terminalStream = () => ({ close: vi.fn(), write: vi.fn(), resize: vi.fn() });

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

async function render(client: CardTerminalClient) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<CardTerminalPanel identity={identity} client={client} />);
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

describe('CardTerminalPanel', () => {
  it('attaches the dedicated under-chat Builder presentation to Builder\'s Hermes PTY stream', async () => {
    const builderIdentity = {
      projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder', conversationId: 'main',
    };
    let handlers: Parameters<CardTerminalClient['stream']>[1] | undefined;
    const client: CardTerminalClient = {
      open: vi.fn(async () => ({
        ...attachment(), cardId: 'builder', profile: 'builder', attachIdentity: 'builder-attach',
      })),
      stream: vi.fn((_session, candidate) => {
        handlers = candidate;
        return terminalStream();
      }),
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <SharedChatTerminalSplit
          chat={<div data-testid="main-chat">Main Chat</div>}
          terminal={(
            <div data-testid="under-chat-card-work-surface">
              <CardTerminalPanel
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
    const panel = host.querySelector('[data-testid="card-terminal-panel"]');
    expect(panel?.getAttribute('data-card-id')).toBe('builder');
    expect(panel?.getAttribute('data-profile')).toBe('builder');
    await act(async () => {
      handlers?.onOutput({ sequence: 1, data: '\u001b[36mbuilder Hermes tui\u001b[0m\r\n' });
      await Promise.resolve();
    });
    expect(terminal.writes).toEqual(['\u001b[36mbuilder Hermes tui\u001b[0m\r\n']);
    expect(panel?.getAttribute('data-status')).toBe('opening');
    expect(host!.querySelector('[data-testid="under-chat-card-work-surface"]')).not.toBeNull();
    expect(host!.querySelector('[data-testid="main-chat"]')).not.toBeNull();
  });

  it('opens one saved Builder session and writes only its raw PTY output to xterm', async () => {
    let handlers: Parameters<CardTerminalClient['stream']>[1] | undefined;
    const client: CardTerminalClient = {
      open: vi.fn(async () => attachment()),
      stream: vi.fn((_session, candidate) => {
        handlers = candidate;
        return terminalStream();
      }),
    };
    await render(client);

    expect(client.open).toHaveBeenCalledOnce();
    expect(client.open).toHaveBeenCalledWith(identity, { cols: 80, rows: 24 });
    expect(terminal.options).toMatchObject({ scrollback: 5_000 });
    expect(terminal.options).not.toHaveProperty('disableStdin');
    expect(host!.querySelector('[data-testid="card-terminal-panel"]')?.getAttribute('data-stored-session-id'))
      .toBe('session-1');
    expect(host!.querySelector('[data-testid="card-terminal-panel"]')?.getAttribute('data-profile'))
      .toBe('builder');
    await act(async () => {
      handlers?.onOutput({ sequence: 1, data: '\u001b[32mHermes\u001b[0m\r\n' });
      await Promise.resolve();
    });
    expect(terminal.writes).toEqual(['\u001b[32mHermes\u001b[0m\r\n']);
    expect(host!.querySelector('[data-testid="card-terminal-start"]')).toBeNull();
    expect(host!.querySelector('[data-testid="card-terminal-stop"]')).toBeNull();
  });

  it('keeps one attachment while real socket state changes', async () => {
    let handlers: Parameters<CardTerminalClient['stream']>[1] | undefined;
    const closed = vi.fn();
    const client: CardTerminalClient = {
      open: vi.fn(async () => attachment()),
      stream: vi.fn((_attachment, candidate) => {
        handlers = candidate;
        return { close: closed, write: vi.fn(), resize: vi.fn() };
      }),
    };
    await render(client);
    await act(async () => {
      handlers?.onState({ state: 'connected' });
      await Promise.resolve();
    });
    expect(host!.querySelector('[data-testid="card-terminal-panel"]')?.getAttribute('data-status'))
      .toBe('connected');
    expect(client.stream).toHaveBeenCalledOnce();
    await act(async () => {
      handlers?.onState({ state: 'exited', closeCode: 1000 });
      await Promise.resolve();
    });
    expect(client.open).toHaveBeenCalledOnce();
    expect(client.stream).toHaveBeenCalledOnce();
    expect(host!.querySelector('[data-testid="card-terminal-panel"]')?.getAttribute('data-status'))
      .toBe('exited');
    await act(async () => root?.unmount());
    expect(closed).toHaveBeenCalled();
  });

  it('shares one in-flight open across React Strict Mode mounting', async () => {
    const pending = deferred<CardTerminalAttachment>();
    const client: CardTerminalClient = {
      open: vi.fn(() => pending.promise),
      stream: vi.fn(terminalStream),
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<StrictMode><CardTerminalPanel identity={identity} client={client} /></StrictMode>);
      await Promise.resolve();
    });
    expect(client.open).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(attachment()); await Promise.resolve(); });
    expect(host.querySelector('[data-stored-session-id="session-1"]')).toBeTruthy();
  });

  it('does not attach an earlier Card open or its failure after the saved identity changes', async () => {
    const first = deferred<CardTerminalAttachment>();
    const second = deferred<CardTerminalAttachment>();
    const nextIdentity = { ...identity, cardId: 'card_second' };
    const client: CardTerminalClient = {
      open: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      stream: vi.fn(terminalStream),
    };
    await render(client);
    await act(async () => {
      root?.render(<CardTerminalPanel identity={nextIdentity} client={client} />);
      await Promise.resolve();
    });
    expect(client.open).toHaveBeenCalledTimes(2);
    await act(async () => { first.reject(new Error('old_card_failure')); await Promise.resolve(); });
    expect(host!.textContent).not.toContain('old_card_failure');
    await act(async () => {
      second.resolve({ ...attachment(), storedSessionId: 'session-2', cardId: nextIdentity.cardId });
      await Promise.resolve();
    });
    const panel = host!.querySelector('[data-testid="card-terminal-panel"]');
    expect(panel?.getAttribute('data-card-id')).toBe(nextIdentity.cardId);
    expect(panel?.getAttribute('data-stored-session-id')).toBe('session-2');
  });

  it('surfaces an automatic-open failure without exposing a manual connection workflow', async () => {
    const client: CardTerminalClient = {
      open: vi.fn().mockRejectedValueOnce(new Error('open_failed')),
      stream: vi.fn(terminalStream),
    };
    await render(client);
    await act(async () => { await Promise.resolve(); });
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe('open_failed');
    expect(client.open).toHaveBeenCalledOnce();
    expect(host!.querySelector('[data-testid="card-terminal-start"]')).toBeNull();
    expect(host!.querySelector('[data-testid="card-terminal-stop"]')).toBeNull();
  });
});
