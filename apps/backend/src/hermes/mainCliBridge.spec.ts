import { describe, expect, it, vi } from 'vitest';

import { MainCliBridge } from './mainCliBridge';

describe('MainCliBridge', () => {
  it('delivers one remote driver turn and completes only from matching structured events', async () => {
    const bridge = new MainCliBridge();
    const onEvent = vi.fn();
    bridge.notePoll();

    const done = bridge.submit({
      runId: 'run-1',
      executionContextId: 'context-1',
      driverSource: 'internal_chat',
      message: 'hello',
      onEvent,
    });
    const candidate = bridge.take();
    expect(candidate).toMatchObject({
      runId: 'run-1',
      executionContextId: 'context-1',
      driverSource: 'internal_chat',
      contextAuthorityMode: 'main_native_honcho',
      message: 'hello',
    });
    expect(bridge.take()).toBeNull();
    expect(() => bridge.acceptEvent({
      requestId: candidate!.requestId,
      runId: 'wrong-run',
      kind: 'completed',
    })).toThrow('main_cli_bridge_event_identity_mismatch');

    bridge.acceptEvent({
      requestId: candidate!.requestId,
      runId: 'run-1',
      kind: 'text',
      delta: 'answer',
    });
    bridge.acceptEvent({
      requestId: candidate!.requestId,
      runId: 'run-1',
      kind: 'completed',
      finalText: 'answer',
      nativeSessionId: 'session-1',
      nativeTurnId: 'turn-1',
      contextAuthorityMode: 'main_native_honcho',
    });

    await expect(done).resolves.toEqual({
      finalText: 'answer',
      nativeSessionId: 'session-1',
      nativeTurnId: 'turn-1',
      contextAuthorityMode: 'main_native_honcho',
    });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(bridge.status()).toMatchObject({ activeDriver: null, runId: null });
  });

  it('allows exactly one active driver and authorizes Stop by exact Run identity', async () => {
    const bridge = new MainCliBridge();
    bridge.notePoll();
    const first = bridge.submit({
      runId: 'run-external',
      executionContextId: 'context-external',
      driverSource: 'external_plugin',
      message: 'external message',
      onEvent: vi.fn(),
    });
    expect(bridge.status()).toMatchObject({
      activeDriver: 'external_plugin',
      activeContextAuthorityMode: 'plugin_context_only',
      runId: 'run-external',
    });
    expect(bridge.requestCancel('wrong-run')).toBe(false);
    expect(bridge.requestCancel('run-external')).toBe(true);
    expect(() => bridge.submit({
      runId: 'run-internal',
      executionContextId: 'context-internal',
      driverSource: 'internal_chat',
      message: 'internal message',
      onEvent: vi.fn(),
    })).toThrow('main_driver_turn_already_running');

    const candidate = bridge.take()!;
    bridge.acceptEvent({
      requestId: candidate.requestId,
      runId: candidate.runId,
      kind: 'failed',
      error: 'main_cli_turn_cancelled',
    });
    await expect(first).rejects.toThrow('main_cli_turn_cancelled');
  });

  it('fails closed while the native plugin poller is unavailable', () => {
    const bridge = new MainCliBridge();
    expect(bridge.ready()).toBe(false);
    expect(() => bridge.submit({
      runId: 'run-1',
      executionContextId: 'context-1',
      driverSource: 'internal_chat',
      message: 'hello',
      onEvent: vi.fn(),
    })).toThrow('main_cli_bridge_unavailable');
  });

  it('retains only a bounded typed projection of the live CLI history', () => {
    const bridge = new MainCliBridge();
    bridge.acceptHistory({
      sessionId: 'session-1',
      messages: [
        { role: 'user', text: 'question' },
        { role: 'assistant', text: 'answer' },
      ],
    });
    expect(bridge.history()).toEqual({
      sessionId: 'session-1',
      messages: [
        { role: 'user', text: 'question' },
        { role: 'assistant', text: 'answer' },
      ],
    });
    expect(() => bridge.acceptHistory({
      sessionId: 'session-1',
      messages: [{ role: 'tool', text: 'private tool output' }],
    })).toThrow('main_cli_history_invalid');
  });

  it('delivers one native Team result with exact task idempotence and visible retry', async () => {
    const bridge = new MainCliBridge();
    const first = bridge.queueTeamResult({
      sessionId: 'session-1',
      taskId: 't_team',
      result: 'reviewed result',
      state: 'completed',
    }, 5_000);
    expect(bridge.queueTeamResult({
      sessionId: 'session-1',
      taskId: 't_team',
      result: 'reviewed result',
      state: 'completed',
    }, 5_000)).toBe(first);
    const delivery = bridge.takeTeamResult();
    expect(delivery).toMatchObject({
      sessionId: 'session-1',
      taskId: 't_team',
      result: 'reviewed result',
      state: 'completed',
    });
    expect(bridge.takeTeamResult()).toBeNull();
    bridge.acknowledgeTeamResult({
      deliveryId: delivery!.deliveryId,
      delivered: false,
      retry: true,
    });
    await expect(first).rejects.toThrow('hermes_team_session_turn_in_progress');

    const retry = bridge.queueTeamResult({
      sessionId: 'session-1',
      taskId: 't_team',
      result: 'reviewed result',
      state: 'completed',
    }, 5_000);
    const retriedDelivery = bridge.takeTeamResult()!;
    bridge.acknowledgeTeamResult({
      deliveryId: retriedDelivery.deliveryId,
      delivered: true,
    });
    await expect(retry).resolves.toBeUndefined();
  });
});
