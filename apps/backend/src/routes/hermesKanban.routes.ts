import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import {
  requestHermesExtension,
} from '../hermes/mainAdapter';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';

/*
 * Internal native Team task projection/rejoin adapter.
 *
 * Native Hermes keeps its internal kanban/task/dispatcher vocabulary and
 * SQLite ownership. LiquidAIty retains only the bounded task reads, SQL Run
 * correlation, rejoin, recovery, and worker-bearer projection required by
 * ordinary Cards using delegate_task(role="team"). There is no product board,
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

export type HermesKanbanProgress = {
  nativeRootId: string;
  nativeRunId: string | number | null;
  phase: 'queued' | 'decomposing' | 'working' | 'synthesizing' | 'complete' | 'blocked' | 'failed';
  tasksCompleted: number;
  tasksTotal: number;
  activeWorkers: number;
  workerSessionIds: string[];
  teamReceipt: HermesTeamReceipt | null;
};

export type HermesTeamReceipt = {
  schemaVersion: 'hermes.team.policy.v1';
  source: string;
  mode: 'auto';
  maxWorkers: number;
  retryLimit: number;
  maxRetries: number;
  workerProvider: string;
  workerModel: string;
  leadProvider: string;
  leadModel: string;
  maxDepth: number;
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

function nativeTaskStatus(snapshot: HermesKanbanTaskSnapshot): string {
  return String(snapshot.task.status || '').trim().toLowerCase();
}

export function readHermesTeamReceipt(
  snapshots: readonly HermesKanbanTaskSnapshot[],
): HermesTeamReceipt | null {
  for (const snapshot of snapshots) {
    for (const event of [...snapshot.events].reverse()) {
      if (String(event.kind || '') !== 'team_policy_applied') continue;
      const payload = event.payload && typeof event.payload === 'object'
        ? event.payload as Record<string, unknown>
        : {};
      if (payload.schema_version !== 'hermes.team.policy.v1' || payload.mode !== 'auto') {
        throw new Error('hermes_team_policy_receipt_invalid');
      }
      const requiredText = (key: string): string => {
        const value = String(payload[key] || '').trim();
        if (!value) throw new Error('hermes_team_policy_receipt_invalid');
        return value;
      };
      const requiredInteger = (key: string): number => {
        const value = Number(payload[key]);
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error('hermes_team_policy_receipt_invalid');
        }
        return value;
      };
      return {
        schemaVersion: 'hermes.team.policy.v1',
        source: requiredText('source'),
        mode: 'auto',
        maxWorkers: requiredInteger('max_workers'),
        retryLimit: requiredInteger('retry_limit'),
        maxRetries: requiredInteger('max_retries'),
        workerProvider: requiredText('worker_provider'),
        workerModel: requiredText('worker_model'),
        leadProvider: requiredText('lead_provider'),
        leadModel: requiredText('lead_model'),
        maxDepth: requiredInteger('max_depth'),
      };
    }
  }
  return null;
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
  const rootStatus = nativeTaskStatus(root);
  const linked = snapshots.filter((snapshot) => snapshot !== root);
  const hasDecomposition = root.events.some((event) => String(event.kind || '') === 'decomposed')
    || linked.length > 0;
  let phase: HermesKanbanProgress['phase'];
  if (rootStatus === 'done') phase = 'complete';
  else if (rootStatus === 'blocked') phase = 'blocked';
  else if (rootStatus === 'archived') phase = 'failed';
  else if (!hasDecomposition && rootStatus === 'triage') phase = 'decomposing';
  else if (linked.some((snapshot) => nativeTaskStatus(snapshot) !== 'done')) phase = 'working';
  else if (hasDecomposition && ['todo', 'ready', 'running', 'review'].includes(rootStatus)) phase = 'synthesizing';
  else phase = 'queued';
  return {
    nativeRootId: taskId,
    nativeRunId: nativeRunId(root),
    phase,
    tasksCompleted: complete,
    tasksTotal: snapshots.length,
    activeWorkers,
    workerSessionIds,
    teamReceipt: readHermesTeamReceipt(snapshots),
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
  nativeRootId: string; cardId: string; projectId: string; teamRoot?: boolean;
}, show: (taskId: string) => Promise<HermesKanbanTaskSnapshot> = async (taskId) => (
  requestHermesExtension('_kanban/show', { taskId }) as Promise<HermesKanbanTaskSnapshot>
)): Promise<HermesKanbanTaskSnapshot[]> {
  if (!/^t_[A-Za-z0-9_-]+$/.test(args.nativeRootId)) throw new Error('hermes_kanban_card_task_id_invalid');
  const root = requireNativeTaskSnapshot(args.nativeRootId, JSON.stringify(await show(args.nativeRootId)));
  const expectedCreator = args.teamRoot ? 'delegate_task:team' : args.cardId;
  if (root.task.created_by !== expectedCreator || (root.task.project_id && root.task.project_id !== args.projectId)) {
    throw new Error('hermes_kanban_terminal_identity_mismatch');
  }
  return readHermesKanbanTaskGraph(args.nativeRootId, root, show, true);
}

export type HermesKanbanCardExecutionContext = {
  projectId: string;
  deckId: string;
  conversationId: string;
  runId: string;
  rootRunId: string;
  cardId: string;
  cardRevisionId: string;
  runtimeMode: 'main' | 'delegate' | 'kanban';
  runtimeProfile: string;
  nativeRootId: string;
  nativeChildId: string;
  grantedTools: string[];
};

export async function resolveHermesKanbanCardExecutionContext(args: {
  projectId?: string;
  deckId?: string;
  taskId: string;
  show?: (taskId: string) => Promise<HermesKanbanTaskSnapshot>;
  resolveRun?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}): Promise<HermesKanbanCardExecutionContext> {
  const projectId = String(args.projectId || '').trim();
  const deckId = String(args.deckId || '').trim();
  const taskId = String(args.taskId || '').trim();
  if (Boolean(projectId) !== Boolean(deckId)) {
    throw new Error('hermes_kanban_card_authority_incomplete');
  }
  if (!/^t_[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('hermes_kanban_card_task_id_invalid');
  const show = args.show ?? (async (nativeTaskId: string) => (
    requestHermesExtension('_kanban/show', { taskId: nativeTaskId }) as Promise<HermesKanbanTaskSnapshot>
  ));
  const first = requireNativeTaskSnapshot(taskId, JSON.stringify(await show(taskId)));
  const snapshots = await readHermesKanbanTaskGraph(taskId, first, show);
  const nativeTaskIds = snapshots.map((snapshot) => String(snapshot.task.id || '').trim());
  const resolveRun = args.resolveRun ?? (async (payload) => (
    requestPythonRailsJson('/domain/runs/resolve-native-hermes-task-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }) as Promise<Record<string, unknown>>
  ));
  const resolved = await resolveRun({
    ...(projectId ? { projectId, deckId } : {}),
    nativeTaskIds,
  });
  const rawContext = resolved?.context;
  if (!resolved?.ok || !rawContext || typeof rawContext !== 'object') {
    throw new Error('hermes_kanban_card_run_context_rejected');
  }
  const context = rawContext as Record<string, unknown>;
  const resolvedProjectId = String(context.projectId || '').trim();
  const resolvedDeckId = String(context.deckId || '').trim();
  const conversationId = String(context.conversationId || '').trim();
  const nativeRootId = String(context.nativeRootId || '').trim();
  const runId = String(context.runId || '').trim();
  const rootRunId = String(context.rootRunId || '').trim();
  const runtimeMode = String(context.runtimeMode || '');
  const teamDelegation = Boolean(runId && rootRunId && runId !== rootRunId);
  const root = snapshots.find((snapshot) => String(snapshot.task.id || '').trim() === nativeRootId);
  const grantedTools = Array.isArray(context.grantedTools)
    ? [...new Set(context.grantedTools.map(String).map((value) => value.trim()).filter(Boolean))].sort()
    : [];
  if (
    !root
    || !resolvedProjectId
    || !resolvedDeckId
    || !conversationId
    || (projectId && resolvedProjectId !== projectId)
    || (deckId && resolvedDeckId !== deckId)
    || !['main', 'delegate', 'kanban'].includes(runtimeMode)
    || !runId
    || !rootRunId
    || (!teamDelegation && rootRunId !== runId)
    || !String(context.cardId || '').trim()
    || !String(context.cardRevisionId || '').trim()
    || !Array.isArray(context.grantedTools)
    || context.grantedTools.some((value) => typeof value !== 'string' || !value.trim())
  ) {
    throw new Error('hermes_kanban_card_run_context_invalid');
  }
  const nativeCardId = String(root.task.created_by || '').trim();
  const nativeProjectId = String(root.task.project_id || '').trim();
  if (
    nativeCardId
    && nativeCardId !== String(context.cardId)
    && !(teamDelegation && nativeCardId === 'delegate_task:team')
  ) {
    throw new Error('hermes_kanban_card_run_card_mismatch');
  }
  if (nativeProjectId && nativeProjectId !== resolvedProjectId) {
    throw new Error('hermes_kanban_card_run_project_mismatch');
  }
  return {
    projectId: resolvedProjectId,
    deckId: resolvedDeckId,
    conversationId,
    runId,
    rootRunId,
    cardId: String(context.cardId),
    cardRevisionId: String(context.cardRevisionId),
    runtimeMode: runtimeMode as HermesKanbanCardExecutionContext['runtimeMode'],
    runtimeProfile: String(context.runtimeProfile || ''),
    nativeRootId,
    nativeChildId: taskId,
    grantedTools,
  };
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
    || !Array.isArray(snapshot?.children)
    || !Array.isArray(snapshot?.events)
  ) {
    throw new Error('hermes_kanban_card_snapshot_invalid');
  }
  return snapshot;
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
  const show = options.show ?? (async (nativeTaskId: string) => (
    requestHermesExtension('_kanban/show', { taskId: nativeTaskId }) as Promise<HermesKanbanTaskSnapshot>
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
    const waitingForTeamCorrelation = (
      status === 'blocked'
      && String(snapshot.task.workflow_template_id || '').trim() === 'delegate-team-v1'
      && String(snapshot.task.current_step_key || '').trim() === 'correlation'
    );
    if ((status === 'blocked' && !waitingForTeamCorrelation) || status === 'archived') {
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
  requestExtension?: typeof requestHermesExtension;
  onProgress?: (progress: HermesKanbanProgress) => Promise<void> | void;
}): Promise<RejoinedHermesKanbanResult> {
  const expectedCardId = String(args.expectedCardId || '').trim();
  const expectedProjectId = String(args.expectedProjectId || '').trim();
  if (!expectedCardId || !expectedProjectId) {
    throw new Error('hermes_kanban_recovery_authority_incomplete');
  }
  const requestExtension = args.requestExtension ?? requestHermesExtension;
  const show = async (nativeTaskId: string) => (
    requestExtension('_kanban/show', { taskId: nativeTaskId }) as Promise<HermesKanbanTaskSnapshot>
  );
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

export async function reclaimNativeHermesKanbanTask(
  taskId: string,
  reason = 'LiquidAIty operator reclaim',
  requestExtension: typeof requestHermesExtension = requestHermesExtension,
): Promise<HermesKanbanTaskSnapshot> {
  if (!/^t_[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('hermes_kanban_card_task_id_invalid');
  return requireNativeTaskSnapshot(
    taskId,
    JSON.stringify(await requestExtension('_kanban/reclaim', { taskId, reason })),
  );
}

export async function terminateNativeHermesKanbanRun(
  runId: string | number,
  reason = 'LiquidAIty operator terminate',
  requestExtension: typeof requestHermesExtension = requestHermesExtension,
): Promise<HermesKanbanTaskSnapshot> {
  const nativeRunId = Number(runId);
  if (!Number.isSafeInteger(nativeRunId) || nativeRunId <= 0) {
    throw new Error('hermes_kanban_native_run_id_invalid');
  }
  const snapshot = await requestExtension('_kanban/terminate', {
    runId: nativeRunId,
    reason,
  });
  const taskId = String(snapshot?.task?.id || '').trim();
  if (!taskId) throw new Error('hermes_kanban_card_snapshot_invalid');
  return requireNativeTaskSnapshot(taskId, JSON.stringify(snapshot));
}

// Product Kanban Card startup and the board/manual-control router were removed.
// The functions above remain internal because ordinary Card Team runs still
// need exact native task projection, worker correlation, bounded rejoin, and
// recovery across process restarts.
