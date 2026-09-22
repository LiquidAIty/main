import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearKanbanRunMonitorsForTest,
  recoverActiveKanbanRunMonitors,
  startKanbanRunMonitor,
} from './kanbanRunRecovery';
import type { HermesKanbanProgress } from '../routes/hermesKanban.routes';

function progress(overrides: Partial<HermesKanbanProgress> = {}): HermesKanbanProgress {
  return {
    nativeRootId: 't_existing_root',
    nativeRunId: 10,
    nativeStatus: 'done',
    nativeTasks: [],
    tasksCompleted: 4,
    tasksTotal: 4,
    activeWorkers: 0,
    workerSessionIds: ['worker-one'],
    ...overrides,
  };
}

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-durable-1',
    projectId: 'project-1',
    deckId: 'deck-1',
    cardId: 'card-one',
    nativeRootId: 't_existing_root',
    runtimeProfile: 'research',
    runtimeMode: 'kanban',
    ...overrides,
  };
}

describe('retained standalone Kanban Run recovery', () => {
  beforeEach(() => clearKanbanRunMonitorsForTest());

  it('rejoins one exact root, streams progress, deduplicates, and finalizes its original Run', async () => {
    const writes: Array<{ endpoint: string; body: any }> = [];
    let release!: () => void;
    const completed = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      writes.push({ endpoint, body });
      if (endpoint === '/domain/runs/active-kanban') return { runs: [activeRow()] };
      return { ok: true, updated: true };
    });
    const rejoin = vi.fn(async (args: any) => {
      await args.onProgress(progress({
        nativeRunId: 9, nativeStatus: 'running', tasksCompleted: 2, activeWorkers: 1,
      }));
      await completed;
      return {
        finalText: 'Stored native synthesis.',
        nativeRunId: 10,
        sessionId: 'native-session',
        progress: progress(),
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
    expect(rejoin).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'research',
      taskId: 't_existing_root',
      expectedCardId: 'card-one',
      expectedProjectId: 'project-1',
    }));

    release();
    await vi.waitFor(() => expect(writes.filter((write) => (
      write.endpoint === '/domain/runs/finish' && write.body?.state === 'completed'
    ))).toHaveLength(1));
    expect(writes.filter((write) => write.endpoint === '/domain/runs/progress')).toHaveLength(1);
    expect(writes.find((write) => write.endpoint === '/domain/runs/finish')?.body).toMatchObject({
      runId: 'run-durable-1',
      providerThreadRef: 't_existing_root',
      providerTurnRef: 10,
      finalResult: 'Stored native synthesis.',
      toolCallCount: 3,
    });
  });

  it('fails a malformed retained record without starting native recovery', async () => {
    const writes: any[] = [];
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      if (endpoint === '/domain/runs/active-kanban') {
        return { runs: [activeRow({ runtimeMode: 'main' })] };
      }
      writes.push(JSON.parse(String(init.body)));
      return { ok: true };
    });
    const rejoin = vi.fn();

    await expect(recoverActiveKanbanRunMonitors({ request, rejoin }))
      .resolves.toEqual({ discovered: 1, started: 0 });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      runId: 'run-durable-1',
      state: 'failed',
      errorSummary: 'kanban_run_recovery_mode_invalid',
    });
    expect(rejoin).not.toHaveBeenCalled();
  });

  it('preserves a genuinely blocked native root as a blocked Run', async () => {
    const writes: any[] = [];
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      if (endpoint === '/domain/runs/active-kanban') return { runs: [activeRow()] };
      writes.push(JSON.parse(String(init.body)));
      return { ok: true };
    });
    const rejoin = vi.fn(async () => {
      throw new Error('hermes_kanban_card_blocked');
    });

    await recoverActiveKanbanRunMonitors({ request, rejoin });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      runId: 'run-durable-1',
      state: 'blocked',
      errorSummary: 'hermes_kanban_card_blocked',
    });
  });

  it('releases a completed monitor key for a later retained Run check', async () => {
    const monitor = vi.fn(async () => undefined);
    expect(startKanbanRunMonitor('run-one', monitor)).toBe(true);
    expect(startKanbanRunMonitor('run-one', monitor)).toBe(false);
    await vi.waitFor(() => expect(monitor).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(startKanbanRunMonitor('run-one', monitor)).toBe(true));
  });
});
