import { logHarnessTrace, redactTrace } from '../services/harnessTrace';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import {
  readHermesKanbanSessionUsage,
  rejoinNativeHermesKanbanTask,
  type HermesKanbanProgress,
  type HermesKanbanUsageTotals,
} from '../routes/hermesKanban.routes';
import { requestHermesExtension } from './mainAdapter';
import {
  finishHermesExecutionContext,
  type HermesExecutionContext,
} from './childExecutionContext';

export type ActiveKanbanRun = {
  runId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  nativeRootId: string;
  runtimeProfile: string;
  runtimeMode: 'main' | 'delegate' | 'kanban';
};

type RecoveryDependencies = {
  request?: typeof requestPythonRailsJson;
  rejoin?: typeof rejoinNativeHermesKanbanTask;
  readUsage?: typeof readHermesKanbanSessionUsage;
  finishContext?: typeof finishHermesExecutionContext;
  appendTeamResult?: (args: {
    profile: string;
    sessionId: string;
    taskId: string;
    result: string;
    state: 'completed' | 'blocked' | 'failed' | 'cancelled';
  }) => Promise<void>;
  appendRetryPause?: (delayMs: number) => Promise<void>;
  appendRetryAttempts?: number;
};

const activeRunMonitors = new Map<string, Promise<void>>();

async function appendTeamResultWhenSessionIdle(
  appendResult: () => Promise<void>,
  dependencies: RecoveryDependencies,
): Promise<void> {
  const pause = dependencies.appendRetryPause
    ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const attempts = Math.max(1, dependencies.appendRetryAttempts ?? 1_800);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await appendResult();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== 'hermes_team_session_turn_in_progress' || attempt === attempts) throw error;
      await pause(1_000);
    }
  }
}

export function startHermesTeamRunMonitor(
  context: HermesExecutionContext,
  appendResult: (args: {
    sessionId: string;
    taskId: string;
    result: string;
    state: 'completed' | 'blocked' | 'failed' | 'cancelled';
  }) => Promise<void>,
  dependencies: RecoveryDependencies = {},
): boolean {
  const nativeRootId = String(context.nativeChildId || '').trim();
  if (!/^t_[A-Za-z0-9_-]+$/.test(nativeRootId)) return false;
  return startKanbanRunMonitor(context.runId, async () => {
    const request = dependencies.request ?? requestPythonRailsJson;
    const rejoin = dependencies.rejoin ?? rejoinNativeHermesKanbanTask;
    const finishContext = dependencies.finishContext ?? finishHermesExecutionContext;
    let latestProgress: HermesKanbanProgress | null = null;
    try {
      const completed = await rejoin({
        profile: 'default',
        taskId: nativeRootId,
        expectedCardId: 'delegate_task:team',
        expectedProjectId: context.projectId,
        onProgress: async (progress) => {
          latestProgress = progress;
          await request('/domain/runs/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(progressPayload(context.runId, progress)),
          });
        },
      });
      const progress = latestProgress ?? completed.progress;
      await appendTeamResultWhenSessionIdle(() => appendResult({
          sessionId: context.sessionId,
          taskId: nativeRootId,
          result: completed.finalText,
          state: 'completed',
        }), dependencies);
      await finishContext({
        contextId: context.contextId,
        state: 'completed',
        configuration: {
          provider: context.childProvider || undefined,
          model: context.childModel || undefined,
          fallbackOccurred: false,
        },
        nativeResult: {
          providerThreadRef: nativeRootId,
          providerTurnRef: completed.nativeRunId,
          nativePhase: 'complete',
          tasksCompleted: Math.max(progress.tasksCompleted, progress.tasksTotal),
          tasksTotal: progress.tasksTotal,
          activeWorkers: 0,
          finalResult: completed.finalText,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'hermes_team_monitor_failed';
      const state = message === 'hermes_kanban_card_blocked' ? 'blocked' : 'failed';
      const progress = latestProgress as HermesKanbanProgress | null;
      const closed = await finishContext({
        contextId: context.contextId,
        state,
        errorSummary: message,
        configuration: {
          provider: context.childProvider || undefined,
          model: context.childModel || undefined,
          fallbackOccurred: false,
        },
        nativeResult: {
          providerThreadRef: nativeRootId,
          providerTurnRef: progress?.nativeRunId ?? null,
          nativePhase: state,
          tasksCompleted: progress?.tasksCompleted ?? 0,
          tasksTotal: progress?.tasksTotal ?? 1,
          activeWorkers: 0,
        },
      });
      if (closed) {
        await appendResult({
          sessionId: context.sessionId,
          taskId: nativeRootId,
          result: `Native Team ${nativeRootId} ${state}: ${message}`,
          state,
        });
      }
    }
  });
}

export function startKanbanRunMonitor(
  runId: string,
  monitor: () => Promise<void>,
): boolean {
  const key = String(runId || '').trim();
  if (!key || activeRunMonitors.has(key)) return false;
  const running = Promise.resolve()
    .then(monitor)
    .finally(() => {
      if (activeRunMonitors.get(key) === running) activeRunMonitors.delete(key);
    });
  activeRunMonitors.set(key, running);
  return true;
}

function requireActiveRun(value: unknown): ActiveKanbanRun {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const run: ActiveKanbanRun = {
    runId: String(row.runId || '').trim(),
    projectId: String(row.projectId || '').trim(),
    deckId: String(row.deckId || '').trim(),
    cardId: String(row.cardId || '').trim(),
    nativeRootId: String(row.nativeRootId || '').trim(),
    runtimeProfile: String(row.runtimeProfile || '').trim(),
    runtimeMode: String(row.runtimeMode || '').trim() as ActiveKanbanRun['runtimeMode'],
  };
  if (!run.runId || !run.projectId || !run.deckId || !run.cardId) {
    throw new Error('kanban_run_recovery_identity_incomplete');
  }
  if (!/^t_[A-Za-z0-9_-]+$/.test(run.nativeRootId)) {
    throw new Error('kanban_run_recovery_native_root_invalid');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(run.runtimeProfile)) {
    throw new Error('kanban_run_recovery_profile_invalid');
  }
  if (!['main', 'delegate', 'kanban'].includes(run.runtimeMode)) {
    throw new Error('kanban_run_recovery_mode_invalid');
  }
  return run;
}

function progressPayload(runId: string, progress: HermesKanbanProgress): Record<string, unknown> {
  return {
    runId,
    nativeRootId: progress.nativeRootId,
    nativeRunId: progress.nativeRunId,
    nativePhase: progress.phase,
    tasksCompleted: progress.tasksCompleted,
    tasksTotal: progress.tasksTotal,
    activeWorkers: progress.activeWorkers,
  };
}

async function recoverOneKanbanRun(
  run: ActiveKanbanRun,
  dependencies: RecoveryDependencies,
  reconcileNativeTerminal = false,
): Promise<void> {
  const request = dependencies.request ?? requestPythonRailsJson;
  const rejoin = dependencies.rejoin ?? rejoinNativeHermesKanbanTask;
  const readUsage = dependencies.readUsage ?? readHermesKanbanSessionUsage;
  const teamDelegation = run.runtimeMode !== 'kanban';
  const appendTeamResult = dependencies.appendTeamResult ?? (async (args) => {
    await requestHermesExtension('_session/append_native_team_result', {
      sessionId: args.sessionId,
      taskId: args.taskId,
      result: args.result,
      state: args.state,
    }, args.profile);
  });
  let latestProgress: HermesKanbanProgress | null = null;
  try {
    const completed = await rejoin({
      profile: run.runtimeProfile,
      taskId: run.nativeRootId,
      expectedCardId: teamDelegation ? 'delegate_task:team' : run.cardId,
      expectedProjectId: run.projectId,
      onProgress: async (progress) => {
        latestProgress = progress;
        await request('/domain/runs/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(progressPayload(run.runId, progress)),
        });
      },
    });
    const progress = latestProgress ?? completed.progress;
    let usage: HermesKanbanUsageTotals = {
      toolCallCount: 0,
      providerInputTokens: 0,
      providerOutputTokens: 0,
      providerCachedTokens: 0,
      providerReasoningTokens: 0,
      totalCostUsd: 0,
    };
    try {
      usage = await readUsage(run.runtimeProfile, progress.workerSessionIds);
    } catch (error) {
      logHarnessTrace(
        `[harness] recovered configured-card usage read failed run=${run.runId} reason=${redactTrace(error instanceof Error ? error.message : String(error))}`,
      );
    }
    if (teamDelegation) {
      const originSessionId = completed.sessionId;
      if (!originSessionId) throw new Error('hermes_team_session_id_missing');
      await appendTeamResultWhenSessionIdle(() => appendTeamResult({
          profile: run.runtimeProfile,
          sessionId: originSessionId,
          taskId: run.nativeRootId,
          result: completed.finalText,
          state: 'completed',
        }), dependencies);
    }
    await request('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        state: 'completed',
        providerThreadRef: run.nativeRootId,
        providerTurnRef: completed.nativeRunId,
        nativePhase: 'complete',
        tasksCompleted: Math.max(progress.tasksCompleted, progress.tasksTotal),
        tasksTotal: progress.tasksTotal,
        activeWorkers: 0,
        ...usage,
        finalResult: completed.finalText,
        ...(reconcileNativeTerminal ? { reconcileNativeTerminal: true } : {}),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'kanban_run_recovery_failed';
    const blocked = message === 'hermes_kanban_card_blocked';
    if (reconcileNativeTerminal && !blocked) {
      logHarnessTrace(
        `[harness] terminal configured-card reconciliation deferred run=${run.runId} reason=${redactTrace(message)}`,
      );
      return;
    }
    const failedProgress = latestProgress as HermesKanbanProgress | null;
    await request('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        state: blocked ? 'blocked' : 'failed',
        providerThreadRef: run.nativeRootId,
        providerTurnRef: failedProgress?.nativeRunId ?? null,
        nativePhase: blocked ? 'blocked' : 'failed',
        tasksCompleted: failedProgress?.tasksCompleted ?? 0,
        tasksTotal: failedProgress?.tasksTotal ?? 1,
        activeWorkers: 0,
        errorCode: 'kanban_run_recovery_failed',
        errorSummary: message,
        ...(reconcileNativeTerminal ? { reconcileNativeTerminal: true } : {}),
      }),
    }).catch(() => undefined);
  }
}

export function reconcileTerminalKanbanRun(
  value: unknown,
  dependencies: RecoveryDependencies = {},
): boolean {
  const run = requireActiveRun(value);
  return startKanbanRunMonitor(
    run.runId,
    () => recoverOneKanbanRun(run, dependencies, true),
  );
}

export async function recoverActiveKanbanRunMonitors(
  dependencies: RecoveryDependencies = {},
): Promise<{ discovered: number; started: number }> {
  const request = dependencies.request ?? requestPythonRailsJson;
  const response = await request('/domain/runs/active-kanban', { method: 'GET' }) as any;
  const rows = Array.isArray(response?.runs) ? response.runs : [];
  let started = 0;
  for (const row of rows) {
    let run: ActiveKanbanRun;
    try {
      run = requireActiveRun(row);
    } catch (error) {
      const runId = String(row?.runId || '').trim();
      if (runId) {
        const message = error instanceof Error ? error.message : 'kanban_run_recovery_invalid';
        startKanbanRunMonitor(runId, async () => {
          await request('/domain/runs/finish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId,
              state: 'failed',
              nativePhase: 'failed',
              errorCode: 'kanban_run_recovery_failed',
              errorSummary: message,
            }),
          });
        });
      }
      continue;
    }
    if (startKanbanRunMonitor(run.runId, () => recoverOneKanbanRun(run, dependencies))) {
      started += 1;
    }
  }
  return { discovered: rows.length, started };
}

export function clearKanbanRunMonitorsForTest(): void {
  activeRunMonitors.clear();
}
