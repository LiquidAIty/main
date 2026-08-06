import React, { useEffect, useState } from 'react';

import RightGlassDrawer from '../../components/graph/RightGlassDrawer';
import {
  GRAPH_THEME,
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
} from '../../components/graph/graphVisualTokens';
import type {
  HermesConfig,
  HermesInspectorMode,
  HermesSystemStatus,
  KanbanBoardInfo,
  KanbanShow,
  ProfileInfo,
} from './types';
import { KANBAN_STATUS_LABELS } from './types';
import {
  BoardTab,
  OrchestrationTab,
  ProfilesTab,
  SystemTab,
  type BoardTabActions,
} from './KanbanBoardTabs';
import {
  ActivityTab,
  DependenciesTab,
  ResultTab,
  TaskTab,
  WorkerTab,
  type TaskTabActions,
} from './KanbanTaskTabs';
import type { BoardFilters } from './types';

export type HermesKanbanInspectorProps = {
  open: boolean;
  mode: HermesInspectorMode;
  onOpen: () => void;
  onClose: () => void;
  boardTabProps: {
    boards: KanbanBoardInfo[];
    currentBoard: string;
    filters: BoardFilters;
    onFiltersChange: (patch: Partial<BoardFilters>) => void;
    actions: BoardTabActions;
  };
  orchestration: HermesConfig | null;
  profiles: ProfileInfo[];
  system: HermesSystemStatus | null;
  taskShow: KanbanShow | null;
  taskLoading: boolean;
  taskError: string | null;
  assignees: string[];
  taskActions: TaskTabActions;
  workerRun: Record<string, unknown> | null;
};

type TabDef = { id: string; label: string };

function TabRow({
  tabs,
  active,
  onSelect,
  testPrefix,
}: {
  tabs: readonly TabDef[];
  active: string;
  onSelect: (id: string) => void;
  testPrefix: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap"
      style={graphCompanionTabGroupStyle({ gap: 6, marginBottom: 10 })}
    >
      {tabs.map((t) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            data-testid={`${testPrefix}-tab-${t.id}`}
            aria-pressed={selected}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(t.id);
            }}
            className="whitespace-nowrap transition-colors duration-150 ease-out"
            style={graphCompanionTabButtonStyle(selected)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const BOARD_TABS = [
  { id: 'board', label: 'Board' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'system', label: 'System' },
] as const;

const TASK_TABS = [
  { id: 'task', label: 'Task' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'activity', label: 'Activity' },
  { id: 'result', label: 'Result' },
] as const;

const WORKER_TABS = [
  { id: 'worker', label: 'Worker' },
  { id: 'tool', label: 'Tools' },
  { id: 'events', label: 'Events' },
  { id: 'output', label: 'Output' },
] as const;

export default function HermesKanbanInspector({
  open,
  mode,
  onOpen,
  onClose,
  boardTabProps,
  orchestration,
  profiles,
  system,
  taskShow,
  taskLoading,
  taskError,
  assignees,
  taskActions,
  workerRun,
}: HermesKanbanInspectorProps) {
  const [boardTab, setBoardTab] = useState<string>('board');
  const [taskTab, setTaskTab] = useState<string>('task');
  const [workerTab, setWorkerTab] = useState<string>('worker');

  const title =
    mode === 'task' && taskShow
      ? `Hermes · ${taskShow.task.title || taskShow.task.id}`
      : mode === 'worker'
        ? 'Hermes · Worker'
        : 'Hermes · Board';

  // When a new task is selected, reset service-mode tabs to their first tab.
  useEffect(() => {
    if (mode === 'task') setTaskTab('task');
    if (mode === 'worker') setWorkerTab('worker');
  }, [mode, taskShow?.task.id]);

  const tabs = mode === 'board' ? BOARD_TABS : mode === 'task' ? TASK_TABS : WORKER_TABS;
  const activeTab = mode === 'board' ? boardTab : mode === 'task' ? taskTab : workerTab;
  const setActiveTab = mode === 'board' ? setBoardTab : mode === 'task' ? setTaskTab : setWorkerTab;

  const testPrefix = mode === 'board' ? 'hermes-kanban-inspector' : mode === 'task' ? 'hermes-kanban-task-inspector' : 'hermes-kanban-worker-inspector';

  return (
    <RightGlassDrawer
      isOpen={open}
      title={title}
      onClose={onClose}
      onOpen={onOpen}
      dataTestId="hermes-kanban-inspector"
      defaultWidth={400}
      minWidth={300}
      maxWidth={560}
      storageKey="liquidaity.drawer.inspector.hermeskanban.v1.width"
      top={16}
      right={8}
      bottom={8}
      movable
    >
      <TabRow tabs={tabs} active={activeTab} onSelect={setActiveTab} testPrefix={testPrefix} />

      {mode === 'board' ? (
        <>
          {activeTab === 'board' ? (
            <BoardTab
              boards={boardTabProps.boards}
              currentBoard={boardTabProps.currentBoard}
              filters={boardTabProps.filters}
              onFiltersChange={boardTabProps.onFiltersChange}
              actions={boardTabProps.actions}
            />
          ) : null}
          {activeTab === 'orchestration' ? <OrchestrationTab config={orchestration} /> : null}
          {activeTab === 'profiles' ? <ProfilesTab profiles={profiles} /> : null}
          {activeTab === 'system' ? <SystemTab system={system} actions={boardTabProps.actions} /> : null}
        </>
      ) : null}

      {mode === 'task' ? (
        <>
          {taskLoading ? (
            <div data-testid="hermes-kanban-task-loading" style={{ fontSize: 11, color: GRAPH_THEME.surface.mutedText, padding: 8 }}>
              Loading task…
            </div>
          ) : null}
          {taskError ? (
            <div
              data-testid="hermes-kanban-task-error"
              role="alert"
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(224,108,108,0.4)',
                background: 'rgba(224,108,108,0.1)',
                color: '#F1A9A9',
                fontSize: 11,
              }}
            >
              {taskError}
            </div>
          ) : null}
          {!taskLoading && !taskError && taskShow ? (
            <>
              {activeTab === 'task' ? (
                <TaskTab
                  task={taskShow.task}
                  statusLabel={KANBAN_STATUS_LABELS[taskShow.task.status] || taskShow.task.status}
                  actions={taskActions}
                  assignees={assignees}
                />
              ) : null}
              {activeTab === 'dependencies' ? (
                <DependenciesTab taskShow={taskShow} actions={taskActions} />
              ) : null}
              {activeTab === 'activity' ? (
                <ActivityTab
                  taskShow={taskShow}
                  currentWorkerLabel={
                    taskShow.runs.length > 0 ? String(taskShow.runs[taskShow.runs.length - 1].run_id || '') : null
                  }
                  actions={taskActions}
                />
              ) : null}
              {activeTab === 'result' ? <ResultTab taskShow={taskShow} /> : null}
            </>
          ) : null}
        </>
      ) : null}

      {mode === 'worker' && taskShow ? (
        <>
          {activeTab === 'worker' ? (
            <WorkerTab
              run={workerRun}
              task={taskShow.task}
              childTaskIds={taskShow.children}
              events={taskShow.events}
              actions={taskActions}
            />
          ) : null}
          {activeTab === 'tool' ? (
            <div>
              <div style={sectionHead}>Tools (native run record)</div>
              {workerRun ? (
                <pre style={preBlock}>{JSON.stringify(workerRun, null, 2)}</pre>
              ) : (
                <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No run selected.</div>
              )}
            </div>
          ) : null}
          {activeTab === 'events' ? (
            <div>
              <div style={sectionHead}>Event stream</div>
              {taskShow.events.length === 0 ? (
                <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No events recorded.</div>
              ) : (
                taskShow.events.map((e, i) => (
                  <div key={i} style={{ fontSize: 10, color: GRAPH_THEME.surface.text, padding: '3px 0', borderBottom: '1px solid rgba(167,176,186,0.1)' }}>
                    <span style={{ color: '#F2A64A' }}>{e.kind}</span> {e.run_id ? `[${e.run_id}] ` : ''}
                    {Object.entries(e.payload || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' ')}
                  </div>
                ))
              )}
            </div>
          ) : null}
          {activeTab === 'output' ? (
            <div>
              <div style={sectionHead}>Result / error</div>
              <pre data-testid="hermes-kanban-worker-result" style={preBlock}>
                {(taskShow.task.result || '').trim() || '(no result recorded)'}
              </pre>
              <div style={sectionHead}>Workspace output</div>
              <pre style={preBlock}>{taskShow.task.workspace_path || '—'}</pre>
            </div>
          ) : null}
        </>
      ) : null}
    </RightGlassDrawer>
  );
}

const sectionHead: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#7DE0DA',
  marginBottom: 6,
};

const preBlock: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 10,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: GRAPH_THEME.surface.text,
  background: 'rgba(11,14,18,0.5)',
  border: '1px solid rgba(126,232,226,0.12)',
  borderRadius: 8,
  padding: '8px 9px',
  maxHeight: 240,
  overflowY: 'auto',
};
