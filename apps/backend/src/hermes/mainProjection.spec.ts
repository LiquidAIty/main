import { describe, expect, it } from 'vitest';

import { projectMainRuntimeEvent } from './mainProjection';

const identity = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  cardId: 'card_main_chat',
  cardName: 'Main Chat',
  runId: 'run-1',
};

function projection(overrides: Record<string, unknown>) {
  return {
    schemaVersion: 'liquidaity.main.projection.v1' as const,
    id: 'event-1',
    category: 'execution.tool' as const,
    sequence: 1,
    timestamp: '2026-08-31T12:00:00.000Z',
    ...overrides,
  };
}

describe('projectMainRuntimeEvent', () => {
  it('keeps conversation and execution classification semantic', () => {
    expect(projectMainRuntimeEvent(identity, projection({
      category: 'conversation.input',
      text: 'Exact submitted English.',
    }))).toMatchObject({
      ...identity,
      category: 'conversation.input',
      kind: 'mission',
      text: 'Exact submitted English.',
    });
    expect(projectMainRuntimeEvent(identity, projection({
      id: 'tool-1:started',
      category: 'execution.command',
      state: 'started',
      toolName: 'terminal',
      operationId: 'tool-1',
    }))).toMatchObject({
      category: 'execution.command',
      kind: 'tool_call',
      toolUseId: 'tool-1',
    });
  });

  it('preserves root, child, task, operation, receipt, and provider identity', () => {
    expect(projectMainRuntimeEvent(identity, projection({
      id: 'child-1:finished',
      category: 'execution.child',
      state: 'completed',
      nativeSessionId: 'session-main',
      nativeTurnId: 'turn-main',
      nativeTaskId: 'task-7',
      nativeChildId: 'child-1',
      agentId: 'researcher',
      operationId: 'delegate-1',
      provider: 'openai-codex',
      model: 'gpt-5.6',
    }))).toMatchObject({
      runId: 'run-1',
      parentRunId: null,
      sessionId: 'session-main',
      nativeTurnId: 'turn-main',
      taskId: 'task-7',
      nativeChildId: 'child-1',
      agentId: 'researcher',
      kind: 'child_finished',
      provider: 'openai-codex',
      model: 'gpt-5.6',
    });
  });

  it('keeps errors and fallback receipts visible while redacting credentials', () => {
    const event = projectMainRuntimeEvent(identity, projection({
      category: 'execution.error',
      state: 'failed',
      toolName: 'execute_host_script',
      detail: { error: 'failed', authorization: 'Bearer private-token' },
      fallback: { activated: true, token: 'private-token' },
    }));
    expect(event.kind).toBe('tool_error');
    expect(event.detail).toContain('[redacted]');
    expect(event.fallback).toContain('[redacted]');
    expect(event.detail).not.toContain('private-token');
  });
});
