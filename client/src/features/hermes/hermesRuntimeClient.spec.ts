// Entity: Saved Cards
// Relationship: Verifies snapshot calculation and event-triggered refresh against mocked Hermes active-session, subagent, and usage responses.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  onEvent: vi.fn(),
  request: vi.fn(),
}));

vi.mock('./hermesHost', () => ({
  hermesRequest: host.request,
  onHermesEvent: host.onEvent,
}));

import {
  readHermesRuntimeSnapshot,
  subscribeHermesRuntime,
} from './hermesRuntimeClient';

describe('Hermes Card runtime projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    host.handlers.clear();
    host.onEvent.mockImplementation(async (
      _profile: string,
      eventName: string,
      handler: () => void,
    ) => {
      host.handlers.set(eventName, handler);
      return vi.fn();
    });
    host.request.mockImplementation(async (_profile: string, method: string) => {
      if (method === 'session.active_list') {
        return {
          sessions: [
            {
              current: true,
              id: 'session-main',
              last_active: 200,
              message_count: 4,
              model: 'gpt-6.1-sol',
              preview: 'working',
              session_key: 'session-main',
              started_at: 100,
              status: 'streaming',
              title: 'Trading',
            },
            {
              current: false,
              id: 'session-old',
              last_active: 50,
              message_count: 2,
              model: 'gpt-6-luna',
              preview: 'idle',
              session_key: 'session-old',
              started_at: 10,
              status: 'idle',
              title: 'Old',
            },
          ],
        };
      }
      if (method === 'subagent.roster') {
        return { sessions: [{ session_id: 'session-main', subagents: 2, background: 0 }] };
      }
      if (method === 'session.stats') {
        return {
          total_tokens: 321,
          avg_latency_s: 1.25,
          active_subagents: 2,
          model: 'gpt-6.1-sol',
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
  });

  it('derives the glow, live model count, tokens, model, and latency from Hermes', async () => {
    await expect(readHermesRuntimeSnapshot('main')).resolves.toEqual({
      available: true,
      sessionId: 'session-main',
      running: true,
      activeModelCount: 3,
      model: 'gpt-6.1-sol',
      totalTokens: 321,
      averageLatencyMs: 1_250,
      lastActiveAt: 200,
    });
    expect(host.request).toHaveBeenCalledWith('main', 'session.stats', { session_id: 'session-main' });
    expect(host.request.mock.calls.map(([, method]) => method)).toEqual([
      'session.active_list', 'subagent.roster', 'session.stats',
    ]);
  });

  it('leaves missing statistics unknown instead of claiming zero or resuming the session', async () => {
    const request = host.request.getMockImplementation()!;
    host.request.mockImplementation((profile: string, method: string) => method === 'session.stats'
      ? Promise.reject(new Error('not_found')) : request(profile, method));
    await expect(readHermesRuntimeSnapshot('main')).resolves.toMatchObject({
      model: 'gpt-6.1-sol', totalTokens: null, averageLatencyMs: null,
    });
    expect(host.request.mock.calls.map(([, method]) => method)).toEqual([
      'session.active_list', 'subagent.roster', 'session.stats',
    ]);
  });

  it('refreshes from Hermes events instead of polling or maintaining another ledger', async () => {
    vi.useFakeTimers();
    const onSnapshot = vi.fn();
    const stop = await subscribeHermesRuntime('main', onSnapshot);
    await vi.runAllTimersAsync();
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    host.handlers.get('message.complete')?.();
    await vi.runAllTimersAsync();
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    stop();
    vi.useRealTimers();
  });
});
