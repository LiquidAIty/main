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
      mcpServers: [{ type: 'http', name: 'main-runtime', url: 'http://127.0.0.1:4000/mcp' }],
      sessionConfig: { enabledToolsets: ['mcp-main-runtime'], systemPrompt: 'saved prompt' },
      onEvent,
    });
    const candidate = bridge.take();
    expect(candidate).toMatchObject({
      runId: 'run-1',
      executionContextId: 'context-1',
      driverSource: 'internal_chat',
      contextAuthorityMode: 'main_native_honcho',
      message: 'hello',
      mcpServers: [{ type: 'http', name: 'main-runtime', url: 'http://127.0.0.1:4000/mcp' }],
      sessionConfig: { enabledToolsets: ['mcp-main-runtime'], systemPrompt: 'saved prompt' },
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
      projections: [],
    });
    expect(bridge.history()).toEqual({
      sessionId: 'session-1',
      messages: [
        { role: 'user', text: 'question' },
        { role: 'assistant', text: 'answer' },
      ],
      projections: [],
    });
    expect(() => bridge.acceptHistory({
      sessionId: 'session-1',
      messages: [{ role: 'tool', text: 'private tool output' }],
    })).toThrow('main_cli_history_invalid');
  });

  it('delivers each semantic projection ID exactly once without text comparison', async () => {
    const bridge = new MainCliBridge();
    const onEvent = vi.fn();
    bridge.notePoll();
    const done = bridge.submit({
      runId: 'run-projection', executionContextId: 'context-projection',
      driverSource: 'internal_chat', message: 'hello', onEvent,
      projectionIdentity: {
        projectId: 'project-one', deckId: 'deck_builder', cardId: 'card_main_chat',
        cardName: 'Main', runId: 'run-projection',
      },
    });
    const candidate = bridge.take()!;
    const projection = {
      schemaVersion: 'liquidaity.main.projection.v1' as const,
      id: 'tool-1:started',
      category: 'execution.tool' as const,
      sequence: 1,
      timestamp: '2026-08-31T12:00:00.000Z',
      state: 'started',
      toolName: 'main.context',
      operationId: 'tool-1',
    };
    bridge.acceptEvent({ requestId: candidate.requestId, runId: candidate.runId,
      kind: 'projection', projection });
    bridge.acceptEvent({ requestId: candidate.requestId, runId: candidate.runId,
      kind: 'projection', projection: { ...projection, state: 'changed-with-same-id' } });
    bridge.acceptEvent({ requestId: candidate.requestId, runId: candidate.runId,
      kind: 'projection', projection: {
        ...projection, id: 'answer-1', category: 'conversation.answer', sequence: 2,
        text: 'answer text',
      } });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(() => bridge.acceptEvent({ requestId: candidate.requestId, runId: candidate.runId,
      kind: 'projection', projection: { ...projection, id: '', sequence: 2 } }))
      .toThrow('main_cli_projection_invalid');
    bridge.acceptEvent({ requestId: candidate.requestId, runId: candidate.runId,
      kind: 'completed', finalText: 'done', nativeSessionId: 'session-1', nativeTurnId: 'turn-1' });
    await expect(done).resolves.toMatchObject({ finalText: 'done' });
    bridge.acceptHistory({ sessionId: 'session-1', messages: [
      { role: 'user', text: 'hello' }, { role: 'assistant', text: 'answer text' },
    ] });
    expect(bridge.history()?.projections).toHaveLength(1);
    expect(bridge.history()?.projections[0].projection.category).toBe('execution.tool');
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
