import {
  createInternalMcpBearer,
  type InternalMcpPrincipal,
} from '../services/mcp/internalMcpAuth';
import { requestHermesExtension } from './mainAdapter';
import {
  resolveHermesKanbanCardExecutionContext,
  type HermesKanbanCardExecutionContext,
  type HermesKanbanTaskSnapshot,
} from '../routes/hermesKanban.routes';

export type HermesKanbanWorkerIdentity = {
  taskId: string;
  nativeRunId: string;
  board: string;
  assignee: string;
  profile: string;
  workspace: string;
  claimLock: string;
};

export class HermesKanbanWorkerNotCorrelatedError extends Error {
  constructor() {
    super('hermes_kanban_worker_not_correlated');
  }
}

function required(value: unknown, error: string, maxLength = 512): string {
  const resolved = String(value || '').trim();
  if (!resolved || resolved.length > maxLength || resolved.includes('\0')) {
    throw new Error(error);
  }
  return resolved;
}

export function normalizeHermesKanbanWorkerIdentity(
  value: Partial<HermesKanbanWorkerIdentity>,
): HermesKanbanWorkerIdentity {
  const taskId = required(value.taskId, 'hermes_kanban_worker_task_id_invalid', 96);
  const nativeRunId = required(value.nativeRunId, 'hermes_kanban_worker_run_id_invalid', 32);
  const board = required(value.board, 'hermes_kanban_worker_board_invalid', 64).toLowerCase();
  const assignee = required(value.assignee, 'hermes_kanban_worker_assignee_invalid', 64).toLowerCase();
  const profile = required(value.profile, 'hermes_kanban_worker_profile_invalid', 64).toLowerCase();
  const workspace = required(value.workspace, 'hermes_kanban_worker_workspace_invalid', 2_048);
  const claimLock = required(value.claimLock, 'hermes_kanban_worker_claim_lock_invalid', 512);
  if (!/^t_[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('hermes_kanban_worker_task_id_invalid');
  if (!/^[1-9][0-9]*$/.test(nativeRunId)) throw new Error('hermes_kanban_worker_run_id_invalid');
  const slug = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  if (!slug.test(board)) throw new Error('hermes_kanban_worker_board_invalid');
  if (!slug.test(assignee)) throw new Error('hermes_kanban_worker_assignee_invalid');
  if (!slug.test(profile) || profile !== assignee) {
    throw new Error('hermes_kanban_worker_profile_mismatch');
  }
  if (/\s/.test(claimLock) || !claimLock.includes(':')) {
    throw new Error('hermes_kanban_worker_claim_lock_invalid');
  }
  return { taskId, nativeRunId, board, assignee, profile, workspace, claimLock };
}

function isNotCorrelated(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error)
    .includes('hermes_kanban_card_run_not_found');
}

export async function issueHermesKanbanWorkerBearer(args: {
  identity: Partial<HermesKanbanWorkerIdentity>;
  show?: (taskId: string) => Promise<HermesKanbanTaskSnapshot>;
  resolveRun?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  mint?: (principal: InternalMcpPrincipal, env?: NodeJS.ProcessEnv) => string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ bearer: string; context: HermesKanbanCardExecutionContext }> {
  const identity = normalizeHermesKanbanWorkerIdentity(args.identity);
  let claimedSnapshot: HermesKanbanTaskSnapshot | null = null;
  const show = args.show ?? (async (taskId: string) => (
    requestHermesExtension('_kanban/show', { taskId }) as Promise<HermesKanbanTaskSnapshot>
  ));
  const captureShow = async (taskId: string): Promise<HermesKanbanTaskSnapshot> => {
    const snapshot = await show(taskId);
    if (taskId === identity.taskId) claimedSnapshot = snapshot;
    return snapshot;
  };

  let context: HermesKanbanCardExecutionContext;
  try {
    context = await resolveHermesKanbanCardExecutionContext({
      taskId: identity.taskId,
      show: captureShow,
      resolveRun: args.resolveRun,
    });
  } catch (error) {
    if (isNotCorrelated(error)) throw new HermesKanbanWorkerNotCorrelatedError();
    throw error;
  }

  const snapshot = claimedSnapshot as HermesKanbanTaskSnapshot | null;
  const task = snapshot?.task;
  const run = snapshot?.runs.at(-1);
  if (
    !task
    || !run
    || String(task.status || '').trim().toLowerCase() !== 'running'
    || String(task.assignee || '').trim().toLowerCase() !== identity.assignee
    || String(task.current_run_id || '').trim() !== identity.nativeRunId
    || String(task.claim_lock || '').trim() !== identity.claimLock
    || String(run.id || '').trim() !== identity.nativeRunId
    || String(run.profile || '').trim().toLowerCase() !== identity.profile
    || String(run.claim_lock || '').trim() !== identity.claimLock
    || run.ended_at != null
    || (context.runtimeProfile && context.runtimeProfile.toLowerCase() !== identity.profile)
  ) {
    throw new Error('hermes_kanban_worker_native_claim_mismatch');
  }

  const principal: InternalMcpPrincipal = {
    kind: 'card-runtime',
    projectId: context.projectId,
    deckId: context.deckId,
    conversationId: context.conversationId,
    parentRunId: context.runId,
    callerCardId: context.cardId,
    callerRuntimeKind: 'hermes',
    callerRuntimeMode: 'kanban',
    grantedTools: context.grantedTools,
    requiresExecutionContext: false,
    nativeChildId: context.nativeChildId,
    nativeRunId: identity.nativeRunId,
  };
  const bearer = (args.mint ?? createInternalMcpBearer)(principal, args.env);
  return { bearer, context };
}
