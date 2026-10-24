import { describe, expect, it, vi } from 'vitest';

import type { CardRuntimeClient, CardRuntimeEvent } from '../services/cardRuntimeGateway';
import { executeMainTurn, type MainTurnResult } from './mainTurn';

class FakeClient implements CardRuntimeClient {
  connectionState = 'open';
  requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  handlers = new Set<(event: CardRuntimeEvent) => void>();
  stateHandlers = new Set<(state: string) => void>();
  connect = vi.fn(async () => undefined);
  close = vi.fn();
  onRequest = vi.fn(() => () => undefined);
  onEvent(handler: (event: CardRuntimeEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  onState(handler: (state: string) => void) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }
  emit(event: CardRuntimeEvent) {
    for (const handler of this.handlers) handler(event);
  }
  async request<T>(_method: string, _params: Record<string, unknown> = {}): Promise<T> {
    throw new Error('not implemented');
  }
}

const binding = {
  sessionId: 'stored-main',
  liveHandle: 'live-main',
  info: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
};

async function run(client: FakeClient, extra: Record<string, unknown> = {}): Promise<MainTurnResult> {
  return executeMainTurn({
    client,
    binding,
    profile: 'main',
    text: 'hello',
    runId: 'run-one',
    onAdmitted: async () => undefined,
    onEvent: () => undefined,
    ...extra,
  });
}

describe('Main Card turn transport', () => {
  it('submits only the standard prompt fields and returns direct completion', async () => {
    const client = new FakeClient();
    client.request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      client.requests.push({ method, params });
      if (method === 'session.status') return { running: false };
      if (method === 'prompt.submit') {
        queueMicrotask(() => {
          client.emit({ type: 'message.start', session_id: 'live-main', payload: {} });
          client.emit({ type: 'message.delta', session_id: 'live-main', payload: { text: 'Answer' } });
          client.emit({
            type: 'message.complete', session_id: 'live-main',
            payload: { text: 'Answer', status: 'complete', persisted_turn: { submission_id: 'turn-one' } },
          });
        });
        return { status: 'streaming' };
      }
      throw new Error(`unexpected:${method}`);
    }) as CardRuntimeClient['request'];
    const result = await run(client);
    expect(result.text).toBe('Answer');
    expect(result.providerTurnRef).toBe('turn-one');
    expect(client.requests.find((item) => item.method === 'prompt.submit')?.params).toEqual({
      session_id: 'live-main', profile: 'main', text: 'hello',
    });
  });

  it('finishes only on the canonical completion of the submitted Main turn', async () => {
    const client = new FakeClient();
    client.request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      client.requests.push({ method, params });
      if (method === 'session.status') return { running: false };
      if (method === 'prompt.submit') {
        queueMicrotask(() => {
          client.emit({ type: 'message.start', session_id: 'live-main', payload: {} });
          client.emit({
            type: 'tool.complete', session_id: 'live-main',
            payload: {
              name: 'message_agent',
              result: JSON.stringify({ status: 'queued', reply_delivery: 'poll' }),
            },
          });
          client.emit({ type: 'message.delta', session_id: 'live-main', payload: { text: 'Result' } });
          client.emit({
            type: 'message.complete', session_id: 'live-main',
            payload: { text: 'Result', status: 'complete' },
          });
        });
        return { status: 'streaming' };
      }
      throw new Error(`unexpected:${method}`);
    }) as CardRuntimeClient['request'];
    const result = await run(client);
    expect(result.text).toBe('Result');
  });
});
