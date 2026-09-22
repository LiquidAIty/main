import { describe, expect, it, vi } from 'vitest';

import {
  deriveHermesKanbanProgress,
  readHermesKanbanSessionUsage,
  readHermesKanbanCardSnapshots,
  rejoinNativeHermesKanbanTask,
  waitForHermesKanbanCardTask,
  type HermesKanbanTaskSnapshot,
} from './hermesKanban.routes';

function snapshot(
  id: string,
  task: Record<string, unknown>,
  children: string[] = [],
  parents: string[] = [],
): HermesKanbanTaskSnapshot {
  return {
    task: { id, ...task },
    latest_summary: task.result ?? null,
    parents,
    children,
    events: [],
    runs: [],
  };
}

describe('retained standalone Kanban task projection and recovery', () => {
  it('reads the exact root/child graph without dispatch or product routing', async () => {
    const root = snapshot('t_root', {
      created_by: 'card-one', project_id: 'project-1', status: 'running',
    }, ['t_child']);
    const child = snapshot('t_child', { status: 'done', result: 'worker result' });
    const show = vi.fn(async (id: string) => id === 't_root' ? root : child);

    await expect(readHermesKanbanCardSnapshots({
      nativeRootId: 't_root',
      cardId: 'card-one',
      projectId: 'project-1',
      runtimeProfile: 'research',
    }, show)).resolves.toEqual([root, child]);
    expect(show.mock.calls.map(([id]) => id)).toEqual(['t_root', 't_child']);
  });

  it('rejects a native root owned by another saved Card', async () => {
    const root = snapshot('t_root', {
      created_by: 'other-card', project_id: 'project-1', status: 'running',
    });
    await expect(readHermesKanbanCardSnapshots({
      nativeRootId: 't_root',
      cardId: 'card-one',
      projectId: 'project-1',
      runtimeProfile: 'research',
    }, async () => root)).rejects.toThrow('hermes_kanban_terminal_identity_mismatch');
  });

  it('derives truthful active-worker progress from native task snapshots', () => {
    const root = snapshot('t_root', { status: 'running' }, ['t_done', 't_working']);
    const done = snapshot('t_done', { status: 'done', result: 'done' });
    const working = snapshot('t_working', { status: 'running' });
    working.runs = [{
      id: 7,
      status: 'running',
      ended_at: null,
      metadata: { worker_session_id: 'worker-session' },
    }];

    expect(deriveHermesKanbanProgress('t_root', [root, done, working])).toEqual({
      nativeRootId: 't_root',
      nativeRunId: null,
      nativeStatus: 'running',
      nativeTasks: [
        { taskId: 't_root', title: '', assignee: null, status: 'running',
          dependencyIds: [], latestAttempt: null, resultAvailable: false,
          workerSessionId: null, handoffSummary: null,
          toolReceipts: [], toolReceiptsComplete: false },
        { taskId: 't_done', title: '', assignee: null, status: 'done',
          dependencyIds: [], latestAttempt: null, resultAvailable: true,
          workerSessionId: null, handoffSummary: null,
          toolReceipts: [], toolReceiptsComplete: false },
        { taskId: 't_working', title: '', assignee: null, status: 'running',
          dependencyIds: [], latestAttempt: { runId: 7, status: 'running',
            startedAt: null, endedAt: null }, resultAvailable: false,
          workerSessionId: null, handoffSummary: null,
          toolReceipts: [], toolReceiptsComplete: false },
      ],
      tasksCompleted: 1,
      tasksTotal: 3,
      activeWorkers: 1,
      workerSessionIds: ['worker-session'],
    });
  });

  it('sums exact redacted native session usage without provider substitution', async () => {
    const runner = vi.fn(async (args: readonly string[]) => {
      const sessionId = String(args[args.indexOf('--session-id') + 1]);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: sessionId,
          tool_call_count: 2,
          input_tokens: 10,
          output_tokens: 4,
          cache_read_tokens: 5,
          cache_write_tokens: 1,
          reasoning_tokens: 3,
          actual_cost_usd: 0,
        }),
        stderr: '',
      };
    });

    await expect(readHermesKanbanSessionUsage(
      'research',
      ['worker-one', 'worker-two'],
      runner as never,
    )).resolves.toEqual({
      toolCallCount: 4,
      providerInputTokens: 20,
      providerOutputTokens: 8,
      providerCachedTokens: 12,
      providerReasoningTokens: 6,
      totalCostUsd: 0,
    });
  });

  it('waits through an active root and returns its one stored result', async () => {
    const show = vi.fn()
      .mockResolvedValueOnce(snapshot('t_root', { status: 'running' }))
      .mockResolvedValueOnce(snapshot('t_root', {
        status: 'done', result: 'Stored synthesis',
      }));

    await expect(waitForHermesKanbanCardTask('research', 't_root', {
      show,
      pause: async () => undefined,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      taskId: 't_root',
      snapshot: { latest_summary: 'Stored synthesis' },
    });
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('bounds transient native read loss and fails visibly after the limit', async () => {
    const show = vi.fn(async () => {
      throw new Error('native-read-unavailable');
    });
    await expect(waitForHermesKanbanCardTask('research', 't_root', {
      show,
      pause: async () => undefined,
      maxConsecutiveShowFailures: 2,
    })).rejects.toThrow('hermes_kanban_card_show_failed');
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('rejoins one retained root and enforces Card/project identity', async () => {
    const done = snapshot('t_root', {
      status: 'done',
      result: 'Recovered synthesis',
      created_by: 'card-one',
      project_id: 'project-1',
      session_id: 'root-session',
    });
    const show = vi.fn(async () => done);
    const onProgress = vi.fn();

    await expect(rejoinNativeHermesKanbanTask({
      profile: 'research',
      taskId: 't_root',
      expectedCardId: 'card-one',
      expectedProjectId: 'project-1',
      show,
      onProgress,
    })).resolves.toMatchObject({
      finalText: 'Recovered synthesis',
      sessionId: 'root-session',
      progress: { nativeRootId: 't_root', nativeStatus: 'done' },
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});
