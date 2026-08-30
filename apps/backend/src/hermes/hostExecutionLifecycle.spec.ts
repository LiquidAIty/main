import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleMocks = vi.hoisted(() => ({
  create: vi.fn(),
  finish: vi.fn(),
  meta: vi.fn((contextId: string) => ({ 'liquidaity/execution': contextId })),
  monitor: vi.fn(() => true),
}));

vi.mock('./childExecutionContext', () => ({
  createHermesChildExecutionContext: lifecycleMocks.create,
  finishHermesExecutionContext: lifecycleMocks.finish,
  executionToolCallMeta: lifecycleMocks.meta,
}));

vi.mock('./kanbanRunRecovery', () => ({
  startHermesTeamRunMonitor: lifecycleMocks.monitor,
}));

import {
  handleHermesHostExecutionRequest,
  isHermesHostExecutionMethod,
  startHermesHostTeamMonitor,
} from './hostExecutionLifecycle';

describe('shared Hermes host execution lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allocates one native child and returns only its opaque host receipt', async () => {
    const context = {
      contextId: 'child-context-1',
      runId: 'child-run-1',
      nativeChildId: 't_team',
    };
    lifecycleMocks.create.mockResolvedValueOnce(context);

    await expect(handleHermesHostExecutionRequest({
      method: 'session/create_execution_context',
      params: {
        sessionId: 'session-1',
        parentExecutionContextId: 'parent-context-1',
        nativeChildId: 't_team',
        provider: 'openai-codex',
        model: 'gpt-5.6-terra',
      },
    })).resolves.toEqual({
      result: {
        executionContextId: 'child-context-1',
        runId: 'child-run-1',
        toolCallMeta: { 'liquidaity/execution': 'child-context-1' },
      },
      nativeContext: context,
    });
    expect(lifecycleMocks.create).toHaveBeenCalledTimes(1);
  });

  it('closes through the same owner and starts the existing Team monitor', async () => {
    lifecycleMocks.finish.mockResolvedValueOnce(true);
    await expect(handleHermesHostExecutionRequest({
      method: 'session/finish_execution_context',
      params: { executionContextId: 'child-context-1', state: 'completed' },
    })).resolves.toEqual({ result: { closed: true } });

    const context = { contextId: 'child-context-1' } as any;
    const appendTeamResult = vi.fn(async () => undefined);
    expect(startHermesHostTeamMonitor({ context, appendTeamResult })).toBe(true);
    expect(lifecycleMocks.monitor).toHaveBeenCalledWith(
      context,
      appendTeamResult,
      {},
    );
  });

  it('recognizes only the two native host lifecycle methods', () => {
    expect(isHermesHostExecutionMethod('session/create_execution_context')).toBe(true);
    expect(isHermesHostExecutionMethod('session/finish_execution_context')).toBe(true);
    expect(isHermesHostExecutionMethod('session/other')).toBe(false);
  });
});
