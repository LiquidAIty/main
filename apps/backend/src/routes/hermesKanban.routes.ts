import { Router } from 'express';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import {
  buildHermesOfficialMcpServer,
  providerForHermes,
  requestHermesExtension,
  type HermesSessionEvent,
  type HermesTurnArgs,
  type HermesTurnHandle,
  type HermesTurnUsage,
} from '../hermes/mainAdapter';
import {
  finishHermesExecutionContext,
  registerHermesRootExecutionContext,
} from '../hermes/childExecutionContext';
import { configureHermesCardMcpProfile } from '../hermes/profileMemory';

/*
 * Hermes Kanban proxy — thin read/persistence adapter (DONT.md rule 5).
 *
 * This router shells out to the repo-owned Hermes CLI for the LIVE kanban
 * system (kanban.db is owned by Hermes, not by LiquidAIty).
 * TS is transport only: every value shown is the native `hermes kanban ...`
 * JSON / plain output verbatim-shaped. No logic, no fallbacks, no fake data.
 *
 * Read routes are safe (list/show/stats/boards/profiles/config). Mutation
 * routes (create/block/comment/...) run the real CLI from explicit user action
 * in the Hermes Kanban app. Saved Cards whose runtime mode is `kanban` submit
 * exactly one native Triage task here and join its root result; the persistent
 * gateway remains the sole decomposer/dispatcher.
 */

const HERMES_ROOT = path.join(resolveRepoRoot(), 'Hermes');
const HERMES_HOME = path.join(HERMES_ROOT, '.hermes');
const HERMES_BIN = path.join(HERMES_ROOT, 'venv', 'Scripts', 'hermes.exe');
const HERMES_EXEC_TIMEOUT_MS = 20_000;
const HERMES_GATEWAY_STATUS_TIMEOUT_MS = 60_000;
const HERMES_GATEWAY_STOP_TIMEOUT_MS = 60_000;
const KANBAN_CARD_MCP_TOKEN_ENV = 'LIQUIDAITY_KANBAN_CARD_MCP_BEARER';

export type HermesExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function isHermesGatewayRunning(stdout: string): boolean {
  return /Gateway(?: process)? (?:is )?running/i.test(stdout);
}

export function hermesGatewayPids(stdout: string): number[] {
  const match = /Gateway(?: process)? (?:is )?running[^\r\n]*\(PID:\s*([\d,\s]+)\)/i.exec(stdout);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
}

export function runHermes(
  args: readonly string[],
  bin: string = HERMES_BIN,
  timeoutMs: number = HERMES_EXEC_TIMEOUT_MS,
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<HermesExecResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...args],
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          ...envOverrides,
          HERMES_HOME,
        },
      },
      (error, stdout, stderr) => {
        const rawCode = (error as { code?: unknown } | null)?.code;
        const exitCode =
          typeof rawCode === 'number' ? rawCode : error ? 1 : 0;
        resolve({
          exitCode,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
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
};

function nativeRunId(snapshot: HermesKanbanTaskSnapshot): string | number | null {
  const raw = snapshot.runs.at(-1)?.id;
  return typeof raw === 'string' || typeof raw === 'number' ? raw : null;
}

function nativeTaskStatus(snapshot: HermesKanbanTaskSnapshot): string {
  return String(snapshot.task.status || '').trim().toLowerCase();
}

export function deriveHermesKanbanProgress(
  taskId: string,
  snapshots: readonly HermesKanbanTaskSnapshot[],
): HermesKanbanProgress {
  const root = snapshots.find((snapshot) => String(snapshot.task.id || '') === taskId);
  if (!root) throw new Error('hermes_kanban_card_root_snapshot_missing');
  const complete = snapshots.filter((snapshot) => nativeTaskStatus(snapshot) === 'done').length;
  const activeWorkers = snapshots.filter((snapshot) => {
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
  };
}

async function readHermesKanbanTaskGraph(
  taskId: string,
  root: HermesKanbanTaskSnapshot,
  show: (taskId: string) => Promise<HermesKanbanTaskSnapshot>,
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
      // The root lifecycle remains authoritative. A transient linked-task read
      // can omit progress, but it must never cancel native execution.
    }
  }
  return [...snapshots.values()];
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
    ], HERMES_BIN, HERMES_GATEWAY_STATUS_TIMEOUT_MS);
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
  for (;;) {
    if (options.cancelled?.()) throw new Error('hermes_kanban_card_cancelled');
    let snapshot: HermesKanbanTaskSnapshot;
    try {
      snapshot = await show(taskId);
    } catch {
      throw new Error('hermes_kanban_card_show_failed');
    }
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
    progress: latestProgress ?? deriveHermesKanbanProgress(args.taskId, [completed.snapshot]),
  };
}

async function requireNativeKanbanConfig(runner: typeof runHermes): Promise<void> {
  const config = await runner(['config', 'get', 'kanban']);
  if (config.exitCode !== 0) throw new Error('hermes_kanban_config_unavailable');
  const values = parseYamlishConfig(config.stdout);
  if (values.dispatch_in_gateway === false) throw new Error('hermes_kanban_gateway_dispatch_disabled');
  if (values.auto_decompose === false) throw new Error('hermes_kanban_auto_decompose_disabled');
}

function requireCardMcpProjection(server: Record<string, unknown>): { url: string; bearer: string } {
  const url = String(server.url || '').trim();
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(url)) {
    throw new Error('hermes_kanban_card_runtime_mcp_invalid');
  }
  const headers = Array.isArray(server.headers) ? server.headers : [];
  const authorization = headers.find((header: any) => (
    String(header?.name || '').trim().toLowerCase() === 'authorization'
  ));
  const match = /^Bearer\s+(.+)$/.exec(String(authorization?.value || '').trim());
  if (!match?.[1]) throw new Error('hermes_kanban_card_runtime_bearer_missing');
  return { url, bearer: match[1] };
}

export function spawnRunScopedHermesGateway(
  envOverrides: NodeJS.ProcessEnv,
  processOptions: {
    bin?: string;
    args?: readonly string[];
    cwd?: string;
    inheritedEnv?: NodeJS.ProcessEnv;
  } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      processOptions.bin ?? HERMES_BIN,
      [...(processOptions.args ?? ['gateway', 'run'])],
      {
        cwd: processOptions.cwd ?? HERMES_ROOT,
        detached: true,
        env: {
          ...(processOptions.inheritedEnv ?? process.env),
          ...envOverrides,
          HERMES_HOME,
        },
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.once('error', (error) => {
      reject(new Error(`hermes_kanban_gateway_spawn_failed:${error.message}`));
    });
    child.once('spawn', () => {
      if (!child.pid) {
        reject(new Error('hermes_kanban_gateway_spawn_failed:missing_pid'));
        return;
      }
      child.unref();
      resolve(child.pid);
    });
  });
}

function nativeGatewayFailure(prefix: string, result: HermesExecResult): Error {
  const nativeDetail = `${result.stderr}\n${result.stdout}`.trim().replace(/\s+/g, ' ').slice(0, 1_000);
  return new Error(nativeDetail ? `${prefix}:${nativeDetail}` : prefix);
}

async function replaceNativeKanbanGateway(
  runner: typeof runHermes,
  bearer: string,
  spawnGateway: typeof spawnRunScopedHermesGateway,
): Promise<void> {
  const runEnvironment: NodeJS.ProcessEnv = {
    [KANBAN_CARD_MCP_TOKEN_ENV]: bearer,
    OPENAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    OPENROUTER_BASE_URL: '',
  };
  const stopped = await runner(
    ['gateway', 'stop'],
    HERMES_BIN,
    HERMES_GATEWAY_STOP_TIMEOUT_MS,
    runEnvironment,
  );
  if (stopped.exitCode !== 0) throw new Error('hermes_kanban_gateway_stop_failed');
  // On Windows the hermes.exe launcher hands off to the long-running Python
  // gateway process, so the launcher PID is diagnostic only. The native
  // readiness command is authoritative for the single live gateway PID.
  const launcherPid = await spawnGateway(runEnvironment);
  const deadline = Date.now() + HERMES_GATEWAY_STATUS_TIMEOUT_MS;
  let lastStatus: HermesExecResult = { exitCode: 0, stdout: '', stderr: '' };
  do {
    lastStatus = await runner(
      ['gateway', 'status'],
      HERMES_BIN,
      HERMES_GATEWAY_STATUS_TIMEOUT_MS,
      runEnvironment,
    );
    if (lastStatus.exitCode !== 0) {
      throw nativeGatewayFailure('hermes_kanban_gateway_readiness_check_failed', lastStatus);
    }
    const runningPids = hermesGatewayPids(lastStatus.stdout);
    if (runningPids.length === 1) return;
    if (runningPids.length > 1) {
      throw new Error(
        `hermes_kanban_gateway_overlap:launcher_${launcherPid}:native_${runningPids.join(',')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw nativeGatewayFailure('hermes_kanban_gateway_readiness_timeout', lastStatus);
}

export async function startNativeHermesKanbanTurn(
  args: HermesTurnArgs & { nativeMission: string },
  onEvent: (event: HermesSessionEvent) => void,
  options: {
    runner?: typeof runHermes;
    requestExtension?: typeof requestHermesExtension;
    cardMcpServer?: Record<string, unknown>;
    configureCardMcpProfile?: typeof configureHermesCardMcpProfile;
    spawnGateway?: typeof spawnRunScopedHermesGateway;
    onProgress?: (progress: HermesKanbanProgress) => Promise<void> | void;
  } = {},
): Promise<HermesTurnHandle> {
  if (args.runtime.mode !== 'kanban') throw new Error('hermes_native_kanban_mode_required');
  const profile = String(args.runtime.profile || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) {
    throw new Error('hermes_kanban_card_profile_invalid');
  }
  const runner = options.runner ?? runHermes;
  const acpRequest = options.requestExtension ?? requestHermesExtension;
  await requireNativeKanbanConfig(runner);
  const context = registerHermesRootExecutionContext({
    sessionId: `kanban:${args.parentRunId}`,
    runId: args.parentRunId,
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    cardId: args.cardId,
    runtimeMode: 'kanban',
    grantedTools: args.tools,
  });
  let contextState: 'completed' | 'failed' | 'cancelled' = 'failed';
  let cancelled = false;
  const releaseContext = (): Promise<void> => finishHermesExecutionContext({
    contextId: context.contextId,
    state: contextState,
  }).then(() => undefined);
  try {
    const server = options.cardMcpServer
      ?? buildHermesOfficialMcpServer(args, process.env, context.contextId);
    if (!server) throw new Error('hermes_kanban_card_runtime_mcp_missing');
    const cardMcp = requireCardMcpProjection(server);
    const configureProfile = options.configureCardMcpProfile ?? configureHermesCardMcpProfile;
    configureProfile({
      hermesRoot: HERMES_ROOT,
      runtimeHome: HERMES_HOME,
      profile,
      mcpUrl: cardMcp.url,
      mcpTokenEnv: KANBAN_CARD_MCP_TOKEN_ENV,
    });
    await replaceNativeKanbanGateway(
      runner,
      cardMcp.bearer,
      options.spawnGateway ?? spawnRunScopedHermesGateway,
    );

    const idempotencyKey = `liquidaity-${createHash('sha256')
      .update([args.projectId, args.deckId, args.cardId, args.nativeMission].join('\u0000'))
      .digest('hex')}`;
    const rootIdentity = {
      title: args.title,
      body: args.nativeMission,
      createdBy: args.cardId,
    };
    let found: any;
    try {
      found = await acpRequest('_kanban/find', rootIdentity);
    } catch {
      throw new Error('hermes_kanban_card_find_failed');
    }
    let taskId = String(found?.id || '').trim();
    if (!taskId) {
      let created: any;
      try {
        created = await acpRequest('_kanban/create', {
          ...rootIdentity,
          assignee: profile,
          idempotencyKey,
          model: args.providerModelId,
          provider: providerForHermes(args.provider, args.accessMode),
          skills: args.skills,
        });
      } catch {
        throw new Error('hermes_kanban_card_create_failed');
      }
      try { taskId = String(created?.id || '').trim(); } catch {
        throw new Error('hermes_kanban_card_create_response_invalid');
      }
    }
    if (!/^t_[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('hermes_kanban_card_task_id_invalid');
    const usage: HermesTurnUsage = {
      providerInputTokens: null,
      providerOutputTokens: null,
      totalCostUsd: null,
      usageAvailable: false,
      usageSource: 'hermes_native_kanban_unavailable',
      contextBreakdownJson: '',
    };
    const show = async (nativeTaskId: string) => (
      acpRequest('_kanban/show', { taskId: nativeTaskId }) as Promise<HermesKanbanTaskSnapshot>
    );
    const done: HermesTurnHandle['done'] = waitForHermesKanbanCardTask(profile, taskId, {
      cancelled: () => cancelled,
      show,
      onSnapshot: async (rootSnapshot) => {
        if (!options.onProgress) return;
        const snapshots = await readHermesKanbanTaskGraph(taskId, rootSnapshot, show);
        await options.onProgress(deriveHermesKanbanProgress(taskId, snapshots));
      },
    })
      .then((completed) => {
        const finalText = String(completed.snapshot.latest_summary || completed.snapshot.task.result || '').trim();
        contextState = 'completed';
        onEvent({ kind: 'text', text: finalText });
        onEvent({ kind: 'done', fullText: finalText, usage });
        return {
          finalText,
          usage,
          transport: {
            threadId: taskId,
            turnId: completed.runId === null ? null : String(completed.runId),
            authMode: null,
            planType: 'hermes-native-kanban',
            nativeTaskId: taskId,
            nativeRunId: completed.runId,
            nativeStatus: String(completed.snapshot.task.status || ''),
          },
        };
      })
      .catch((error) => {
        contextState = cancelled ? 'cancelled' : 'failed';
        const message = error instanceof Error ? error.message : String(error);
        onEvent({ kind: 'error', message, code: 'hermes_kanban_turn_failed' });
        throw error;
      })
      .finally(releaseContext);
    return {
      answer: () => undefined,
      cancel: () => { cancelled = true; },
      done,
      resolved: {
        cardId: args.cardId,
        provider: args.provider,
        modelKey: args.modelKey,
        providerModelId: args.providerModelId,
      },
      runtime: {
        executable: HERMES_BIN,
        pid: null,
        hermesHome: HERMES_HOME,
        sessionId: taskId,
        transport: 'hermes-kanban',
      },
    };
  } catch (error) {
    await releaseContext();
    throw error;
  }
}

/** Parse `hermes ... --json` stdout, tolerating a leading warning line. */
export function parseHermesJson<T>(stdout: string): T {
  const trimmed = stdout.trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) {
    throw new Error(`hermes_cli_json_not_found: ${trimmed.slice(0, 120)}`);
  }
  return JSON.parse(trimmed.slice(start)) as T;
}

export function parseYamlishConfig(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value === '' || value === 'null' || value === 'None') {
      out[key] = null;
    } else if (value === 'true') {
      out[key] = true;
    } else if (value === 'false') {
      out[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      out[key] = Number(value);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      out[key] = Number(value);
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      out[key] = value.slice(1, -1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Slice a plain-text `hermes profile list` table by header column offsets. */
export function parseProfileTable(text: string): {
  name: string;
  active: boolean;
  model: string;
  gateway: string;
  alias: string;
  distribution: string;
}[] {
  const rows: {
    name: string;
    active: boolean;
    model: string;
    gateway: string;
    alias: string;
    distribution: string;
  }[] = [];
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trimStart().startsWith('Profile'));
  if (headerIdx < 0) return rows;
  const header = lines[headerIdx];
  const offsets: { name: string; start: number }[] = [];
  for (const col of ['Profile', 'Model', 'Gateway', 'Alias', 'Distribution']) {
    const at = header.indexOf(col);
    if (at >= 0) offsets.push({ name: col, start: at });
  }
  if (offsets.length === 0) return rows;
  // Slice by ascending column offsets against the RAW line (both header and
  // data rows share the same leading column padding, so untrimmed slicing
  // keeps glyph alignment).
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim()) continue;
    // Skip only separator lines made of dash/box-drawing glyphs — data rows
    // may legitimately contain an em-dash in the Alias/Distribution columns.
    if (/^[\s─—\-·.]+$/.test(line)) continue;
    const slice = (col: string): string => {
      const idx = offsets.findIndex((o) => o.name === col);
      if (idx < 0) return '';
      const start = offsets[idx].start;
      const end = idx < offsets.length - 1 ? offsets[idx + 1].start : line.length;
      return line.slice(start, end).trim();
    };
    const rawName = slice('Profile');
    const active = rawName.includes('◆');
    rows.push({
      name: rawName.replace(/^[◆]/, '').trim(),
      active,
      model: slice('Model'),
      gateway: slice('Gateway'),
      alias: slice('Alias'),
      distribution: slice('Distribution'),
    });
  }
  return rows;
}

const router = Router();

function ok(res: Parameters<Parameters<Router['get']>[1]>[1], data: unknown) {
  res.json({ ok: true, data });
}

function fail(
  res: Parameters<Parameters<Router['get']>[1]>[1],
  status: number,
  error: string,
  detail?: unknown,
) {
  res.status(status).json({ ok: false, error, detail: detail ?? null });
}

// ── Read surface ─────────────────────────────────────────────────────────
router.get('/boards', async (_req, res) => {
  try {
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'boards',
      'list',
      '--json',
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_boards_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_boards_failed',
    );
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const board = String(req.query.board || '').trim();
    const includeArchived = req.query.includeArchived === 'true';
    const tenant = String(req.query.tenant || '').trim();
    const assignee = String(req.query.assignee || '').trim();
    const args = ['kanban'];
    if (board) args.push('--board', board);
    args.push('list', '--json');
    if (includeArchived) args.push('--archived');
    if (tenant) args.push('--tenant', tenant);
    if (assignee) args.push('--assignee', assignee);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_list_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson<unknown[]>(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_list_failed',
    );
  }
});

router.get('/tasks/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return fail(res, 400, 'hermes_kanban_task_id_required');
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'show', id, '--json']);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_show_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_show_failed',
    );
  }
});

router.get('/tasks/:id/runs', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return fail(res, 400, 'hermes_kanban_task_id_required');
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'runs', id, '--json']);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_runs_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_runs_failed',
    );
  }
});

router.get('/tasks/:id/attachments', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return fail(res, 400, 'hermes_kanban_task_id_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'attachments',
      id,
      '--json',
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_attachments_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_attachments_failed',
    );
  }
});

router.get('/stats', async (req, res) => {
  try {
    const board = String(req.query.board || '').trim();
    const args = ['kanban'];
    if (board) args.push('--board', board);
    args.push('stats', '--json');
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_stats_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_stats_failed',
    );
  }
});

router.get('/system', async (_req, res) => {
  try {
    // Each value is an independent native read. Start the cold CLI processes
    // together so gateway startup time does not delay every other probe, and
    // do not retry or cache an inconclusive result.
    const [gatewayRes, configRes, statsRes, diagRes, profilesRes] = await Promise.all([
      runHermes(['gateway', 'status'], HERMES_BIN, HERMES_GATEWAY_STATUS_TIMEOUT_MS),
      runHermes(['config', 'get', 'kanban']),
      runHermes(['kanban', 'stats', '--json']),
      runHermes(['kanban', 'diagnostics', '--json']),
      runHermes(['profile', 'list']),
    ]);
    const gatewayOut = gatewayRes.stdout.trim();
    // The native status line is the authoritative running signal. The Hermes
    // CLI may exit non-zero even while it prints "Gateway process running"
    // (it also checks the Windows login-item, which can fail independently),
    // so exit code alone is not a reliable proxy for process liveness.
    const running = isHermesGatewayRunning(gatewayOut);
    const pidMatch = gatewayOut.match(/PID:\s*(\d+)/i);
    const kanbanCfg = parseYamlishConfig(configRes.stdout);
    return ok(res, {
      gateway: {
        running,
        pid: pidMatch ? Number(pidMatch[1]) : null,
        raw: gatewayOut.slice(0, 400),
      },
      dispatcher: {
        running: running && kanbanCfg.dispatch_in_gateway !== false,
        dispatchInGateway: kanbanCfg.dispatch_in_gateway !== false,
        intervalSeconds: kanbanCfg.dispatch_interval_seconds ?? null,
        staleTimeoutSeconds: kanbanCfg.dispatch_stale_timeout_seconds ?? null,
      },
      stats: statsRes.exitCode === 0 ? parseHermesJson(statsRes.stdout) : null,
      diagnostics:
        diagRes.exitCode === 0 ? parseHermesJson<unknown[]>(diagRes.stdout) : [],
      profiles: parseProfileTable(profilesRes.stdout),
      now: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_system_failed',
    );
  }
});

router.get('/profiles', async (_req, res) => {
  try {
    const [listRes, configRes] = await Promise.all([
      runHermes(['profile', 'list']),
      runHermes(['config', 'get', 'kanban']),
    ]);
    const profiles = parseProfileTable(listRes.stdout);
    const kanbanCfg = parseYamlishConfig(configRes.stdout);
    const enriched: Record<string, unknown>[] = await Promise.all(
      profiles.map(async (p) => {
        let description = '';
        const desc = await runHermes(['profile', 'describe', p.name]);
        if (desc.exitCode === 0) description = desc.stdout.trim();
        return {
          ...p,
          description: description || null,
          defaultProfile: Boolean(p.active),
          concurrency:
            kanbanCfg.max_in_progress_per_profile ?? null,
        };
      }),
    );
    return ok(res, enriched);
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_profiles_failed',
    );
  }
});

router.get('/config', async (_req, res) => {
  try {
    const [kanbanRes, delegationRes] = await Promise.all([
      runHermes(['config', 'get', 'kanban']),
      runHermes(['config', 'get', 'delegation']),
    ]);
    return ok(res, {
      kanban:
        kanbanRes.exitCode === 0 ? parseYamlishConfig(kanbanRes.stdout) : {},
      delegation:
        delegationRes.exitCode === 0
          ? parseYamlishConfig(delegationRes.stdout)
          : {},
    });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_config_failed',
    );
  }
});

// ── Mutation surface (explicit user action only) ─────────────────────────
type PostBody = Record<string, unknown>;

function requireAnchor(body: PostBody, name: string): string | null {
  const value = String(body[name] ?? '').trim();
  return value || null;
}

router.post('/create', async (req, res) => {
  try {
    const b = (req.body || {}) as PostBody;
    const board = requireAnchor(b, 'board');
    const title = requireAnchor(b, 'title');
    if (!title) return fail(res, 400, 'hermes_kanban_create_title_required');
    const args = ['kanban'];
    if (board) args.push('--board', board);
    args.push('create', title, '--body', requireAnchor(b, 'body') ?? '');
    const assignee = requireAnchor(b, 'assignee');
    if (assignee) args.push('--assignee', assignee);
    const priority = Number(b.priority ?? 0);
    if (Number.isFinite(priority) && priority !== 0) {
      args.push('--priority', String(Math.trunc(priority)));
    }
    const parent = requireAnchor(b, 'parent');
    if (parent) args.push('--parent', parent);
    args.push('--json');
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_create_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_create_failed',
    );
  }
});

router.post('/tasks/:id/block', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const reason = String(b.reason ?? '').trim();
    const args = ['kanban', 'block', id, '--kind', String(b.kind ?? 'needs_input')];
    if (reason) args.push(reason);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_block_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_block_failed',
    );
  }
});

router.post('/tasks/:id/unblock', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const reason = String(b.reason ?? '');
    const args = ['kanban', 'unblock'];
    if (reason.trim()) args.push('--reason', reason.trim());
    args.push(id);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_unblock_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_unblock_failed',
    );
  }
});

router.post('/tasks/:id/archive', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'archive', id]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_archive_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_archive_failed',
    );
  }
});

router.post('/tasks/:id/promote', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'promote', id]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_promote_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_promote_failed',
    );
  }
});

router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const args = ['kanban', 'complete', id];
    const result = requireAnchor(b, 'result');
    if (result) args.push('--result', result);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_complete_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_complete_failed',
    );
  }
});

router.post('/tasks/:id/edit', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const result = requireAnchor(b, 'result');
    if (!result) return fail(res, 400, 'hermes_kanban_edit_result_required');
    const args = ['kanban', 'edit', id, '--result', result];
    const summary = requireAnchor(b, 'summary');
    if (summary) args.push('--summary', summary);
    const metadata = requireAnchor(b, 'metadata');
    if (metadata) args.push('--metadata', metadata);
    const { exitCode, stdout, stderr } = await runHermes(args);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_edit_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_edit_failed',
    );
  }
});

router.post('/tasks/:id/comment', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const text = requireAnchor(b, 'text');
    if (!text) return fail(res, 400, 'hermes_kanban_comment_text_required');
    const author = requireAnchor(b, 'author') || 'user';
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'comment',
      id,
      text,
      '--author',
      author,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_comment_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_comment_failed',
    );
  }
});

router.post('/tasks/:id/assign', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const assignee = requireAnchor(b, 'assignee');
    if (!assignee) return fail(res, 400, 'hermes_kanban_assignee_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'assign',
      id,
      assignee,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_assign_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_assign_failed',
    );
  }
});

router.post('/tasks/:id/link', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const parent = requireAnchor(b, 'parent');
    if (!parent) return fail(res, 400, 'hermes_kanban_link_parent_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'link',
      parent,
      id,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_link_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_link_failed',
    );
  }
});

router.post('/tasks/:id/unlink', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const b = (req.body || {}) as PostBody;
    const parent = requireAnchor(b, 'parent');
    if (!parent) return fail(res, 400, 'hermes_kanban_unlink_parent_required');
    const { exitCode, stdout, stderr } = await runHermes([
      'kanban',
      'unlink',
      parent,
      id,
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_unlink_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_unlink_failed',
    );
  }
});

router.post('/dispatch', async (_req, res) => {
  try {
    const { exitCode, stdout, stderr } = await runHermes(['kanban', 'dispatch', '--json']);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_kanban_dispatch_failed`, stderr.trim());
    }
    return ok(res, parseHermesJson(stdout));
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_kanban_dispatch_failed',
    );
  }
});

router.post('/gateway/restart', async (_req, res) => {
  try {
    const { exitCode, stdout, stderr } = await runHermes([
      'gateway',
      'restart',
    ]);
    if (exitCode !== 0) {
      return fail(res, 502, `hermes_gateway_restart_failed`, stderr.trim());
    }
    return ok(res, { stdout: stdout.trim() });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : 'hermes_gateway_restart_failed',
    );
  }
});

export default router;
