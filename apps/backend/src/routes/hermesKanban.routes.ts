import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';

/*
 * Internal retained standalone Kanban task projection/rejoin adapter.
 *
 * Native Hermes keeps its internal kanban/task/dispatcher vocabulary and
 * SQLite ownership. LiquidAIty retains only the bounded task reads, SQL Run
 * correlation, bounded reads, and recovery for retained native task roots.
 * There is no product board,
 * public route, manual dispatcher control, or special Kanban Card start path.
 */

const HERMES_ROOT = path.join(resolveRepoRoot(), 'Hermes');
const HERMES_HOME = path.join(HERMES_ROOT, '.hermes');
const HERMES_BIN = path.join(HERMES_ROOT, 'venv', 'Scripts', 'hermes.exe');
const HERMES_STATUS_TIMEOUT_MS = 60_000;

type HermesExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runHermes(
  args: readonly string[],
  bin: string = HERMES_BIN,
  timeoutMs: number = HERMES_STATUS_TIMEOUT_MS,
): Promise<HermesExecResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdoutTail = '';
    let stderrTail = '';
    let timeout: NodeJS.Timeout | undefined;
    const finish = (result: HermesExecResult): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    const child = execFile(
      bin,
      [...args],
      {
        timeout: 0,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        env: { ...withoutInternalMcpSecret(process.env), HERMES_HOME },
      },
      (error, stdout, stderr) => {
        const rawCode = (error as { code?: unknown } | null)?.code;
        finish({
          exitCode: typeof rawCode === 'number' ? rawCode : error ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
    if (settled) return;
    child.stdout?.on('data', (chunk) => {
      stdoutTail = `${stdoutTail}${String(chunk)}`.slice(-16 * 1024 * 1024);
    });
    child.stderr?.on('data', (chunk) => {
      stderrTail = `${stderrTail}${String(chunk)}`.slice(-16 * 1024 * 1024);
    });
    timeout = setTimeout(() => {
      const pid = child.pid;
      if (pid && process.platform === 'win32') {
        const terminator = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          shell: false, stdio: 'ignore', windowsHide: true,
        });
        terminator.unref();
      } else if (!child.killed) {
        child.kill('SIGKILL');
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish({
        exitCode: 1,
        stdout: stdoutTail,
        stderr: [stderrTail, `hermes_command_timeout:${timeoutMs}`].filter(Boolean).join('\n'),
      });
    }, timeoutMs);
    timeout.unref?.();
  });
}

function parseHermesJson<T>(stdout: string): T {
  const trimmed = stdout.trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) {
    throw new Error(`hermes_cli_json_not_found: ${trimmed.slice(0, 120)}`);
  }
  return JSON.parse(trimmed.slice(start)) as T;
}

async function showHermesKanbanTask(
  profile: string,
  taskId: string,
  runner: typeof runHermes = runHermes,
): Promise<HermesKanbanTaskSnapshot> {
  const safeProfile = String(profile || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(safeProfile)) {
    throw new Error('hermes_kanban_card_profile_invalid');
  }
  if (!/^t_[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new Error('hermes_kanban_card_task_id_invalid');
  }
  const result = await runner(
    ['-p', safeProfile, 'kanban', 'show', taskId, '--json'],
    HERMES_BIN,
    HERMES_STATUS_TIMEOUT_MS,
  );
  if (result.exitCode !== 0) throw new Error('hermes_kanban_card_show_failed');
  return requireNativeTaskSnapshot(taskId, result.stdout);
}

export type HermesKanbanTaskSnapshot = {
  task: Record<string, unknown>;
  latest_summary?: unknown;
  parents: string[];
  children: string[];
  events: Record<string, unknown>[];
  runs: Record<string, unknown>[];
};

export type HermesKanbanCardTaskResult = {
  taskId: string;
  runId: string | number | null;
  snapshot: HermesKanbanTaskSnapshot;
};

export const HERMES_KANBAN_TASK_STATUSES = [
  'triage', 'todo', 'scheduled', 'ready', 'running',
  'blocked', 'review', 'done', 'archived',
] as const;

export type HermesKanbanTaskStatus = typeof HERMES_KANBAN_TASK_STATUSES[number];

export type HermesKanbanToolReceipt = {
  toolCallId: string;
  toolName: string;
  state: 'returned' | 'failed' | null;
  resultPreview: string;
  executionReceipt: {
    schema: 'agent-runtime.execution-receipt.v1';
    tool: string;
    correlationId: string;
    state: 'completed' | 'failed';
  } | null;
};

export type HermesKanbanTaskProjection = {
  taskId: string;
  title: string;
  assignee: string | null;
  status: HermesKanbanTaskStatus;
  dependencyIds: string[];
  latestAttempt: {
    runId: string | number;
    status: string;
    startedAt: string | number | null;
    endedAt: string | number | null;
  } | null;
  resultAvailable: boolean;
  workerSessionId: string | null;
  handoffSummary: string | null;
  toolReceipts: HermesKanbanToolReceipt[];
  toolReceiptsComplete: boolean;
};

export type HermesKanbanProgress = {
  nativeRootId: string;
  nativeRunId: string | number | null;
  nativeStatus: HermesKanbanTaskStatus;
  nativeTasks: HermesKanbanTaskProjection[];
  tasksCompleted: number;
  tasksTotal: number;
  activeWorkers: number;
  workerSessionIds: string[];
};

export type HermesKanbanUsageTotals = {
  toolCallCount: number;
  providerInputTokens: number;
  providerOutputTokens: number;
  providerCachedTokens: number;
  providerReasoningTokens: number;
  totalCostUsd: number;
};

export type RejoinedHermesKanbanResult = {
  finalText: string;
  nativeRunId: string | number | null;
  sessionId: string | null;
  progress: HermesKanbanProgress;
};

type HermesKanbanJoinOptions = {
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  pause?: (delayMs: number) => Promise<void>;
  cancelled?: () => boolean;
  show?: (taskId: string) => Promise<HermesKanbanTaskSnapshot>;
  onSnapshot?: (snapshot: HermesKanbanTaskSnapshot) => Promise<void> | void;
  maxConsecutiveShowFailures?: number;
};

function nativeRunId(snapshot: HermesKanbanTaskSnapshot): string | number | null {
  const raw = snapshot.runs.at(-1)?.id;
  return typeof raw === 'string' || typeof raw === 'number' ? raw : null;
}

function nativeTaskStatus(snapshot: HermesKanbanTaskSnapshot): HermesKanbanTaskStatus {
  const status = String(snapshot.task.status || '').trim().toLowerCase();
  if (!(HERMES_KANBAN_TASK_STATUSES as readonly string[]).includes(status)) {
    throw new Error('hermes_kanban_task_status_invalid');
  }
  return status as HermesKanbanTaskStatus;
}

function taskProjection(snapshot: HermesKanbanTaskSnapshot): HermesKanbanTaskProjection {
  const latest = snapshot.runs.at(-1);
  const runId = latest?.id;
  const latestAttempt = (typeof runId === 'string' || typeof runId === 'number')
    ? {
        runId,
        status: String(latest?.status || ''),
        startedAt: (typeof latest?.started_at === 'string' || typeof latest?.started_at === 'number')
          ? latest.started_at : null,
        endedAt: (typeof latest?.ended_at === 'string' || typeof latest?.ended_at === 'number')
          ? latest.ended_at : null,
      }
    : null;
  return {
    taskId: String(snapshot.task.id || ''),
    title: String(snapshot.task.title || ''),
    assignee: String(snapshot.task.assignee || '').trim() || null,
    status: nativeTaskStatus(snapshot),
    dependencyIds: snapshot.parents.map((value) => String(value)),
    latestAttempt,
    resultAvailable: Boolean(
      String(snapshot.latest_summary || snapshot.task.result || '').trim(),
    ),
    workerSessionId: null,
    handoffSummary: null,
    toolReceipts: [],
    toolReceiptsComplete: false,
  };
}

export function deriveHermesKanbanProgress(
  taskId: string,
  snapshots: readonly HermesKanbanTaskSnapshot[],
): HermesKanbanProgress {
  const root = snapshots.find((snapshot) => String(snapshot.task.id || '') === taskId);
  if (!root) throw new Error('hermes_kanban_card_root_snapshot_missing');
  const complete = snapshots.filter((snapshot) => nativeTaskStatus(snapshot) === 'done').length;
  const activeWorkers = snapshots.filter((snapshot) => {
    if (snapshot === root) return false;
    const lastRun = snapshot.runs.at(-1);
    return Boolean(lastRun && lastRun.ended_at == null && nativeTaskStatus(snapshot) === 'running');
  }).length;
  const workerSessionIds = [...new Set(snapshots.flatMap((snapshot) => (
    snapshot.runs.map((run) => String((run.metadata as any)?.worker_session_id || '').trim())
  )).filter(Boolean))];
  return {
    nativeRootId: taskId,
    nativeRunId: nativeRunId(root),
    nativeStatus: nativeTaskStatus(root),
    nativeTasks: snapshots.map(taskProjection),
    tasksCompleted: complete,
    tasksTotal: snapshots.length,
    activeWorkers,
    workerSessionIds,
  };
}

async function readHermesKanbanTaskGraph(
  taskId: string,
  root: HermesKanbanTaskSnapshot,
  show: (taskId: string) => Promise<HermesKanbanTaskSnapshot>,
  strict = false,
): Promise<HermesKanbanTaskSnapshot[]> {
  const snapshots = new Map<string, HermesKanbanTaskSnapshot>([[taskId, root]]);
  const queue = [...root.parents, ...root.children];
  while (queue.length > 0 && snapshots.size < 256) {
    const linkedId = String(queue.shift() || '').trim();
    if (!/^t_[A-Za-z0-9_-]+$/.test(linkedId) || snapshots.has(linkedId)) continue;
    try {
      const linked = requireNativeTaskSnapshot(linkedId, JSON.stringify(await show(linkedId)));
      snapshots.set(linkedId, linked);
      queue.push(...linked.parents, ...linked.children);
    } catch {
      if (strict) throw new Error('hermes_kanban_linked_task_unavailable');
      // The root lifecycle remains authoritative. A transient linked-task read
      // can omit progress, but it must never cancel native execution.
    }
  }
  if (strict && queue.length) throw new Error('hermes_kanban_task_projection_limit');
  return [...snapshots.values()];
}

/** Read the retained native root; this path never dispatches or rejoins workers. */
export async function readHermesKanbanCardSnapshots(args: {
  nativeRootId: string; cardId: string; projectId: string; runtimeProfile: string;
}, show: (taskId: string) => Promise<HermesKanbanTaskSnapshot> = (taskId) => (
  showHermesKanbanTask(args.runtimeProfile, taskId)
)): Promise<HermesKanbanTaskSnapshot[]> {
  if (!/^t_[A-Za-z0-9_-]+$/.test(args.nativeRootId)) throw new Error('hermes_kanban_card_task_id_invalid');
  const root = requireNativeTaskSnapshot(args.nativeRootId, JSON.stringify(await show(args.nativeRootId)));
  if (root.task.created_by !== args.cardId || (root.task.project_id && root.task.project_id !== args.projectId)) {
    throw new Error('hermes_kanban_terminal_identity_mismatch');
  }
  return readHermesKanbanTaskGraph(args.nativeRootId, root, show, true);
}

export async function readHermesKanbanSessionUsage(
  profile: string,
  sessionIds: readonly string[],
  runner: typeof runHermes = runHermes,
): Promise<HermesKanbanUsageTotals> {
  const safeProfile = String(profile || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(safeProfile)) {
    throw new Error('hermes_kanban_card_profile_invalid');
  }
  const ids = [...new Set(sessionIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.some((value) => !/^[A-Za-z0-9_-]+$/.test(value))) {
    throw new Error('hermes_kanban_session_id_invalid');
  }
  const rows = await Promise.all(ids.map(async (sessionId) => {
    const result = await runner([
      '-p', safeProfile,
      'sessions', 'export', '-', '--format', 'jsonl',
      '--session-id', sessionId, '--redact',
    ], HERMES_BIN, HERMES_STATUS_TIMEOUT_MS);
    if (result.exitCode !== 0) throw new Error('hermes_kanban_usage_read_failed');
    const row = parseHermesJson<Record<string, unknown>>(result.stdout);
    if (String(row.id || '') !== sessionId) throw new Error('hermes_kanban_usage_session_mismatch');
    return row;
  }));
  const integer = (value: unknown): number => Number.isSafeInteger(Number(value))
    ? Math.max(0, Number(value))
    : 0;
  return rows.reduce<HermesKanbanUsageTotals>((total, row) => ({
    toolCallCount: total.toolCallCount + integer(row.tool_call_count),
    providerInputTokens: total.providerInputTokens + integer(row.input_tokens),
    providerOutputTokens: total.providerOutputTokens + integer(row.output_tokens),
    providerCachedTokens: total.providerCachedTokens + integer(row.cache_read_tokens) + integer(row.cache_write_tokens),
    providerReasoningTokens: total.providerReasoningTokens + integer(row.reasoning_tokens),
    totalCostUsd: total.totalCostUsd + Math.max(0, Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0) || 0),
  }), {
    toolCallCount: 0,
    providerInputTokens: 0,
    providerOutputTokens: 0,
    providerCachedTokens: 0,
    providerReasoningTokens: 0,
    totalCostUsd: 0,
  });
}

function requireNativeTaskSnapshot(
  taskId: string,
  stdout: string,
): HermesKanbanTaskSnapshot {
  let snapshot: HermesKanbanTaskSnapshot;
  try {
    snapshot = parseHermesJson<HermesKanbanTaskSnapshot>(stdout);
  } catch {
    throw new Error('hermes_kanban_card_show_response_invalid');
  }
  if (
    String(snapshot?.task?.id || '').trim() !== taskId
    || !Array.isArray(snapshot?.runs)
    || !Array.isArray(snapshot?.parents)
    || !Array.isArray(snapshot?.children)
    || !Array.isArray(snapshot?.events)
  ) {
    throw new Error('hermes_kanban_card_snapshot_invalid');
  }
  return snapshot;
}

/**
 * Observe the exact saved native root through Hermes' read-only CLI. The caller
 * is responsible for binding task/profile to an authorized saved Run.
 */
export async function observeHermesKanbanTaskGraph(args: {
  nativeRootId: string;
  runtimeProfile: string;
}, show: (taskId: string) => Promise<HermesKanbanTaskSnapshot> = (taskId) => (
  showHermesKanbanTask(args.runtimeProfile, taskId)
)): Promise<HermesKanbanProgress> {
  if (!/^t_[A-Za-z0-9_-]+$/.test(args.nativeRootId)) {
    throw new Error('hermes_kanban_card_task_id_invalid');
  }
  const root = requireNativeTaskSnapshot(
    args.nativeRootId,
    JSON.stringify(await show(args.nativeRootId)),
  );
  const snapshots = await readHermesKanbanTaskGraph(args.nativeRootId, root, show, true);
  return deriveHermesKanbanProgress(args.nativeRootId, snapshots);
}

export async function waitForHermesKanbanCardTask(
  profile: string,
  taskId: string,
  options: HermesKanbanJoinOptions = {},
): Promise<HermesKanbanCardTaskResult> {
  const safeProfile = String(profile || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(safeProfile)) {
    throw new Error('hermes_kanban_card_profile_invalid');
  }
  if (!/^t_[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new Error('hermes_kanban_card_task_id_invalid');
  }
  const show = options.show ?? ((nativeTaskId: string) => (
    showHermesKanbanTask(safeProfile, nativeTaskId)
  ));
  const now = options.now ?? Date.now;
  const pause = options.pause ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const deadline = now() + (options.timeoutMs ?? 30 * 60_000);
  const maxConsecutiveShowFailures = Math.max(1, options.maxConsecutiveShowFailures ?? 3);
  let consecutiveShowFailures = 0;
  for (;;) {
    if (options.cancelled?.()) throw new Error('hermes_kanban_card_cancelled');
    let snapshot: HermesKanbanTaskSnapshot;
    try {
      snapshot = await show(taskId);
    } catch {
      consecutiveShowFailures += 1;
      if (consecutiveShowFailures >= maxConsecutiveShowFailures || now() >= deadline) {
        throw new Error('hermes_kanban_card_show_failed');
      }
      await pause(options.pollMs ?? 1_000);
      continue;
    }
    consecutiveShowFailures = 0;
    snapshot = requireNativeTaskSnapshot(taskId, JSON.stringify(snapshot));
    await options.onSnapshot?.(snapshot);
    const status = String(snapshot.task.status || '').trim().toLowerCase();
    if (status === 'done') {
      if (!String(snapshot.latest_summary || snapshot.task.result || '').trim()) {
        throw new Error('hermes_kanban_card_result_missing');
      }
      return { taskId, runId: nativeRunId(snapshot), snapshot };
    }
    if (status === 'blocked' || status === 'archived') {
      throw new Error(`hermes_kanban_card_${status}`);
    }
    if (now() >= deadline) throw new Error('hermes_kanban_card_join_timeout');
    await pause(options.pollMs ?? 1_000);
  }
}

export async function rejoinNativeHermesKanbanTask(args: {
  profile: string;
  taskId: string;
  expectedCardId: string;
  expectedProjectId: string;
  show?: (taskId: string) => Promise<HermesKanbanTaskSnapshot>;
  onProgress?: (progress: HermesKanbanProgress) => Promise<void> | void;
}): Promise<RejoinedHermesKanbanResult> {
  const expectedCardId = String(args.expectedCardId || '').trim();
  const expectedProjectId = String(args.expectedProjectId || '').trim();
  if (!expectedCardId || !expectedProjectId) {
    throw new Error('hermes_kanban_recovery_authority_incomplete');
  }
  const show = args.show ?? ((nativeTaskId: string) => (
    showHermesKanbanTask(args.profile, nativeTaskId)
  ));
  let latestProgress: HermesKanbanProgress | null = null;
  const completed = await waitForHermesKanbanCardTask(args.profile, args.taskId, {
    show,
    onSnapshot: async (rootSnapshot) => {
      const nativeCardId = String(rootSnapshot.task.created_by || '').trim();
      const nativeProjectId = String(rootSnapshot.task.project_id || '').trim();
      if (nativeCardId !== expectedCardId) {
        throw new Error('hermes_kanban_recovery_card_mismatch');
      }
      if (nativeProjectId && nativeProjectId !== expectedProjectId) {
        throw new Error('hermes_kanban_recovery_project_mismatch');
      }
      const snapshots = await readHermesKanbanTaskGraph(args.taskId, rootSnapshot, show);
      latestProgress = deriveHermesKanbanProgress(args.taskId, snapshots);
      await args.onProgress?.(latestProgress);
    },
  });
  const finalText = String(
    completed.snapshot.latest_summary || completed.snapshot.task.result || '',
  ).trim();
  return {
    finalText,
    nativeRunId: completed.runId,
    sessionId: String(completed.snapshot.task.session_id || '').trim() || null,
    progress: latestProgress ?? deriveHermesKanbanProgress(args.taskId, [completed.snapshot]),
  };
}

// Product Kanban Card startup and board/manual-control routes remain removed.
// These bounded readers exist only for recovery of historical standalone
// kanban Runs.
