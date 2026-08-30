import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearKanbanRunMonitorsForTest,
  reconcileTerminalKanbanRun,
  recoverActiveKanbanRunMonitors,
  startHermesTeamRunMonitor,
} from './kanbanRunRecovery';

describe('durable Kanban Run recovery', () => {
  beforeEach(() => clearKanbanRunMonitorsForTest());

  it('returns one live Team synthesis to the originating session before closing its child Run', async () => {
    const order: string[] = [];
    const appendResult = vi.fn(async () => { order.push('append'); });
    const finishContext = vi.fn(async () => { order.push('finish'); return true; });
    const rejoin = vi.fn(async () => ({
      finalText: 'One native Team synthesis.',
      nativeRunId: 21,
      sessionId: 'acp-session-1',
      progress: {
        nativeRootId: 't_team_root', nativeRunId: 21, phase: 'complete' as const,
        tasksCompleted: 3, tasksTotal: 3, activeWorkers: 0,
        workerSessionIds: ['luna-1', 'luna-2', 'terra-1'],
      },
    }));
    const request = vi.fn(async () => ({ ok: true }));
    const context = {
      contextId: 'ctx-team', sessionId: 'acp-session-1', runId: 'child-run-team',
      rootRunId: 'main-run', parentRunId: 'main-run', projectId: 'project-1',
      deckId: 'deck-1', conversationId: 'conversation-1', cardId: 'card-main',
      runtimeMode: 'main' as const, nativeChildId: 't_team_root',
      childProvider: 'openai-codex', childModel: 'gpt-5.6-terra',
      grantedTools: [], expiresAt: Date.now() + 60_000, state: 'active' as const,
    };

    expect(startHermesTeamRunMonitor(context, appendResult, {
      request, rejoin, finishContext,
    })).toBe(true);
    await vi.waitFor(() => expect(finishContext).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['append', 'finish']);
    expect(rejoin).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 't_team_root',
      expectedCardId: 'delegate_task:team',
      expectedProjectId: 'project-1',
    }));
    expect(appendResult).toHaveBeenCalledWith({
      sessionId: 'acp-session-1', taskId: 't_team_root',
      result: 'One native Team synthesis.', state: 'completed',
    });
  });

  it('waits for the originating native session to become idle before closing Team', async () => {
    const order: string[] = [];
    const appendResult = vi.fn()
      .mockRejectedValueOnce(new Error('hermes_team_session_turn_in_progress'))
      .mockImplementationOnce(async () => { order.push('append'); });
    const finishContext = vi.fn(async () => { order.push('finish'); return true; });
    const rejoin = vi.fn(async () => ({
      finalText: 'One native Team synthesis.',
      nativeRunId: 22,
      sessionId: 'acp-session-busy',
      progress: {
        nativeRootId: 't_team_busy', nativeRunId: 22, phase: 'complete' as const,
        tasksCompleted: 3, tasksTotal: 3, activeWorkers: 0,
        workerSessionIds: ['luna-1', 'luna-2', 'terra-1'],
      },
    }));
    const context = {
      contextId: 'ctx-team-busy', sessionId: 'acp-session-busy', runId: 'child-run-team-busy',
      rootRunId: 'main-run', parentRunId: 'main-run', projectId: 'project-1',
      deckId: 'deck-1', conversationId: 'conversation-1', cardId: 'card-main',
      runtimeMode: 'main' as const, nativeChildId: 't_team_busy',
      childProvider: 'openai-codex', childModel: 'gpt-5.6-terra',
      grantedTools: [], expiresAt: Date.now() + 60_000, state: 'active' as const,
    };

    expect(startHermesTeamRunMonitor(context, appendResult, {
      request: vi.fn(async () => ({ ok: true })),
      rejoin,
      finishContext,
      appendRetryAttempts: 2,
      appendRetryPause: vi.fn(async () => undefined),
    })).toBe(true);
    await vi.waitFor(() => expect(finishContext).toHaveBeenCalledTimes(1));
    expect(appendResult).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['append', 'finish']);
  });

  it('keeps a completed native Team child recoverable when its session stays busy', async () => {
    const appendResult = vi.fn(async () => {
      throw new Error('hermes_team_session_turn_in_progress');
    });
    const finishContext = vi.fn(async () => true);
    const context = {
      contextId: 'ctx-team-deferred', sessionId: 'acp-session-busy',
      runId: 'child-run-team-deferred', rootRunId: 'main-run', parentRunId: 'main-run',
      projectId: 'project-1', deckId: 'deck-1', conversationId: 'conversation-1',
      cardId: 'card-main', runtimeMode: 'main' as const,
      nativeChildId: 't_team_deferred', childProvider: 'openai-codex',
      childModel: 'gpt-5.6-terra', grantedTools: [],
      expiresAt: Date.now() + 60_000, state: 'active' as const,
    };

    expect(startHermesTeamRunMonitor(context, appendResult, {
      request: vi.fn(async () => ({ ok: true })),
      rejoin: vi.fn(async () => ({
        finalText: 'Completed native synthesis.', nativeRunId: 23,
        sessionId: 'acp-session-busy',
        progress: {
          nativeRootId: 't_team_deferred', nativeRunId: 23,
          phase: 'complete' as const, tasksCompleted: 3, tasksTotal: 3,
          activeWorkers: 0, workerSessionIds: [],
        },
      })),
      finishContext,
      appendRetryAttempts: 2,
      appendRetryPause: vi.fn(async () => undefined),
    })).toBe(true);
    await vi.waitFor(() => expect(appendResult).toHaveBeenCalledTimes(2));
    expect(finishContext).not.toHaveBeenCalled();
  });

  it('rejoins an active Team child after backend replacement and appends by saved Card profile', async () => {
    const writes: Array<{ endpoint: string; body: any }> = [];
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      writes.push({ endpoint, body });
      if (endpoint === '/domain/runs/active-kanban') {
        return { runs: [{
          runId: 'child-run-team', projectId: 'project-1', deckId: 'deck-1',
          cardId: 'card-main', nativeRootId: 't_team_restart',
          runtimeProfile: 'liquidaity-main', runtimeMode: 'main',
        }] };
      }
      return { ok: true };
    });
    const rejoin = vi.fn(async () => ({
      finalText: 'Recovered Team synthesis.', nativeRunId: 31,
      sessionId: 'acp-session-recovered',
      progress: {
        nativeRootId: 't_team_restart', nativeRunId: 31, phase: 'complete' as const,
        tasksCompleted: 2, tasksTotal: 2, activeWorkers: 0, workerSessionIds: [],
      },
    }));
    const appendTeamResult = vi.fn(async () => undefined);

    await expect(recoverActiveKanbanRunMonitors({ request, rejoin, appendTeamResult }))
      .resolves.toEqual({ discovered: 1, started: 1 });
    await vi.waitFor(() => expect(appendTeamResult).toHaveBeenCalledTimes(1));
    expect(rejoin).toHaveBeenCalledWith(expect.objectContaining({
      expectedCardId: 'delegate_task:team', taskId: 't_team_restart',
    }));
    expect(appendTeamResult).toHaveBeenCalledWith({
      profile: 'liquidaity-main', sessionId: 'acp-session-recovered',
      taskId: 't_team_restart', result: 'Recovered Team synthesis.', state: 'completed',
    });
    await vi.waitFor(() => expect(writes.some((write) => (
      write.endpoint === '/domain/runs/finish' && write.body?.state === 'completed'
    ))).toBe(true));
  });

  it('leaves a recovered Team Run active when terminal delivery is still busy', async () => {
    const writes: Array<{ endpoint: string; body: any }> = [];
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      writes.push({ endpoint, body });
      if (endpoint === '/domain/runs/active-kanban') {
        return { runs: [{
          runId: 'child-run-team-busy', projectId: 'project-1', deckId: 'deck-1',
          cardId: 'card_main_chat', nativeRootId: 't_team_busy_recovery',
          runtimeProfile: 'default', runtimeMode: 'main',
        }] };
      }
      return { ok: true };
    });
    const appendTeamResult = vi.fn(async () => {
      throw new Error('hermes_team_session_turn_in_progress');
    });

    await expect(recoverActiveKanbanRunMonitors({
      request,
      rejoin: vi.fn(async () => ({
        finalText: 'Recovered native synthesis.', nativeRunId: 32,
        sessionId: 'session-busy',
        progress: {
          nativeRootId: 't_team_busy_recovery', nativeRunId: 32,
          phase: 'complete' as const, tasksCompleted: 3, tasksTotal: 3,
          activeWorkers: 0, workerSessionIds: [],
        },
      })),
      appendTeamResult,
      appendRetryAttempts: 2,
      appendRetryPause: vi.fn(async () => undefined),
    })).resolves.toEqual({ discovered: 1, started: 1 });
    await vi.waitFor(() => expect(appendTeamResult).toHaveBeenCalledTimes(2));
    expect(writes.filter((write) => write.endpoint === '/domain/runs/finish')).toEqual([]);
  });

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
            runtimeMode: 'kanban',
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
        sessionId: 'kanban-session-1',
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
          runtimeMode: 'kanban',
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

  it('reconciles a transport-failed Run only after the same native root returns its stored result', async () => {
    const writes: Array<{ endpoint: string; body: any }> = [];
    let releaseRoot: (() => void) | undefined;
    const rootReady = new Promise<void>((resolve) => { releaseRoot = resolve; });
    const request = vi.fn(async (endpoint: string, init: RequestInit) => {
      writes.push({
        endpoint,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      });
      return { ok: true, updated: true };
    });
    const rejoin = vi.fn(async () => {
      await rootReady;
      return {
        finalText: 'Exact stored native result.',
        nativeRunId: 18,
        sessionId: 'kanban-session-2',
        progress: {
          nativeRootId: 't_retained_root', nativeRunId: 18, phase: 'complete' as const,
          tasksCompleted: 5, tasksTotal: 5, activeWorkers: 0,
          workerSessionIds: [],
        },
      };
    });
    const run = {
      runId: 'run-transport-failed', projectId: 'project-1', deckId: 'deck-1',
      cardId: 'card_hermes_steward', nativeRootId: 't_retained_root',
      runtimeProfile: 'liquidaity-hermes-steward',
      runtimeMode: 'kanban' as const,
    };

    expect(reconcileTerminalKanbanRun(run, { request, rejoin })).toBe(true);
    expect(reconcileTerminalKanbanRun(run, { request, rejoin })).toBe(false);
    await vi.waitFor(() => expect(rejoin).toHaveBeenCalledTimes(1));
    releaseRoot?.();
    await vi.waitFor(() => expect(writes.some((write) => (
      write.endpoint === '/domain/runs/finish'
      && write.body?.state === 'completed'
    ))).toBe(true));
    expect(writes.find((write) => write.endpoint === '/domain/runs/finish')?.body).toMatchObject({
      runId: 'run-transport-failed',
      providerThreadRef: 't_retained_root',
      providerTurnRef: 18,
      finalResult: 'Exact stored native result.',
      reconcileNativeTerminal: true,
    });
  });
});
