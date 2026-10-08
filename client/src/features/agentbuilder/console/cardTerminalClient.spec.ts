// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardTerminalClient } from './cardTerminalClient';

const identity = {
  projectId: 'project / one',
  deckId: 'deck builder',
  cardId: 'builder',
  conversationId: 'conversation-1',
};

class MockWebSocket {
  static instance: MockWebSocket | null = null;
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  binaryType = '';
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) { MockWebSocket.instance = this; }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  MockWebSocket.instance = null;
});

describe('Builder terminal HTTP and WebSocket contract', () => {
  it('opens the exact saved Builder conversation and attaches to Hermes PTY bytes', async () => {
    const websocketUrl = 'ws://127.0.0.1:9119/api/pty?ticket=one-time-ticket';
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      storedSessionId: 'session-1', cardId: identity.cardId, profile: 'builder',
      attachIdentity: 'attach-1', cols: 100, rows: 30, websocketUrl,
    }) }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('WebSocket', MockWebSocket);

    const opened = await cardTerminalClient.open(identity, { cols: 100, rows: 30 });
    expect(opened.storedSessionId).toBe('session-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/card-terminals/project%20%2F%20one/deck%20builder/builder/open',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({ cols: 100, rows: 30, conversationId: 'conversation-1' }),
      }),
    );

    const onOutput = vi.fn();
    const onState = vi.fn();
    const stream = cardTerminalClient.stream(opened, {
      onOutput, onState, onTransportError: vi.fn(),
    });
    expect(MockWebSocket.instance?.url).toBe(websocketUrl);
    expect(MockWebSocket.instance?.binaryType).toBe('arraybuffer');

    MockWebSocket.instance?.onopen?.();
    MockWebSocket.instance?.onmessage?.({ data: 'hermes bytes' } as MessageEvent<string>);
    expect(onState).toHaveBeenCalledWith({ state: 'connected' });
    expect(onOutput).toHaveBeenCalledWith({ sequence: 1, data: 'hermes bytes' });

    stream.write('input');
    stream.resize(100, 30);
    expect(MockWebSocket.instance?.sent).toEqual(['input', '\u001b[RESIZE:100;30]']);

    stream.close();
    expect(MockWebSocket.instance?.closed).toBe(true);
  });
});
