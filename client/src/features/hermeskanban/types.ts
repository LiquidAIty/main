// Hermes Kanban feature types — shapes mirror the native `hermes kanban`
// JSON surface (see apps/backend/src/routes/hermesKanban.routes.ts). No logic
// here: TS is transport/pixels only (DONT.md rule 5).

export type KanbanBoardInfo = {
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  default_workdir?: string | null;
  project_id?: string | null;
  created_at?: number | null;
  archived?: boolean;
  db_path?: string | null;
  is_current: boolean;
  counts: Record<string, number>;
  total: number;
};

export type KanbanTask = {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number | null;
  tenant: string | null;
  workspace_kind: string | null;
  workspace_path: string | null;
  branch_name: string | null;
  project_id: string | null;
  created_by: string | null;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  skills: string[];
  max_retries: number | null;
  model_override: string | null;
  provider_override: string | null;
  session_id: string | null;
  workflow_template_id: string | null;
  current_step_key: string | null;
  [key: string]: unknown;
};

export type KanbanComment = {
  author: string | null;
  body: string;
  created_at: number | null;
};

export type KanbanEvent = {
  kind: string;
  payload: Record<string, unknown>;
  created_at: number | null;
  run_id: string | null;
};

export type KanbanRun = {
  id?: string;
  run_id?: string;
  task_id?: string;
  status?: string;
  started_at?: number | null;
  ended_at?: number | string | null;
  completed_at?: number | null;
  outcome?: string | null;
  exit_code?: number | null;
  pid?: number | null;
  profile?: string | null;
  [key: string]: unknown;
};

/** `hermes kanban show <id> --json` — the complete task dossier. */
export type KanbanShow = {
  task: KanbanTask;
  latest_summary: string | null;
  parents: string[];
  children: string[];
  comments: KanbanComment[];
  events: KanbanEvent[];
  runs: KanbanRun[];
};

export type KanbanStats = {
  by_status: Record<string, number>;
  by_assignee: Record<string, Record<string, number>>;
  oldest_ready_age_seconds: number | null;
  now: number;
};

export type ProfileInfo = {
  name: string;
  active: boolean;
  model: string;
  gateway: string;
  alias: string;
  distribution: string;
  description?: string | null;
  defaultProfile?: boolean;
  concurrency?: number | null;
};

export type HermesSystemStatus = {
  gateway: { running: boolean; pid: number | null; raw: string };
  dispatcher: {
    running: boolean;
    dispatchInGateway: boolean;
    intervalSeconds: number | null;
    staleTimeoutSeconds: number | null;
  };
  stats: KanbanStats | null;
  diagnostics: unknown[];
  profiles: ProfileInfo[];
  now: number;
};

export type HermesConfig = {
  kanban: Record<string, unknown>;
  delegation: Record<string, unknown>;
};

export type BoardFilters = {
  includeArchived: boolean;
  assignee: string;
  tenant: string;
  lanesByProfile: boolean;
  visibleStatuses: Set<string>;
};

/** Native statuses returned by the installed Hermes version. */
export const KANBAN_STATUSES = [
  'triage',
  'todo',
  'scheduled',
  'ready',
  'running',
  'review',
  'blocked',
  'done',
] as const;

export const KANBAN_STATUS_LABELS: Record<string, string> = {
  triage: 'Triage',
  todo: 'Todo',
  scheduled: 'Scheduled',
  ready: 'Ready',
  running: 'In Progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
  archived: 'Archived',
};

export type HermesInspectorMode = 'board' | 'task' | 'worker';

export type HermesApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; detail?: unknown };
