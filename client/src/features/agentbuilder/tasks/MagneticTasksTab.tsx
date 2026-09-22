import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import {
  GRAPH_THEME,
  graphDrawerSectionStyle,
  graphGlassPillStyle,
} from '../../../components/graph/graphVisualTokens';

export const HERMES_TASK_STATUSES = [
  'triage',
  'todo',
  'scheduled',
  'ready',
  'running',
  'blocked',
  'review',
  'done',
  'archived',
] as const;

export type HermesTaskStatus = (typeof HERMES_TASK_STATUSES)[number];

type NativeAttempt = {
  runId: string | number;
  status: string;
  startedAt: string | number | null;
  endedAt: string | number | null;
};

export type NativeToolReceipt = {
  toolCallId: string;
  toolName: string;
  state: 'returned' | 'failed' | null;
  resultPreview: string;
  executionReceipt: {
    schema: 'agent-runtime.execution-receipt.v1';
    tool: string;
    correlationId: string;
    state: 'completed' | 'failed';
  } | null;
};

export type MagneticNativeTask = {
  taskId: string;
  title: string;
  assignee: string | null;
  status: HermesTaskStatus;
  dependencyIds: string[];
  latestAttempt: NativeAttempt | null;
  resultAvailable: boolean;
  workerSessionId: string | null;
  handoffSummary: string | null;
  toolReceipts: NativeToolReceipt[];
  toolReceiptsComplete: boolean;
};

type MagneticRunStatus = {
  runId: string;
  nativeRootId: string | null;
  state: string;
  nativeStatus: HermesTaskStatus | null;
  nativeTasks: MagneticNativeTask[];
};

const VALID_TASK_STATUSES = new Set<string>(HERMES_TASK_STATUSES);
const ACTIVE_REFRESH_MS = 2_000;
const QUIET_REFRESH_MS = 10_000;
const STATUS_REQUEST_TIMEOUT_MS = 8_000;
const MAX_HANDOFF_SUMMARY_CHARS = 2_000;
const MAX_TOOL_RECEIPTS = 64;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 1_000;
const MAX_NATIVE_ID_CHARS = 512;
const TASK_NODE_WIDTH = 142;
const TASK_NODE_HEIGHT = 72;
const TASK_COLUMN_GAP = 34;
const TASK_ROW_GAP = 88;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function exactBoundedText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > limit) {
    return null;
  }
  return value;
}

function nativeStatus(value: unknown): HermesTaskStatus | null {
  const candidate = text(value).toLowerCase();
  return VALID_TASK_STATUSES.has(candidate) ? candidate as HermesTaskStatus : null;
}

export function taskStatusLabel(
  status: HermesTaskStatus,
  _dependencyCount = 0,
): string {
  switch (status) {
    case 'triage': return 'Waiting';
    case 'todo': return 'Waiting';
    case 'scheduled': return 'Waiting';
    case 'ready': return 'Waiting';
    case 'running': return 'Running';
    case 'blocked': return 'Blocked';
    case 'review': return 'Waiting';
    case 'done': return 'Done';
    case 'archived': return 'Stopped';
  }
}

export function readMagneticRunStatus(value: unknown): MagneticRunStatus | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const runId = text(source.runId);
  if (!runId) return null;
  const tasks = Array.isArray(source.nativeTasks)
    ? source.nativeTasks.flatMap((entry): MagneticNativeTask[] => {
      if (!entry || typeof entry !== 'object') return [];
      const task = entry as Record<string, unknown>;
      const taskId = text(task.taskId);
      const status = nativeStatus(task.status);
      if (!taskId || !status) return [];
      const rawAttempt = task.latestAttempt;
      const attempt = rawAttempt && typeof rawAttempt === 'object'
        ? rawAttempt as Record<string, unknown>
        : null;
      const attemptRunId = attempt && (
        typeof attempt.runId === 'string' || typeof attempt.runId === 'number'
      ) ? attempt.runId : null;
      const workerSessionId = task.workerSessionId === null || task.workerSessionId === undefined
        ? null
        : exactBoundedText(task.workerSessionId, MAX_NATIVE_ID_CHARS);
      const handoffSummary = task.handoffSummary === null || task.handoffSummary === undefined
        ? null
        : exactBoundedText(task.handoffSummary, MAX_HANDOFF_SUMMARY_CHARS);
      let receiptsMalformed = (
        (task.workerSessionId !== null && task.workerSessionId !== undefined && !workerSessionId)
        || (task.handoffSummary !== null && task.handoffSummary !== undefined && !handoffSummary)
        || (task.toolReceipts !== undefined && !Array.isArray(task.toolReceipts))
      );
      const seenReceiptIds = new Set<string>();
      const toolReceipts = Array.isArray(task.toolReceipts)
        ? task.toolReceipts.slice(0, MAX_TOOL_RECEIPTS).flatMap((rawReceipt): NativeToolReceipt[] => {
          if (!rawReceipt || typeof rawReceipt !== 'object') {
            receiptsMalformed = true;
            return [];
          }
          const receipt = rawReceipt as Record<string, unknown>;
          const toolCallId = exactBoundedText(receipt.toolCallId, MAX_NATIVE_ID_CHARS);
          const toolName = exactBoundedText(receipt.toolName, MAX_NATIVE_ID_CHARS);
          const resultPreview = typeof receipt.resultPreview === 'string'
            && receipt.resultPreview.length <= MAX_TOOL_RESULT_PREVIEW_CHARS
            ? receipt.resultPreview
            : null;
          let executionReceipt: NativeToolReceipt['executionReceipt'] = null;
          const rawExecutionReceipt = receipt.executionReceipt;
          if (rawExecutionReceipt !== null) {
            if (!rawExecutionReceipt || typeof rawExecutionReceipt !== 'object') {
              receiptsMalformed = true;
            } else {
              const exactReceipt = rawExecutionReceipt as Record<string, unknown>;
              const executionTool = exactBoundedText(exactReceipt.tool, 128);
              const correlationId = exactBoundedText(
                exactReceipt.correlationId, MAX_NATIVE_ID_CHARS,
              );
              const executionState = exactReceipt.state === 'completed'
                || exactReceipt.state === 'failed'
                ? exactReceipt.state
                : null;
              if (
                Object.keys(exactReceipt).sort().join('\0')
                  !== 'correlationId\0schema\0state\0tool'
                || exactReceipt.schema !== 'agent-runtime.execution-receipt.v1'
                || !executionTool || !correlationId || !executionState
              ) {
                receiptsMalformed = true;
              } else {
                executionReceipt = {
                  schema: 'agent-runtime.execution-receipt.v1',
                  tool: executionTool,
                  correlationId,
                  state: executionState,
                };
              }
            }
          }
          if (!toolCallId || !toolName || resultPreview === null || seenReceiptIds.has(toolCallId)) {
            receiptsMalformed = true;
            return [];
          }
          seenReceiptIds.add(toolCallId);
          const state = receipt.state === 'returned' || receipt.state === 'failed'
            ? receipt.state
            : null;
          if (receipt.state !== null && receipt.state !== undefined && state === null) {
            receiptsMalformed = true;
          }
          return [{
            toolCallId,
            toolName,
            state,
            resultPreview,
            executionReceipt,
          }];
        })
        : [];
      if (Array.isArray(task.toolReceipts) && task.toolReceipts.length > MAX_TOOL_RECEIPTS) {
        receiptsMalformed = true;
      }
      if ((toolReceipts.length > 0 || task.toolReceiptsComplete === true) && !workerSessionId) {
        receiptsMalformed = true;
      }
      return [{
        taskId,
        title: text(task.title) || taskId,
        assignee: text(task.assignee) || null,
        status,
        dependencyIds: Array.isArray(task.dependencyIds)
          ? task.dependencyIds.map(text).filter(Boolean)
          : [],
        latestAttempt: attempt && attemptRunId !== null
          ? {
            runId: attemptRunId,
            status: text(attempt.status),
            startedAt: typeof attempt.startedAt === 'string' || typeof attempt.startedAt === 'number'
              ? attempt.startedAt
              : null,
            endedAt: typeof attempt.endedAt === 'string' || typeof attempt.endedAt === 'number'
              ? attempt.endedAt
              : null,
          }
          : null,
        resultAvailable: task.resultAvailable === true,
        workerSessionId,
        handoffSummary,
        toolReceipts,
        toolReceiptsComplete: task.toolReceiptsComplete === true && !receiptsMalformed,
      }];
    })
    : [];
  return {
    runId,
    nativeRootId: text(source.nativeRootId) || null,
    state: text(source.state),
    nativeStatus: nativeStatus(source.nativeStatus),
    nativeTasks: tasks,
  };
}

function taskTone(
  status: HermesTaskStatus,
  dependencyCount = 0,
): { border: string; color: string; background: string } {
  const visibleStatus = taskStatusLabel(status, dependencyCount);
  if (visibleStatus === 'Blocked') return {
    border: 'rgba(255, 130, 130, 0.50)',
    color: 'rgba(255, 190, 190, 0.98)',
    background: 'rgba(96, 31, 38, 0.22)',
  };
  if (visibleStatus === 'Running') return {
    border: 'rgba(92, 214, 224, 0.50)',
    color: 'rgba(156, 239, 245, 0.98)',
    background: 'rgba(24, 87, 94, 0.22)',
  };
  return {
    border: 'rgba(255,255,255,0.12)',
    color: status === 'done' || status === 'archived'
      ? 'rgba(224,222,213,0.58)'
      : 'rgba(224,222,213,0.84)',
    background: 'rgba(10, 18, 24, 0.20)',
  };
}

type MagneticTaskNodeData = {
  task: MagneticNativeTask;
  assignmentLabel: string;
};

type MagneticTaskGraphNode = Node<MagneticTaskNodeData, 'magneticTask'>;

function assignmentLabel(
  assignee: string | null,
  cardTitlesByProfile: Readonly<Record<string, string>>,
): string {
  if (!assignee) return 'Unassigned';
  const savedTitle = text(cardTitlesByProfile[assignee]);
  return savedTitle || 'Unmapped';
}

export function buildMagneticTaskGraph(
  tasks: MagneticNativeTask[],
  cardTitlesByProfile: Readonly<Record<string, string>> = {},
): {
  nodes: MagneticTaskGraphNode[];
  edges: Edge[];
} {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const depthCache = new Map<string, number>();
  const depthFor = (taskId: string, visiting = new Set<string>()): number => {
    const cached = depthCache.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) return 0;
    const task = byId.get(taskId);
    if (!task) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(taskId);
    const knownDependencies = task.dependencyIds.filter((dependencyId) => (
      dependencyId !== taskId && byId.has(dependencyId)
    ));
    const depth = knownDependencies.length === 0
      ? 0
      : Math.max(...knownDependencies.map((dependencyId) => depthFor(dependencyId, nextVisiting) + 1));
    depthCache.set(taskId, depth);
    return depth;
  };

  const layers = new Map<number, MagneticNativeTask[]>();
  for (const task of tasks) {
    const depth = depthFor(task.taskId);
    const layer = layers.get(depth) ?? [];
    layer.push(task);
    layers.set(depth, layer);
  }
  for (const layer of layers.values()) {
    layer.sort((left, right) => left.taskId.localeCompare(right.taskId));
  }
  const maxLayerSize = Math.max(1, ...[...layers.values()].map((layer) => layer.length));

  const nodes = [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([depth, layer]) => layer.map((task, index): MagneticTaskGraphNode => ({
      id: task.taskId,
      type: 'magneticTask',
      position: {
        x: depth * (TASK_NODE_WIDTH + TASK_COLUMN_GAP),
        y: ((maxLayerSize - layer.length) * TASK_ROW_GAP) / 2 + index * TASK_ROW_GAP,
      },
      data: { task, assignmentLabel: assignmentLabel(task.assignee, cardTitlesByProfile) },
      draggable: false,
      connectable: false,
      selectable: true,
    })));
  const edges = tasks.flatMap((task): Edge[] => task.dependencyIds.flatMap((dependencyId) => (
    byId.has(dependencyId) && dependencyId !== task.taskId
      ? [{
        id: `${dependencyId}->${task.taskId}`,
        source: dependencyId,
        target: task.taskId,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: 'rgba(119, 208, 217, 0.50)', strokeWidth: 1.25 },
        selectable: false,
        focusable: false,
        reconnectable: false,
      }]
      : []
  )));
  return { nodes, edges };
}

function MagneticTaskNode({ data, selected }: NodeProps<MagneticTaskGraphNode>): React.ReactElement {
  const task = data.task;
  const tone = taskTone(task.status, task.dependencyIds.length);
  const statusLabel = taskStatusLabel(task.status, task.dependencyIds.length);
  return (
    <div
      data-testid={`magnetic-task-${task.taskId}`}
      style={{
        width: TASK_NODE_WIDTH,
        minHeight: TASK_NODE_HEIGHT,
        boxSizing: 'border-box',
        border: `1px solid ${tone.border}`,
        borderRadius: 8,
        background: tone.background,
        padding: '8px 9px',
        display: 'grid',
        gap: 4,
        opacity: task.status === 'done' || task.status === 'archived' ? 0.58 : 1,
        outline: selected ? `1px solid ${tone.color}` : 'none',
        outlineOffset: selected ? 2 : 0,
        boxShadow: task.status === 'running' ? `0 0 10px ${tone.border}` : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div style={{
        color: GRAPH_THEME.drawer.inputMuted,
        fontSize: 9,
        fontWeight: 650,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {data.assignmentLabel}
      </div>
      <div style={{
        color: tone.color,
        fontSize: 11,
        fontWeight: 650,
        lineHeight: 1.25,
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
        overflow: 'hidden',
      }}>
        {task.title}
      </div>
      <span title={task.status} style={{ color: tone.color, fontSize: 9 }}>
        {statusLabel}
      </span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

const MAGNETIC_TASK_NODE_TYPES = { magneticTask: MagneticTaskNode };

function SelectedTaskDetails({
  task,
  rootTaskId,
  runId,
  allTasks,
  cardTitlesByProfile,
}: {
  task: MagneticNativeTask;
  rootTaskId: string | null;
  runId: string;
  allTasks: MagneticNativeTask[];
  cardTitlesByProfile: Readonly<Record<string, string>>;
}): React.ReactElement {
  const statusLabel = taskStatusLabel(task.status, task.dependencyIds.length);
  const taskTitlesById = new Map(allTasks.map((entry) => [entry.taskId, entry.title]));
  const priorTaskLabels = task.dependencyIds.map((taskId) => taskTitlesById.get(taskId) || taskId);
  const detailStyle = { color: GRAPH_THEME.drawer.inputMuted, fontSize: 10 };
  return (
    <aside
      aria-label="Task details"
      style={graphDrawerSectionStyle({ padding: '10px', borderRadius: 8, display: 'grid', gap: 4 })}
    >
      <div style={{ color: '#E0DED5', fontSize: 11, fontWeight: 650 }}>{task.title}</div>
      <div style={detailStyle}>
        {assignmentLabel(task.assignee, cardTitlesByProfile)} · {statusLabel}
      </div>
      <div style={detailStyle}>Status · {task.status}</div>
      <div style={detailStyle}>Profile · {task.assignee || '—'}</div>
      <div style={detailStyle}>Task · {task.taskId}</div>
      <div style={detailStyle}>Run · {runId}</div>
      {task.taskId === rootTaskId ? <div style={detailStyle}>Root</div> : null}
      {task.dependencyIds.length > 0 ? (
        <div style={detailStyle}>
          Depends · {priorTaskLabels.join(', ')}
        </div>
      ) : null}
      {task.latestAttempt ? (
        <div style={detailStyle}>
          Attempt · {task.latestAttempt.runId}
          {task.latestAttempt.status ? ` · ${task.latestAttempt.status}` : ''}
          {task.resultAvailable ? ' · Result' : ''}
        </div>
      ) : task.resultAvailable ? (
        <div style={detailStyle}>Result</div>
      ) : null}
      {task.workerSessionId ? (
        <div style={detailStyle}>Worker session · {task.workerSessionId}</div>
      ) : null}
      {task.handoffSummary ? (
        <div style={{ ...detailStyle, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          Handoff · {task.handoffSummary}
        </div>
      ) : null}
      {task.toolReceipts.length > 0 ? (
        <div aria-label="Tool receipts" style={{ display: 'grid', gap: 6, marginTop: 3 }}>
          {task.toolReceipts.map((receipt) => (
            <div
              key={receipt.toolCallId}
              style={graphDrawerSectionStyle({ padding: '7px', borderRadius: 6, display: 'grid', gap: 3 })}
            >
              <div style={detailStyle}>
                Tool · {receipt.toolName}{receipt.state ? ` · ${receipt.state}` : ''}
              </div>
              <div style={detailStyle}>Call · {receipt.toolCallId}</div>
              {receipt.executionReceipt ? (
                <div style={detailStyle}>
                  Saved Card receipt · {receipt.executionReceipt.tool}
                  {' · '}{receipt.executionReceipt.state}
                  {' · '}{receipt.executionReceipt.correlationId}
                </div>
              ) : null}
              {receipt.resultPreview ? (
                <div style={{ ...detailStyle, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  Result · {receipt.resultPreview}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {(task.workerSessionId || task.toolReceipts.length > 0) && !task.toolReceiptsComplete ? (
        <div style={detailStyle}>Tool receipt coverage incomplete</div>
      ) : null}
    </aside>
  );
}

export default function MagneticTasksTab({
  projectId,
  deckId,
  cardId,
  label,
  cardTitlesByProfile,
}: {
  projectId: string;
  deckId: string;
  cardId: string;
  label?: string;
  cardTitlesByProfile: Readonly<Record<string, string>>;
}): React.ReactElement {
  const [run, setRun] = useState<MagneticRunStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<MagneticTaskGraphNode, Edge> | null
  >(null);
  const graphHostRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<MagneticRunStatus | null> => {
    const requestController = new AbortController();
    let timedOut = false;
    const forwardAbort = (): void => requestController.abort();
    if (signal?.aborted) requestController.abort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, STATUS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('/api/cards/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: requestController.signal,
        body: JSON.stringify({
          action: 'status',
          inspectOnly: true,
          projectId,
          deckId,
          cardId,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        result?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(text(payload?.error) || `magnetic_tasks_http_${response.status}`);
      }
      return readMagneticRunStatus(payload.result);
    } catch (reason) {
      if (timedOut) throw new Error('timeout');
      throw reason;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }, [cardId, deckId, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;
    const load = async (): Promise<void> => {
      try {
        const next = await refresh(controller.signal);
        if (disposed) return;
        setRun(next);
        setError(null);
        setLoading(false);
        const active = next && ['pending', 'running'].includes(next.state);
        timer = window.setTimeout(() => { void load(); }, active ? ACTIVE_REFRESH_MS : QUIET_REFRESH_MS);
      } catch (reason) {
        if (disposed || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'magnetic_tasks_unavailable');
        setLoading(false);
        timer = window.setTimeout(() => { void load(); }, QUIET_REFRESH_MS);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);

  const taskGraph = useMemo(
    () => buildMagneticTaskGraph(run?.nativeTasks ?? [], cardTitlesByProfile),
    [cardTitlesByProfile, run],
  );
  const selectedTask = useMemo(() => (
    run?.nativeTasks.find((task) => task.taskId === selectedTaskId) ?? null
  ), [run, selectedTaskId]);
  const rootTask = useMemo(() => (
    run?.nativeTasks.find((task) => task.taskId === run.nativeRootId) ?? null
  ), [run]);
  const graphHeight = useMemo(() => Math.min(
    720,
    Math.max(260, ...taskGraph.nodes.map((node) => node.position.y + TASK_NODE_HEIGHT + 24)),
  ), [taskGraph.nodes]);

  useEffect(() => {
    const host = graphHostRef.current;
    if (!host || !flowInstance || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const fit = (): void => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        void flowInstance.fitView({ padding: 0.10, maxZoom: 1, duration: 0 });
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [flowInstance, graphHeight]);

  useEffect(() => {
    if (selectedTaskId && !run?.nativeTasks.some((task) => task.taskId === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [run, selectedTaskId]);

  if (loading) {
    return <div role="status" style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12 }}>Loading…</div>;
  }
  if (error && !run) {
    return (
      <div role="alert" title={error} style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12 }}>
        Unavailable
      </div>
    );
  }
  if (!run) {
    return <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12 }}>Idle</div>;
  }

  return (
    <section aria-label={`${text(label) || 'Card'} tasks`} style={{ display: 'grid', gap: 10 }}>
      <div style={graphDrawerSectionStyle({ padding: '10px 11px', borderRadius: 8 })}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 10 }}>
            {run.nativeTasks.length}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {error ? (
              <span title={error} style={graphGlassPillStyle({ color: GRAPH_THEME.drawer.inputMuted })}>
                Stale
              </span>
            ) : null}
            {run.nativeStatus ? (
            <span
              title={run.nativeStatus}
              style={graphGlassPillStyle({
                color: taskTone(run.nativeStatus, rootTask?.dependencyIds.length ?? 0).color,
                borderColor: taskTone(run.nativeStatus, rootTask?.dependencyIds.length ?? 0).border,
                background: taskTone(run.nativeStatus, rootTask?.dependencyIds.length ?? 0).background,
              })}
            >
              {taskStatusLabel(run.nativeStatus, rootTask?.dependencyIds.length ?? 0)}
            </span>
            ) : null}
          </div>
        </div>
      </div>
      {run.nativeTasks.length === 0 ? (
        <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12 }}>Empty</div>
      ) : (
        <>
          <div
            ref={graphHostRef}
            data-testid="magnetic-task-graph"
            style={{
              height: graphHeight,
              minHeight: 260,
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 9,
              overflow: 'hidden',
              background: 'rgba(5, 12, 17, 0.34)',
            }}
          >
            <ReactFlow<MagneticTaskGraphNode, Edge>
              key={`${run.runId}:${taskGraph.nodes.map((node) => node.id).join('|')}`}
              nodes={taskGraph.nodes}
              edges={taskGraph.edges}
              nodeTypes={MAGNETIC_TASK_NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.10, maxZoom: 1 }}
              minZoom={0.65}
              maxZoom={1.5}
              onInit={setFlowInstance}
              onNodeClick={(_event, node) => setSelectedTaskId(node.id)}
              proOptions={{ hideAttribution: true }}
            >
              <Background color={GRAPH_THEME.background.gridMinor} gap={20} size={1} />
            </ReactFlow>
          </div>
          {selectedTask ? (
            <SelectedTaskDetails
              task={selectedTask}
              rootTaskId={run.nativeRootId}
              runId={run.runId}
              allTasks={run.nativeTasks}
              cardTitlesByProfile={cardTitlesByProfile}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
