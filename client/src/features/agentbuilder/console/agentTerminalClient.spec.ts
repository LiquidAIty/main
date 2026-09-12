// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentTerminalClient } from './agentTerminalClient';

const identity = { projectId: 'project / one', deckId: 'deck builder', cardId: 'card/one' };

class MockEventSource {
  static instance: MockEventSource | null = null;
  readonly listeners = new Map<string, (event: Event) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string, readonly options: EventSourceInit) { MockEventSource.instance = this; }
  addEventListener(name: string, listener: (event: Event) => void) { this.listeners.set(name, listener); }
  close() { this.closed = true; }
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); MockEventSource.instance = null; });

describe('agent terminal HTTP and event contract', () => {
  it('opens with only dimensions and streams the saved session with bounded replay', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      sessionId: 'session-1', cardId: identity.cardId, profile: 'agent-cli-proof', pid: 1, ptyId: 'pty-1',
      status: 'running', cols: 100, rows: 30,
    }) }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('EventSource', MockEventSource);
    const opened = await agentTerminalClient.open(identity, { cols: 100, rows: 30 });
    expect(opened.sessionId).toBe('session-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/agent-terminals/project%20%2F%20one/deck%20builder/card%2Fone/open',
      expect.objectContaining({ credentials: 'include', body: JSON.stringify({ cols: 100, rows: 30 }) }),
    );
    const onOutput = vi.fn();
    const onState = vi.fn();
    const stream = agentTerminalClient.stream(identity, opened.sessionId, 4, {
      onOutput, onState, onTransportError: vi.fn(),
    });
    expect(MockEventSource.instance?.url).toContain('/session-1/events?after=4');
    expect(MockEventSource.instance?.options).toEqual({ withCredentials: true });
    MockEventSource.instance?.emit('output', { sequence: 5, data: 'native bytes' });
    MockEventSource.instance?.emit('state', { status: 'exited', exitCode: 0 });
    expect(onOutput).toHaveBeenCalledWith({ sequence: 5, data: 'native bytes' });
    expect(onState).toHaveBeenCalledWith({ status: 'exited', exitCode: 0 });
    expect(MockEventSource.instance?.closed).toBe(true);
    stream.close();
    expect(MockEventSource.instance?.closed).toBe(true);
  });
});
