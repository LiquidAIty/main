import { logHarnessTrace, redactTrace } from '../services/harnessTrace';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import {
  readHermesKanbanSessionUsage,
  rejoinNativeHermesKanbanTask,
  type HermesKanbanProgress,
  type HermesKanbanUsageTotals,
} from '../routes/hermesKanban.routes';

export type ActiveKanbanRun = {
  runId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  nativeRootId: string;
  runtimeProfile: string;
};

type RecoveryDependencies = {
  request?: typeof requestPythonRailsJson;
  rejoin?: typeof rejoinNativeHermesKanbanTask;
  readUsage?: typeof readHermesKanbanSessionUsage;
};

const activeRunMonitors = new Map<string, Promise<void>>();

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
): Promise<void> {
  const request = dependencies.request ?? requestPythonRailsJson;
  const rejoin = dependencies.rejoin ?? rejoinNativeHermesKanbanTask;
  const readUsage = dependencies.readUsage ?? readHermesKanbanSessionUsage;
  let latestProgress: HermesKanbanProgress | null = null;
  try {
    const completed = await rejoin({
      profile: run.runtimeProfile,
      taskId: run.nativeRootId,
      expectedCardId: run.cardId,
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
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'kanban_run_recovery_failed';
    const blocked = message === 'hermes_kanban_card_blocked';
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
      }),
    }).catch(() => undefined);
  }
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
