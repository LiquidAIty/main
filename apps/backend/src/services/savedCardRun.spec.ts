import { afterEach, describe, expect, it, vi } from 'vitest';

const { requestPythonRailsJson, readToolCatalog } = vi.hoisted(() => ({
  requestPythonRailsJson: vi.fn(),
  readToolCatalog: vi.fn(),
}));

vi.mock('./pythonRailsClient', () => ({ requestPythonRailsJson }));
vi.mock('./mcp/toolCatalogMcpClient', () => ({ readToolCatalog }));

import {
  failAcceptedSavedCardRun,
  finishSavedCardRun,
  submitHermesTurn,
  recordSavedCardRunSubmissionStarted,
} from './savedCardRun';

const binding = {
  sessionId: 'live-main',
  storedSessionId: 'stored-main',
  info: { provider: 'openai-codex', model: 'binding-model' },
  botModeRoster: [],
  profileCapabilityFingerprint: '0123456789ab',
};

afterEach(() => {
  vi.clearAllMocks();
});


describe('saved Card Run settlement truth', () => {
  it('records running state only from the exact Hermes submission-start identity', async () => {
    requestPythonRailsJson.mockResolvedValue({
      ok: true,
      runId: 'run-one',
      correlationId: 'run-one',
      submissionId: 'run-one',
      state: 'running',
    });

    await recordSavedCardRunSubmissionStarted({
      runId: 'run-one', binding, submissionId: 'run-one',
    });

    expect(requestPythonRailsJson).toHaveBeenCalledWith('/domain/runs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-one',
        correlationId: 'run-one',
        submissionId: 'run-one',
        hermesSessionRef: 'stored-main',
      }),
    });
  });

  it('persists only confirmed binding/event execution fields and measured counters', async () => {
    requestPythonRailsJson.mockImplementation(async (_path: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      return {
        ok: true, runId: payload.runId, state: payload.state,
        runRecord: { state: payload.state },
      };
    });

    await finishSavedCardRun({
      run: {
        runId: 'run-one',
        request: {
          provider: { provider: 'requested-provider', providerModelId: 'requested-model' },
          runtimeOptions: { openaiRuntime: 'requested-api-mode' },
        },
      },
      binding,
      result: {
        text: 'Actual answer.',
        toolCalls: 0,
        event: {
          type: 'message.complete',
          session_id: 'live-main',
          payload: {
            status: 'complete',
            usage: { model: 'cumulative-model', input: 999, output: 999 },
            turn_usage: {
              model: 'event-model', input: 10, output: 4, total: 14,
              cache_read: 2, reasoning: 1, cost_usd: 0.02, cost_status: 'estimated',
            },
          },
        },
      },
    });

    const payload = JSON.parse(String(requestPythonRailsJson.mock.calls[0][1].body));
    expect(payload).toMatchObject({
      runId: 'run-one',
      state: 'completed',
      finalResult: 'Actual answer.',
      providerTurnRef: 'run-one',
      provider: 'openai-codex',
      effectiveProvider: 'openai-codex',
      providerApiMode: 'codex_app_server',
      model: 'event-model',
      toolCallCount: 0,
      providerInputTokens: 10,
      providerOutputTokens: 4,
      providerCachedTokens: 2,
      providerReasoningTokens: 1,
      providerTotalTokens: 14,
      totalCostUsd: 0.02,
      costStatus: 'estimated',
    });
    expect(JSON.stringify(payload)).not.toContain('requested-provider');
    expect(JSON.stringify(payload)).not.toContain('requested-model');
    expect(JSON.stringify(payload)).not.toContain('requested-api-mode');
  });

  it('preserves exact preparation and cancellation causes without tool-count fabrication', async () => {
    requestPythonRailsJson.mockImplementation(async (_path: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      return {
        ok: true, runId: payload.runId, state: payload.state,
        runRecord: { state: payload.state },
      };
    });

    await failAcceptedSavedCardRun('run-preparation', new Error('card_revision_changed'));
    await failAcceptedSavedCardRun('run-cancelled', new Error('saved_specialist_cancelled'));

    const preparation = JSON.parse(String(requestPythonRailsJson.mock.calls[0][1].body));
    const cancellation = JSON.parse(String(requestPythonRailsJson.mock.calls[1][1].body));
    expect(preparation).toMatchObject({
      runId: 'run-preparation', state: 'failed', errorCode: 'card_revision_changed',
    });
    expect(cancellation).toMatchObject({
      runId: 'run-cancelled', state: 'cancelled', errorCode: 'saved_specialist_cancelled',
    });
    expect(preparation).not.toHaveProperty('toolCallCount');
    expect(cancellation).not.toHaveProperty('toolCallCount');
  });

  it('surfaces settlement transport failure as its own cause', async () => {
    requestPythonRailsJson.mockRejectedValue(new Error('python_rails_unavailable'));

    await expect(finishSavedCardRun({
      run: { runId: 'run-one', request: {} },
      binding,
      result: {
        text: 'Actual answer.',
        toolCalls: 0,
        event: { type: 'message.complete', payload: { status: 'complete' } },
      },
    })).rejects.toThrow('saved_card_settlement_failed:python_rails_unavailable');
  });

  it('applies and reads back the exact prepared model before prompt submission', async () => {
    const eventListeners: Array<(event: any) => void> = [];
    const requests: Array<[string, Record<string, unknown>]> = [];
    requestPythonRailsJson.mockResolvedValue({
      ok: true, runId: 'run-one', correlationId: 'run-one',
      submissionId: 'run-one', state: 'running',
    });
    const localBinding = {
      ...binding,
      info: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
    };
    const client = {
      onEvent: (listener: (event: any) => void) => {
        eventListeners.push(listener);
        return () => undefined;
      },
      onState: () => () => undefined,
      request: vi.fn(async (method: string, params: Record<string, unknown>) => {
        requests.push([method, params]);
        if (method === 'config.set') return {
          key: 'model', value: 'gpt-5.6-sol', scope: 'session',
          deferred: false, confirm_required: false,
        };
        if (method === 'session.activate') return {
          session_id: 'live-main', stored_session_id: 'stored-main', messages_omitted: true,
          info: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
        };
        queueMicrotask(() => {
          eventListeners.forEach((listener) => listener({
            type: 'prompt.submission.started', session_id: 'live-main',
            payload: { submission_id: 'run-one' },
          }));
          eventListeners.forEach((listener) => listener({
            type: 'message.complete', session_id: 'live-main',
            payload: { submission_id: 'run-one', status: 'complete', text: 'done',
              turn_usage: { model: 'gpt-5.6-sol', total: 1, calls: 1 } },
          }));
        });
        return { status: 'streaming' };
      }),
    } as any;

    await submitHermesTurn({
      client,
      binding: localBinding,
      profile: 'main',
      runRequest: {
        provider: { providerModelId: 'gpt-5.6-sol' },
        runtimeOptions: { autoModel: true },
      },
      text: 'task', submissionId: 'run-one', dynamicTools: [],
      toolEndpoint: 'http://tools', toolAuthorization: 'token', onEvent: () => undefined,
    });

    expect(requests.map(([method]) => method)).toEqual([
      'config.set', 'session.activate', 'prompt.submit',
    ]);
    expect(requests[0][1]).toMatchObject({
      profile: 'main', session_id: 'live-main', key: 'model', scope: 'session',
      value: 'gpt-5.6-sol --provider openai-codex --session',
      confirm_expensive_model: false,
    });
    expect(requests[1][1]).toMatchObject({
      profile: 'main', session_id: 'live-main', omit_messages: true, bot_mode_roster: [],
    });
  });
});
