/*
 * Hermes Kanban task vocabulary retained for the Magnetic execution
 * adapter. These are transport contracts for Hermes-owned SQLite task state;
 * they do not define or authorize a saved-Card runtime mode.
 */

export const HERMES_KANBAN_TASK_STATUSES = [
  'triage', 'todo', 'scheduled', 'ready', 'running',
  'blocked', 'review', 'done', 'archived',
] as const;

export type HermesKanbanTaskStatus = typeof HERMES_KANBAN_TASK_STATUSES[number];

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
  handoffSummary: string | null;
};
