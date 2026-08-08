import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GRAPH_THEME, graphDrawerButtonStyle, graphDrawerInputStyle } from '../../components/graph/graphVisualTokens';
import HermesKanbanBoard from './HermesKanbanBoard';
import HermesKanbanInspector from './HermesKanbanInspector';
import type { TaskTabActions } from './KanbanTaskTabs';
import { hermesKanbanApi, filterToQuery } from './api';
import type {
  BoardFilters,
  HermesConfig,
  HermesInspectorMode,
  HermesSystemStatus,
  KanbanBoardInfo,
  KanbanShow,
  KanbanStats,
  KanbanTask,
  ProfileInfo,
} from './types';
import { KANBAN_STATUSES } from './types';

export type HermesKanbanWorkspaceProps = {
  onClose: () => void;
  onOpenTerminal?: () => void;
  focusedCardId?: string | null;
};

const DEFAULT_FILTERS: BoardFilters = {
  includeArchived: false,
  assignee: '',
  tenant: '',
  lanesByProfile: false,
  visibleStatuses: new Set(KANBAN_STATUSES),
};

function AddTaskForm({
  busy,
  profiles,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  profiles: ProfileInfo[];
  onCancel: () => void;
  onSubmit: (title: string, body: string, assignee: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignee, setAssignee] = useState('');
  return (
    <div
      data-testid="hermes-kanban-add-task-form"
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(126,232,226,0.12)',
        background: 'linear-gradient(145deg, rgba(29,43,52,0.5), rgba(12,19,25,0.3))',
        display: 'grid',
        gap: 7,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: '#7DE0DA', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Add Task
      </div>
      <input
        data-testid="hermes-kanban-new-task-title"
        autoFocus
        placeholder="Task title (required)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={graphDrawerInputStyle()}
      />
      <textarea
        data-testid="hermes-kanban-new-task-body"
        placeholder="Optional body / brief"
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ ...graphDrawerInputStyle(), resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          data-testid="hermes-kanban-new-task-assignee"
          list="hermes-kanban-assignee-list"
          placeholder="assignee (optional)"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          style={{ ...graphDrawerInputStyle(), flex: 1 }}
        />
        <datalist id="hermes-kanban-assignee-list">
          {profiles.map((p) => (
            <option key={p.name} value={p.name} />
          ))}
        </datalist>
        <button
          type="button"
          data-testid="hermes-kanban-new-task-cancel"
          onClick={onCancel}
          disabled={busy}
          style={graphDrawerButtonStyle({ color: GRAPH_THEME.surface.mutedText, borderColor: 'rgba(167,176,186,0.3)' })}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="hermes-kanban-new-task-submit"
          disabled={busy || !title.trim()}
          onClick={() => onSubmit(title.trim(), body.trim(), assignee.trim())}
          style={graphDrawerButtonStyle({ color: '#7DE0DA' })}
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

export default function HermesKanbanWorkspace({
  onClose,
  onOpenTerminal,
}: HermesKanbanWorkspaceProps) {
  const [boards, setBoards] = useState<KanbanBoardInfo[]>([]);
  const [currentBoard, setCurrentBoard] = useState<string>('');
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [stats, setStats] = useState<KanbanStats | null>(null);
  const [system, setSystem] = useState<HermesSystemStatus | null>(null);
  const [config, setConfig] = useState<HermesConfig | null>(null);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<HermesInspectorMode>('board');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskShow, setTaskShow] = useState<KanbanShow | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [workerRun, setWorkerRun] = useState<Record<string, unknown> | null>(null);

  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const taskShowRef = useRef<KanbanShow | null>(null);
  taskShowRef.current = taskShow;

  const busy = useCallback((key: string) => busyKeys.has(key), [busyKeys]);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusyKeys((prev) => new Set(prev).add(key));
      setActionMessage(null);
      try {
        await fn();
        setActionMessage(`${key} done.`);
      } catch (error) {
        setActionMessage(
          `${key} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setBusyKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const reloadTasks = useCallback(async (board: string) => {
    setLoading(true);
    setBoardError(null);
    try {
      const query = filterToQuery(filtersRef.current);
      const [taskList, statsData] = await Promise.all([
        hermesKanbanApi.tasks({ board, ...query }),
        hermesKanbanApi.stats(board),
      ]);
      setTasks(taskList);
      setStats(statsData);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadTask = useCallback(async (taskId: string) => {
    setTaskLoading(true);
    setTaskError(null);
    try {
      const show = await hermesKanbanApi.task(taskId);
      setTaskShow(show);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setTaskLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setBoardError(null);
    try {
      const [boardList, systemData, configData, profileList] = await Promise.all([
        hermesKanbanApi.boards(),
        hermesKanbanApi.system(),
        hermesKanbanApi.config(),
        hermesKanbanApi.profiles(),
      ]);
      setBoards(boardList);
      setSystem(systemData);
      setConfig(configData);
      setProfiles(profileList);
      const nextBoard =
        boardList.find((b) => b.is_current)?.slug ||
        boardList[0]?.slug ||
        '';
      setCurrentBoard((prev) => (prev && boardList.some((b) => b.slug === prev) ? prev : nextBoard));
      if (boardList.length > 0) {
        void reloadTasks(nextBoard);
      } else {
        setLoading(false);
      }
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }, [reloadTasks]);

  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    void loadAll();
  }, [loadAll]);

  const handleBoardChange = useCallback(
    (slug: string) => {
      setCurrentBoard(slug);
      setTasks([]);
      setSelectedTaskId(null);
      setTaskShow(null);
      setInspectorMode('board');
      void reloadTasks(slug);
    },
    [reloadTasks],
  );

  const handleRefresh = useCallback(() => {
    void runAction('refresh', async () => {
      await loadAll();
      if (currentBoard) await reloadTasks(currentBoard);
    });
  }, [currentBoard, loadAll, reloadTasks, runAction]);

  const handleSelectTask = useCallback(
    (taskId: string) => {
      setSelectedTaskId(taskId);
      setWorkerRun(null);
      setInspectorMode('task');
      setInspectorOpen(true);
      void reloadTask(taskId);
    },
    [reloadTask],
  );

  const handleOpenWorker = useCallback(
    (runId: string) => {
      if (!runId) {
        setInspectorMode('task');
        return;
      }
      const run = taskShowRef.current?.runs.find(
        (r) => String(r.run_id || r.id || '') === runId,
      );
      setWorkerRun(run || null);
      setInspectorMode('worker');
    },
    [],
  );

  const handleBlankClick = useCallback(() => {
    setSelectedTaskId(null);
    setTaskShow(null);
    setWorkerRun(null);
    setInspectorMode('board');
  }, []);

  const handleToggleInspector = useCallback(() => {
    setInspectorOpen((prev) => !prev);
  }, []);

  const onFiltersChange = useCallback((patch: Partial<BoardFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Reload when filters that hit the backend change (archived/assignee/tenant).
  const filterApplied = useMemo(
    () => ({
      includeArchived: filters.includeArchived,
      assignee: filters.assignee,
      tenant: filters.tenant,
    }),
    [filters.assignee, filters.includeArchived, filters.tenant],
  );
  useEffect(() => {
    if (!currentBoard) return;
    const timer = window.setTimeout(() => {
      void reloadTasks(currentBoard);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [currentBoard, filterApplied, reloadTasks]);

  const taskActions: TaskTabActions = useMemo(() => {
    const id = selectedTaskId;
    return {
      busy,
      onEdit: (result, summary) =>
        void runAction('edit', async () => {
          if (!id) return;
          await hermesKanbanApi.edit(id, { result, summary });
          await reloadTask(id);
        }),
      onBlock: (reason) =>
        void runAction('block', async () => {
          if (!id) return;
          await hermesKanbanApi.block(id, reason);
          await reloadTask(id);
        }),
      onUnblock: (reason) =>
        void runAction('unblock', async () => {
          if (!id) return;
          await hermesKanbanApi.unblock(id, reason);
          await reloadTask(id);
        }),
      onPromote: () =>
        void runAction('promote', async () => {
          if (!id) return;
          await hermesKanbanApi.promote(id);
          await reloadTask(id);
        }),
      onComplete: (result) =>
        void runAction('complete', async () => {
          if (!id) return;
          await hermesKanbanApi.complete(id, result);
          await reloadTask(id);
        }),
      onArchive: () =>
        void runAction('archive', async () => {
          if (!id) return;
          await hermesKanbanApi.archive(id);
          setInspectorMode('board');
        }),
      onComment: (text) =>
        void runAction('comment', async () => {
          if (!id) return;
          await hermesKanbanApi.comment(id, text);
          await reloadTask(id);
        }),
      onAssign: (assignee) =>
        void runAction('assign', async () => {
          if (!id) return;
          await hermesKanbanApi.assign(id, assignee);
          await reloadTask(id);
        }),
      onLink: (parent) =>
        void runAction('link', async () => {
          if (!id) return;
          await hermesKanbanApi.link(id, parent);
          await reloadTask(id);
        }),
      onUnlink: (parent) =>
        void runAction('unlink', async () => {
          if (!id) return;
          await hermesKanbanApi.unlink(id, parent);
          await reloadTask(id);
        }),
      onOpenWorker: handleOpenWorker,
    };
  }, [busy, handleOpenWorker, reloadTask, runAction, selectedTaskId]);

  const assignees = useMemo(() => {
    const names = new Set<string>(['default']);
    for (const p of profiles) names.add(p.name);
    for (const t of tasks) if (t.assignee) names.add(t.assignee);
    return [...names];
  }, [profiles, tasks]);

  const handleAddTaskSubmit = useCallback(
    (title: string, body: string, assignee: string) => {
      void runAction('create', async () => {
        await hermesKanbanApi.create({
          board: currentBoard || undefined,
          title,
          body: body || undefined,
          assignee: assignee || undefined,
        });
        setAddTaskOpen(false);
        await reloadTasks(currentBoard);
      });
    },
    [currentBoard, reloadTasks, runAction],
  );

  const gatewayRunning = Boolean(system?.gateway.running);
  const gatewayChecked = system !== null;

  return (
    <div
      data-testid="hermes-kanban-workspace"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: GRAPH_THEME.background.agentSurface,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 10,
          zIndex: 20,
          display: 'flex',
          gap: 6,
        }}
      >
        {onOpenTerminal ? (
          <button
            type="button"
            data-testid="hermes-terminal-open"
            aria-label="Open installed Hermes terminal"
            title="Open installed Hermes terminal"
            onClick={onOpenTerminal}
            style={graphDrawerButtonStyle({ color: '#7DE0DA' })}
          >
            Terminal
          </button>
        ) : null}
        <button
          type="button"
          data-testid="hermes-kanban-close"
          aria-label="Close board workspace"
          title="Close board workspace"
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 6,
            border: '1px solid rgba(167,176,186,0.28)',
            background: 'rgba(11,14,18,0.5)',
            color: GRAPH_THEME.surface.mutedText,
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {addTaskOpen ? (
        <AddTaskForm
          busy={busy('create')}
          profiles={profiles}
          onCancel={() => setAddTaskOpen(false)}
          onSubmit={handleAddTaskSubmit}
        />
      ) : null}

      <HermesKanbanBoard
        boards={boards}
        currentBoard={currentBoard}
        onBoardChange={handleBoardChange}
        tasks={tasks}
        search={search}
        onSearchChange={setSearch}
        gatewayRunning={gatewayRunning}
        gatewayChecked={gatewayChecked}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onAddTask={() => {
          if (!addTaskOpen) setAddTaskOpen(true);
        }}
        addTaskTitle={boards.length === 0 ? 'No board loaded yet' : `Add a task to ${currentBoard}`}
        onSelectTask={handleSelectTask}
        selectedTaskId={selectedTaskId}
        onBlankClick={handleBlankClick}
        inspectorOpen={inspectorOpen}
        onToggleInspector={handleToggleInspector}
        loading={loading}
        error={boardError}
        onRetry={handleRefresh}
      />

      {actionMessage ? (
        <div
          data-testid="hermes-kanban-action-message"
          style={{
            position: 'absolute',
            left: 14,
            bottom: 40,
            padding: '6px 11px',
            borderRadius: 8,
            border: '1px solid rgba(55,173,170,0.35)',
            background: 'rgba(11,14,18,0.92)',
            color: GRAPH_THEME.surface.text,
            fontSize: 11,
            maxWidth: '70%',
            zIndex: 12,
          }}
        >
          {actionMessage}
        </div>
      ) : null}

      <HermesKanbanInspector
        open={inspectorOpen}
        mode={inspectorMode}
        onOpen={() => setInspectorOpen(true)}
        onClose={() => setInspectorOpen(false)}
        boardTabProps={{
          boards,
          currentBoard,
          filters,
          onFiltersChange,
          actions: {
            onRefresh: handleRefresh,
            onNudge: () => void runAction('nudge', () => hermesKanbanApi.dispatch()),
            onRestartGateway: () =>
              void runAction('restart-gateway', () => hermesKanbanApi.restartGateway()),
            busy,
          },
        }}
        orchestration={config}
        profiles={profiles}
        system={system}
        taskShow={taskShow}
        taskLoading={taskLoading}
        taskError={taskError}
        assignees={assignees}
        taskActions={taskActions}
        workerRun={workerRun}
      />
    </div>
  );
}
