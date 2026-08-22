import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearKanbanRunMonitorsForTest,
  recoverActiveKanbanRunMonitors,
} from './kanbanRunRecovery';

describe('durable Kanban Run recovery', () => {
  beforeEach(() => clearKanbanRunMonitorsForTest());

  it('rejoins one exact native root after backend replacement and finalizes the original Run once', async () => {
    const calls: Array<{ endpoint: string; body: any }> = [];
    let finishMonitor: (() => void) | undefined;
    const nativeAdvancedOffline = new Promise<void>((resolve) => { finishMonitor = resolve; });
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ endpoint, body });
      if (endpoint === '/domain/runs/active-kanban') {
        return {
          ok: true,
          runs: [{
            runId: 'run-durable-1',
            projectId: 'project-1',
            deckId: 'deck-1',
            cardId: 'card_hermes_steward',
            nativeRootId: 't_existing_root',
            runtimeProfile: 'liquidaity-hermes-steward',
          }],
        };
      }
      return { ok: true, updated: true };
    });
    const rejoin = vi.fn(async (args: any) => {
      await args.onProgress({
        nativeRootId: 't_existing_root',
        nativeRunId: 9,
        phase: 'working',
        tasksCompleted: 2,
        tasksTotal: 4,
        activeWorkers: 1,
        workerSessionIds: ['worker-luna-1'],
      });
      await nativeAdvancedOffline;
      await args.onProgress({
        nativeRootId: 't_existing_root',
        nativeRunId: 10,
        phase: 'complete',
        tasksCompleted: 4,
        tasksTotal: 4,
        activeWorkers: 0,
        workerSessionIds: ['worker-luna-1', 'root-terra-1'],
      });
      return {
        finalText: 'Stored native root synthesis.',
        nativeRunId: 10,
        progress: {
          nativeRootId: 't_existing_root', nativeRunId: 10, phase: 'complete' as const,
          tasksCompleted: 4, tasksTotal: 4, activeWorkers: 0,
          workerSessionIds: ['worker-luna-1', 'root-terra-1'],
        },
      };
    });
    const readUsage = vi.fn(async () => ({
      toolCallCount: 3,
      providerInputTokens: 100,
      providerOutputTokens: 20,
      providerCachedTokens: 50,
      providerReasoningTokens: 8,
      totalCostUsd: 0,
    }));

    await expect(recoverActiveKanbanRunMonitors({ request, rejoin, readUsage }))
      .resolves.toEqual({ discovered: 1, started: 1 });
    await expect(recoverActiveKanbanRunMonitors({ request, rejoin, readUsage }))
      .resolves.toEqual({ discovered: 1, started: 0 });
    expect(rejoin).toHaveBeenCalledTimes(1);
    expect(rejoin).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 't_existing_root',
      expectedCardId: 'card_hermes_steward',
      expectedProjectId: 'project-1',
    }));

    finishMonitor?.();
    await vi.waitFor(() => expect(calls.filter((call) => (
      call.endpoint === '/domain/runs/finish' && call.body?.state === 'completed'
    ))).toHaveLength(1));
    expect(calls.filter((call) => call.endpoint === '/domain/runs/progress')).toHaveLength(2);
    expect(calls.find((call) => call.endpoint === '/domain/runs/finish')?.body).toMatchObject({
      runId: 'run-durable-1',
      providerThreadRef: 't_existing_root',
      providerTurnRef: 10,
      finalResult: 'Stored native root synthesis.',
      toolCallCount: 3,
    });
  });

  it('fails the original active Run explicitly when its persisted root is malformed', async () => {
    const writes: any[] = [];
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      if (endpoint === '/domain/runs/active-kanban') {
        return { runs: [{
          runId: 'run-bad-root', projectId: 'project-1', deckId: 'deck-1',
          cardId: 'card_hermes_steward', nativeRootId: 'not-a-root',
          runtimeProfile: 'liquidaity-hermes-steward',
        }] };
      }
      writes.push(body);
      return { ok: true };
    });

    await recoverActiveKanbanRunMonitors({ request });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      runId: 'run-bad-root',
      state: 'failed',
      errorSummary: 'kanban_run_recovery_native_root_invalid',
    });
  });
});
