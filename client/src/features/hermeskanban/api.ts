// Hermes Kanban API client — the ONE transport to the authenticated
// /api/hermes-kanban bridge. Browser never executes the Hermes CLI and never
// touches kanban.db directly. Failures surface as thrown Error with an honest
// code; no mocks, no fallbacks, no second store.

import type {
  BoardFilters,
  HermesApiEnvelope,
  HermesConfig,
  HermesSystemStatus,
  KanbanBoardInfo,
  KanbanShow,
  KanbanStats,
  KanbanTask,
  ProfileInfo,
} from './types';

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`hermes_kanban_http_${response.status}`);
  }
  const body = (await response.json()) as HermesApiEnvelope<T>;
  if (!body || body.ok !== true) {
    throw new Error(
      (body && 'error' in body ? body.error : undefined) || 'hermes_kanban_bad_envelope',
    );
  }
  return body.data;
}

async function mutate<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`hermes_kanban_http_${response.status}`);
  }
  const body = (await response.json()) as HermesApiEnvelope<T>;
  if (!body || body.ok !== true) {
    throw new Error(
      (body && 'error' in body ? body.error : undefined) || 'hermes_kanban_mutation_failed',
    );
  }
  return body.data;
}

function tasksQuery(filters: {
  board?: string;
  includeArchived?: boolean;
  assignee?: string;
  tenant?: string;
}): string {
  const params = new URLSearchParams();
  if (filters.board) params.set('board', filters.board);
  if (filters.includeArchived) params.set('includeArchived', 'true');
  if (filters.assignee) params.set('assignee', filters.assignee);
  if (filters.tenant) params.set('tenant', filters.tenant);
  const q = params.toString();
  return q ? `/api/hermes-kanban/tasks?${q}` : '/api/hermes-kanban/tasks';
}

export function filterToQuery(f: BoardFilters): {
  board?: string;
  includeArchived?: boolean;
  assignee?: string;
  tenant?: string;
} {
  return {
    includeArchived: f.includeArchived,
    assignee: f.assignee.trim() || undefined,
    tenant: f.tenant.trim() || undefined,
  };
}

export const hermesKanbanApi = {
  boards: (): Promise<KanbanBoardInfo[]> => read('/api/hermes-kanban/boards'),
  tasks: (filters: { board?: string; includeArchived?: boolean; assignee?: string; tenant?: string }): Promise<KanbanTask[]> =>
    read<KanbanTask[]>(tasksQuery(filters)),
  task: (id: string): Promise<KanbanShow> => read(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}`),
  stats: (board?: string): Promise<KanbanStats> =>
    read<KanbanStats>(`/api/hermes-kanban/stats${board ? `?board=${encodeURIComponent(board)}` : ''}`),
  system: (): Promise<HermesSystemStatus> => read('/api/hermes-kanban/system'),
  profiles: (): Promise<ProfileInfo[]> => read('/api/hermes-kanban/profiles'),
  config: (): Promise<HermesConfig> => read('/api/hermes-kanban/config'),

  create: (payload: { board?: string; title: string; body?: string; assignee?: string; priority?: number; parent?: string }): Promise<unknown> =>
    mutate('/api/hermes-kanban/create', payload),
  comment: (id: string, text: string, author?: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/comment`, { text, author }),
  block: (id: string, reason: string, kind?: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/block`, { reason, kind }),
  unblock: (id: string, reason?: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/unblock`, { reason }),
  archive: (id: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/archive`, {}),
  promote: (id: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/promote`, {}),
  complete: (id: string, result?: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/complete`, { result }),
  reclaim: (id: string, reason?: string): Promise<KanbanShow> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/reclaim`, { reason }),
  terminateRun: (runId: string, reason?: string): Promise<KanbanShow> =>
    mutate(`/api/hermes-kanban/runs/${encodeURIComponent(runId)}/terminate`, { reason }),
  edit: (id: string, p: { result: string; summary?: string; metadata?: string }): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/edit`, p),
  assign: (id: string, assignee: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/assign`, { assignee }),
  link: (id: string, parent: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/link`, { parent }),
  unlink: (id: string, parent: string): Promise<unknown> =>
    mutate(`/api/hermes-kanban/tasks/${encodeURIComponent(id)}/unlink`, { parent }),
  dispatch: (): Promise<unknown> => mutate('/api/hermes-kanban/dispatch', {}),
  restartGateway: (): Promise<unknown> => mutate('/api/hermes-kanban/gateway/restart', {}),
};
