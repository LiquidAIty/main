import React, { useMemo } from 'react';

import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
} from '../../components/graph/graphVisualTokens';
import type {
  BoardFilters,
  KanbanBoardInfo,
  KanbanTask,
} from './types';
import {
  KANBAN_STATUS_LABELS,
  KANBAN_STATUSES,
} from './types';

type HermesKanbanBoardProps = {
  boards: KanbanBoardInfo[];
  currentBoard: string;
  onBoardChange: (slug: string) => void;
  tasks: KanbanTask[];
  search: string;
  onSearchChange: (value: string) => void;
  gatewayRunning: boolean;
  gatewayChecked: boolean;
  filters: BoardFilters;
  onFiltersChange: (patch: Partial<BoardFilters>) => void;
  onAddTask: () => void;
  addTaskTitle: string;
  onSelectTask: (taskId: string) => void;
  selectedTaskId: string | null;
  onBlankClick: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

const LANE_TONE: Record<string, string> = {
  triage: 'rgba(167,176,186,0.85)',
  todo: 'rgba(167,176,186,0.85)',
  scheduled: 'rgba(101,134,176,0.9)',
  ready: 'rgba(55,173,170,0.9)',
  running: 'rgba(242,166,74,0.92)',
  review: 'rgba(169,128,208,0.92)',
  blocked: 'rgba(224,108,108,0.95)',
  done: 'rgba(80,179,120,0.92)',
};

function statusTone(status: string): string {
  return LANE_TONE[status] || 'rgba(167,176,186,0.85)';
}

function timeAgo(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function TaskCard({
  task,
  selected,
  onSelect,
}: {
  task: KanbanTask;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  // Strong state only for running / blocked / failed / selected.
  const running = task.status === 'running';
  const blocked = task.status === 'blocked' || task.status === 'failed';
  const metaParts: string[] = [];
  if (task.assignee) metaParts.push(task.assignee);
  if (task.priority) metaParts.push(`p${task.priority}`);
  if (running && task.started_at) metaParts.push(`${timeAgo(task.started_at)} · running`);
  else if (task.created_at) metaParts.push(`created ${timeAgo(task.created_at)}`);
  const meta = metaParts.join(' · ');
  const accent = running
    ? 'rgba(242,166,74,0.7)'
    : blocked
      ? 'rgba(224,108,108,0.7)'
      : selected
        ? 'rgba(55,173,170,0.8)'
        : 'transparent';
  return (
    <button
      type="button"
      data-testid={`hermes-kanban-task-card-${task.id}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(task.id);
      }}
      title={task.title || task.id}
      aria-label={`${task.title || task.id}${meta ? ` — ${meta}` : ''}`}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        margin: '0 0 6px',
        padding: '7px 8px 7px 10px',
        borderRadius: 7,
        border: `1px solid ${selected ? 'rgba(55,173,170,0.5)' : 'rgba(167,176,186,0.16)'}`,
        borderLeft: `2px solid ${accent}`,
        background: selected ? 'rgba(55,173,170,0.08)' : 'rgba(17,22,29,0.66)',
        color: GRAPH_THEME.surface.text,
        cursor: 'pointer',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        transition: 'border-color 120ms ease',
      }}
    >
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.35,
          fontWeight: running || blocked ? 700 : 600,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
          color: running
            ? '#F2C787'
            : blocked
              ? '#E6A0A0'
              : GRAPH_THEME.surface.text,
        }}
      >
        {task.title || '(untitled)'}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 9,
          lineHeight: 1.3,
          color: GRAPH_THEME.surface.mutedText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        {task.id}
        {meta ? ` · ${meta}` : ''}
      </div>
    </button>
  );
}

export function groupByStatus(
  tasks: KanbanTask[],
): Map<string, KanbanTask[]> {
  const groups = new Map<string, KanbanTask[]>();
  for (const task of tasks) {
    const key = task.status || 'todo';
    const bucket = groups.get(key) || [];
    bucket.push(task);
    groups.set(key, bucket);
  }
  return groups;
}

export function groupByProfile(tasks: KanbanTask[]): Map<string, KanbanTask[]> {
  const groups = new Map<string, KanbanTask[]>();
  for (const task of tasks) {
    const key = task.assignee || 'default';
    const bucket = groups.get(key) || [];
    bucket.push(task);
    groups.set(key, bucket);
  }
  return groups;
}

function Lane({
  status,
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  status: string;
  tasks: KanbanTask[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}) {
  const running = status === 'running';
  const blocked = status === 'blocked';
  return (
    <section
      data-testid={`kanban-lane-${status}`}
      style={{
        flex: '0 0 236px',
        maxWidth: 236,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        border: '1px solid rgba(167,176,186,0.14)',
        background: 'rgba(17,22,29,0.5)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          padding: '8px 10px 6px',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: running || blocked ? 800 : 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: running
              ? '#F2C787'
              : blocked
                ? '#E6A0A0'
                : GRAPH_THEME.surface.text,
          }}
        >
          {KANBAN_STATUS_LABELS[status] || status}
        </span>
        <span
          data-testid={`kanban-lane-count-${status}`}
          aria-label={`${KANBAN_STATUS_LABELS[status] || status}: ${tasks.length}`}
          style={{
            fontSize: 10,
            color: GRAPH_THEME.surface.mutedText,
          }}
        >
          {tasks.length}
        </span>
      </header>
      <div
        className="hermes-kanban-lane-scroll"
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          padding: '2px 8px 6px',
          minHeight: 64,
        }}
      >
        {tasks.length === 0 ? (
          <div aria-label={`${KANBAN_STATUS_LABELS[status] || status}: empty`} />
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={selectedTaskId === task.id}
              onSelect={onSelectTask}
            />
          ))
        )}
      </div>
    </section>
  );
}

function LaneByStatusBoard({
  tasks,
  filters,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: KanbanTask[];
  filters: BoardFilters;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}) {
  const grouped = useMemo(() => groupByStatus(tasks), [tasks]);
  const lanes = useMemo(
    () => KANBAN_STATUSES.filter((status) => filters.visibleStatuses.has(status)),
    [filters.visibleStatuses],
  );
  return (
    <div className="hermes-kanban-lane-row" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', minWidth: 'max-content' }}>
      {lanes.map((status) => (
        <Lane
          key={status}
          status={status}
          tasks={grouped.get(status) || []}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
        />
      ))}
    </div>
  );
}

function LaneByProfileBoard({
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: KanbanTask[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}) {
  const byProfile = useMemo(() => groupByProfile(tasks), [tasks]);
  const profileNames = useMemo(() => [...byProfile.keys()], [byProfile]);
  return (
    <div className="hermes-kanban-lane-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', minWidth: 'max-content' }}>
      {profileNames.map((profile) => {
        const profileTasks = byProfile.get(profile) || [];
        const grouped = groupByStatus(profileTasks);
        const activeStatuses = [...grouped.keys()];
        return (
          <section
            key={profile}
            data-testid={`kanban-profile-${profile}`}
            style={{
              flex: '0 0 260px',
              maxWidth: 260,
              borderRadius: 10,
              border: '1px solid rgba(167,176,186,0.14)',
              background: 'rgba(17,22,29,0.5)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
          >
            <header
              style={{
                padding: '8px 10px 6px',
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: GRAPH_THEME.surface.text,
                }}
              >
                {profile}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: GRAPH_THEME.surface.mutedText,
                }}
              >
                {profileTasks.length}
              </span>
            </header>
            <div style={{ padding: '2px 8px 8px', maxHeight: '100%', overflowY: 'auto' }}>
              {activeStatuses.length === 0 ? (
                <div aria-label={`${profile}: no tasks`} />
              ) : (
                activeStatuses.map((status) => (
                  <div key={status} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color:
                          status === 'running' || status === 'blocked'
                            ? statusTone(status)
                            : GRAPH_THEME.surface.mutedText,
                        margin: '2px 0 4px',
                      }}
                    >
                      {KANBAN_STATUS_LABELS[status] || status} · {(grouped.get(status) || []).length}
                    </div>
                    {(grouped.get(status) || []).map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        selected={selectedTaskId === task.id}
                        onSelect={onSelectTask}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardHeader({
  boards,
  currentBoard,
  onBoardChange,
  search,
  onSearchChange,
  gatewayRunning,
  gatewayChecked,
  onAddTask,
  addTaskTitle,
  inspectorOpen,
  onToggleInspector,
}: {
  boards: KanbanBoardInfo[];
  currentBoard: string;
  onBoardChange: (slug: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  gatewayRunning: boolean;
  gatewayChecked: boolean;
  onAddTask: () => void;
  addTaskTitle: string;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  const inputStyle = graphDrawerInputStyle();
  return (
    <header
      data-testid="hermes-kanban-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderBottom: `1px solid ${GRAPH_THEME.drawer.panelBorder}`,
        background: 'transparent',
        flexWrap: 'wrap',
      }}
    >
      <select
        aria-label="Board"
        data-testid="hermes-kanban-board-select"
        value={currentBoard}
        onChange={(e) => onBoardChange(e.target.value)}
        style={{ ...inputStyle, maxWidth: 180 }}
      >
        {boards.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.name || b.slug}
          </option>
        ))}
      </select>

      <input
        data-testid="hermes-kanban-search"
        aria-label="Search tasks"
        placeholder="Search…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ ...inputStyle, width: 160, flexGrow: 1, maxWidth: 280, minWidth: 100 }}
      />

      <span
        data-testid="hermes-kanban-gateway-status"
        role="status"
        aria-label={
          gatewayChecked
            ? gatewayRunning
              ? 'Gateway running'
              : 'Gateway stopped'
            : 'Gateway status unknown'
        }
        title={
          gatewayChecked
            ? gatewayRunning
              ? 'Gateway running'
              : 'Gateway stopped'
            : 'Checking gateway…'
        }
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: gatewayChecked ? (gatewayRunning ? '#63D8A0' : '#E06C6C') : '#4A5560',
            boxShadow: gatewayRunning ? '0 0 8px rgba(99,216,160,0.7)' : 'none',
            transition: 'background 160ms ease',
          }}
        />
      </span>

      <button
        type="button"
        data-testid="hermes-kanban-add-task"
        aria-label="Add task"
        title={addTaskTitle}
        onClick={onAddTask}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 7,
          border: '1px solid rgba(167,176,186,0.3)',
          background: 'transparent',
          color: GRAPH_THEME.surface.mutedText,
          fontSize: 17,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">+</span>
      </button>

      <button
        type="button"
        data-testid="hermes-kanban-inspector-toggle"
        aria-pressed={inspectorOpen}
        aria-label={inspectorOpen ? 'Close inspector' : 'Open inspector'}
        title={inspectorOpen ? 'Close inspector' : 'Open inspector'}
        onClick={onToggleInspector}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 7,
          border: inspectorOpen
            ? '1px solid rgba(55,173,170,0.45)'
            : '1px solid rgba(167,176,186,0.3)',
          background: 'transparent',
          color: inspectorOpen ? '#7DE0DA' : GRAPH_THEME.surface.mutedText,
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          style={{ display: 'inline-block', width: 9, height: 9, border: '1.5px solid currentColor', borderRadius: 2 }}
        />
      </button>
    </header>
  );
}

export default function HermesKanbanBoard({
  boards,
  currentBoard,
  onBoardChange,
  tasks,
  search,
  onSearchChange,
  gatewayRunning,
  gatewayChecked,
  filters,
  onFiltersChange,
  onAddTask,
  addTaskTitle,
  onSelectTask,
  selectedTaskId,
  onBlankClick,
  inspectorOpen,
  onToggleInspector,
  loading,
  error,
  onRetry,
}: HermesKanbanBoardProps) {
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => {
      const haystack = [task.id, task.title, task.body, task.assignee, task.tenant]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      // Plain substring filter — presentation only, no routing/classifying.
      return haystack.includes(q);
    });
  }, [search, tasks]);

  return (
    <div
      data-testid="hermes-kanban-board"
      onClick={onBlankClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'transparent',
      }}
    >
      <BoardHeader
        boards={boards}
        currentBoard={currentBoard}
        onBoardChange={onBoardChange}
        search={search}
        onSearchChange={onSearchChange}
        gatewayRunning={gatewayRunning}
        gatewayChecked={gatewayChecked}
        onAddTask={onAddTask}
        addTaskTitle={addTaskTitle}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
      />

      {loading ? (
        <div
          data-testid="hermes-kanban-loading"
          style={{ padding: '14px 16px', color: GRAPH_THEME.surface.mutedText, fontSize: 12 }}
        >
          Loading…
        </div>
      ) : null}

      {error ? (
        <div
          data-testid="hermes-kanban-error"
          role="alert"
          style={{
            margin: '10px 14px',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(224,108,108,0.35)',
            background: 'rgba(224,108,108,0.08)',
            color: '#F1A9A9',
            fontSize: 11,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            maxWidth: 520,
          }}
        >
          <div>{error}</div>
          <button
            type="button"
            data-testid="hermes-kanban-retry"
            onClick={onRetry}
            style={graphDrawerButtonStyle({ marginTop: 8, color: '#F1A9A9' })}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="hermes-kanban-lane-scroll-x" style={{ flex: '1 1 auto', minHeight: 0, overflowX: 'auto', overflowY: 'auto' }}>
          {tasks.length === 0 ? (
            <div
              data-testid="hermes-kanban-empty"
              style={{
                padding: '12px 16px',
                color: GRAPH_THEME.surface.mutedText,
                fontSize: 12,
              }}
            >
              No tasks on this board{search ? ' matching the search' : ''}.
            </div>
          ) : null}
          {filters.lanesByProfile ? (
            <LaneByProfileBoard tasks={filteredTasks} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
          ) : (
            <LaneByStatusBoard tasks={filteredTasks} filters={filters} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
          )}
        </div>
      ) : null}
    </div>
  );
}
