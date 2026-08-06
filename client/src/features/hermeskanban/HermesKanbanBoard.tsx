import React, { useMemo } from 'react';

import { GRAPH_THEME } from '../../components/graph/graphVisualTokens';
import type {
  BoardFilters,
  KanbanBoardInfo,
  KanbanStats,
  KanbanTask,
  ProfileInfo,
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
  stats: KanbanStats | null;
  search: string;
  onSearchChange: (value: string) => void;
  gatewayRunning: boolean;
  gatewayChecked: boolean;
  profiles: ProfileInfo[];
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

function TaskCard({
  task,
  selected,
  onSelect,
}: {
  task: KanbanTask;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const tone = statusTone(task.status);
  return (
    <button
      type="button"
      data-testid={`hermes-kanban-task-card-${task.id}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(task.id);
      }}
      title={task.title || task.id}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        margin: '0 0 8px',
        padding: '8px 9px',
        borderRadius: 8,
        border: `1px solid ${selected ? 'rgba(55,173,170,0.55)' : 'rgba(167,176,186,0.2)'}`,
        background: selected
          ? 'linear-gradient(145deg, rgba(55,173,170,0.16), rgba(11,14,18,0.7))'
          : 'linear-gradient(145deg, rgba(24,31,40,0.72), rgba(11,14,18,0.74))',
        color: GRAPH_THEME.surface.text,
        cursor: 'pointer',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 18px rgba(0,0,0,0.24)',
        transition: 'border-color 120ms ease, transform 120ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: 99, background: tone, flexShrink: 0, boxShadow: `0 0 8px ${tone}` }}
        />
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.04em',
            color: tone,
            fontWeight: 700,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {task.id}
        </span>
        {task.priority ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 999,
              background: 'rgba(242,166,74,0.14)',
              border: '1px solid rgba(242,166,74,0.3)',
              color: '#F2A64A',
              marginLeft: 'auto',
            }}
          >
            P{task.priority}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.35,
          fontWeight: 600,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {task.title || '(untitled)'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {task.assignee ? (
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 999,
              background: 'rgba(55,173,170,0.12)',
              border: '1px solid rgba(55,173,170,0.28)',
              color: '#7DE0DA',
            }}
          >
            {task.assignee}
          </span>
        ) : null}
        {task.tenant ? (
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 999,
              background: 'rgba(167,176,186,0.12)',
              border: '1px solid rgba(167,176,186,0.24)',
              color: GRAPH_THEME.surface.mutedText,
            }}
          >
            {task.tenant}
          </span>
        ) : null}
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
  const tone = statusTone(status);
  return (
    <section
      data-testid={`kanban-lane-${status}`}
      style={{
        flex: '0 0 236px',
        maxWidth: 236,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        border: '1px solid rgba(126,232,226,0.14)',
        background: 'linear-gradient(180deg, rgba(29,43,52,0.4), rgba(12,19,25,0.28))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 28px rgba(0,0,0,0.16)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 10px',
          borderBottom: '1px solid rgba(126,232,226,0.1)',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 99, background: tone, boxShadow: `0 0 9px ${tone}` }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: GRAPH_THEME.surface.text,
          }}
        >
          {KANBAN_STATUS_LABELS[status] || status}
        </span>
        <span
          data-testid={`kanban-lane-count-${status}`}
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 800,
            color: GRAPH_THEME.surface.mutedText,
            background: 'rgba(167,176,186,0.12)',
            border: '1px solid rgba(167,176,186,0.22)',
            borderRadius: 999,
            padding: '0 7px',
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
          padding: '8px 8px 4px',
          minHeight: 72,
        }}
      >
        {tasks.length === 0 ? (
          <div
            style={{
              fontSize: 10,
              color: GRAPH_THEME.surface.mutedText,
              textAlign: 'center',
              padding: '10px 4px',
              border: '1px dashed rgba(167,176,186,0.18)',
              borderRadius: 8,
            }}
          >
            Empty
          </div>
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
              borderRadius: 12,
              border: '1px solid rgba(126,232,226,0.16)',
              background: 'linear-gradient(180deg, rgba(29,43,52,0.42), rgba(12,19,25,0.3))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 28px rgba(0,0,0,0.16)',
            }}
          >
            <header
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid rgba(126,232,226,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#7DE0DA',
                }}
              >
                {profile}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  fontWeight: 800,
                  color: GRAPH_THEME.surface.mutedText,
                  background: 'rgba(167,176,186,0.12)',
                  border: '1px solid rgba(167,176,186,0.22)',
                  borderRadius: 999,
                  padding: '0 7px',
                }}
              >
                {profileTasks.length}
              </span>
            </header>
            <div style={{ padding: '8px', maxHeight: '100%', overflowY: 'auto' }}>
              {activeStatuses.length === 0 ? (
                <div
                  style={{
                    fontSize: 10,
                    color: GRAPH_THEME.surface.mutedText,
                    textAlign: 'center',
                    padding: '10px 4px',
                    border: '1px dashed rgba(167,176,186,0.18)',
                    borderRadius: 8,
                  }}
                >
                  No tasks
                </div>
              ) : (
                activeStatuses.map((status) => (
                  <div key={status} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: statusTone(status),
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
  const inputStyle: React.CSSProperties = {
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid rgba(126,232,226,0.16)',
    background: 'linear-gradient(180deg, rgba(29,43,52,0.42), rgba(12,19,25,0.28))',
    color: GRAPH_THEME.drawer.inputText,
    fontSize: 11,
    outline: 'none',
  };
  return (
    <header
      data-testid="hermes-kanban-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(126,232,226,0.12)',
        background: 'linear-gradient(110deg, rgba(255,255,255,0.05), rgba(255,255,255,0.016), transparent 70%)',
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: GRAPH_THEME.surface.text,
        }}
      >
        Hermes
      </div>

      <select
        aria-label="Board"
        data-testid="hermes-kanban-board-select"
        value={currentBoard}
        onChange={(e) => onBoardChange(e.target.value)}
        style={{ ...inputStyle, maxWidth: 200 }}
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
        placeholder="Search tasks…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ ...inputStyle, width: 180, flexGrow: 1, maxWidth: 320, minWidth: 120 }}
      />

      <span
        data-testid="hermes-kanban-gateway-status"
        title={gatewayChecked ? (gatewayRunning ? 'Gateway running' : 'Gateway stopped') : 'Gateway status unknown'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10,
          fontWeight: 700,
          color: gatewayRunning ? '#63D8A0' : '#E06C6C',
          border: `1px solid ${gatewayRunning ? 'rgba(99,216,160,0.35)' : 'rgba(224,108,108,0.35)'}`,
          background: gatewayRunning ? 'rgba(99,216,160,0.08)' : 'rgba(224,108,108,0.08)',
          borderRadius: 999,
          padding: '3px 8px',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: 99,
            background: gatewayChecked ? (gatewayRunning ? '#63D8A0' : '#E06C6C') : '#A7B0BA',
            boxShadow: gatewayRunning ? '0 0 9px rgba(99,216,160,0.8)' : 'none',
          }}
        />
        {gatewayChecked ? (gatewayRunning ? 'Gateway' : 'Stopped') : '…'}
      </span>

      <button
        type="button"
        data-testid="hermes-kanban-add-task"
        onClick={onAddTask}
        title={addTaskTitle}
        style={{
          padding: '6px 12px',
          borderRadius: 7,
          border: '1px solid rgba(55,173,170,0.42)',
          background: 'rgba(55,173,170,0.14)',
          color: '#7DE0DA',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 6px 16px rgba(0,0,0,0.22)',
        }}
      >
        + Add Task
      </button>

      <button
        type="button"
        data-testid="hermes-kanban-inspector-toggle"
        aria-pressed={inspectorOpen}
        onClick={onToggleInspector}
        title={inspectorOpen ? 'Close inspector' : 'Open inspector'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 9px',
          borderRadius: 7,
          border: `1px solid ${inspectorOpen ? 'rgba(55,173,170,0.5)' : 'rgba(167,176,186,0.26)'}`,
          background: inspectorOpen ? 'rgba(55,173,170,0.14)' : 'rgba(167,176,186,0.06)',
          color: inspectorOpen ? '#7DE0DA' : GRAPH_THEME.surface.mutedText,
          fontSize: 10,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-block', width: 9, height: 9, border: '1.5px solid currentColor', borderRadius: 2, transform: 'rotate(45deg)' }} />
        Inspector
      </button>
    </header>
  );
}

export default function HermesKanbanBoard({
  boards,
  currentBoard,
  onBoardChange,
  tasks,
  stats,
  search,
  onSearchChange,
  gatewayRunning,
  gatewayChecked,
  profiles,
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
        background:
          'radial-gradient(circle at 18% 12%, rgba(55,173,170,0.07), transparent 34%), linear-gradient(180deg, rgba(17,22,29,0.96), rgba(11,14,18,0.99))',
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
        <div data-testid="hermes-kanban-loading" style={{ padding: 16, color: GRAPH_THEME.surface.mutedText, fontSize: 12 }}>
          Loading real Hermes board…
        </div>
      ) : null}

      {error ? (
        <div
          data-testid="hermes-kanban-error"
          role="alert"
          style={{
            margin: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(224,108,108,0.4)',
            background: 'rgba(224,108,108,0.1)',
            color: '#F1A9A9',
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {error}
        </div>
      ) : null}

      {!loading && !error && tasks.length === 0 ? (
        <div data-testid="hermes-kanban-empty" style={{ padding: 24, color: GRAPH_THEME.surface.mutedText, fontSize: 12 }}>
          No tasks on this board{search ? ' matching the search' : ''}.
        </div>
      ) : null}

      <div className="hermes-kanban-lane-scroll-x" style={{ flex: '1 1 auto', minHeight: 0, overflowX: 'auto', overflowY: 'auto' }}>
        {filters.lanesByProfile ? (
          <LaneByProfileBoard tasks={filteredTasks} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
        ) : (
          <LaneByStatusBoard tasks={filteredTasks} filters={filters} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
        )}
      </div>

      {stats ? (
        <footer
          style={{
            borderTop: '1px solid rgba(126,232,226,0.12)',
            padding: '6px 14px',
            display: 'flex',
            gap: 12,
            fontSize: 10,
            color: GRAPH_THEME.surface.mutedText,
            flexWrap: 'wrap',
          }}
          data-testid="hermes-kanban-stats"
        >
          {(Object.entries(stats.by_status || {}) as [string, number][]).map(([status, count]) => (
            <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: statusTone(status) }} />
              {KANBAN_STATUS_LABELS[status] || status}: {count}
            </span>
          ))}
        </footer>
      ) : null}
    </div>
  );
}
