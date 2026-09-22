// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
  ReactFlow: ({ nodes, edges, nodeTypes, onNodeClick, children }: any) => (
    <div data-testid="react-flow">
      {nodes.map((node: any) => {
        const NodeComponent = nodeTypes[node.type];
        return (
          <button
            type="button"
            key={node.id}
            data-testid={`flow-node-${node.id}`}
            onClick={(event) => onNodeClick?.(event, node)}
          >
            <NodeComponent data={node.data} selected={false} />
          </button>
        );
      })}
      {edges.map((edge: any) => (
        <span key={edge.id} data-testid={`flow-edge-${edge.source}-${edge.target}`} />
      ))}
      {children}
    </div>
  ),
}));

import MagneticTasksTab, {
  buildMagneticTaskGraph,
  readMagneticRunStatus,
  taskStatusLabel,
  type MagneticNativeTask,
} from './MagneticTasksTab';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MagneticTasksTab', () => {
  it('keeps exact status data while presenting calm task meanings', () => {
    expect(taskStatusLabel('todo')).toBe('Waiting');
    expect(taskStatusLabel('todo', 2)).toBe('Waiting');
    expect(taskStatusLabel('ready')).toBe('Waiting');
    expect(taskStatusLabel('scheduled')).toBe('Waiting');
    expect(taskStatusLabel('triage')).toBe('Waiting');
    expect(taskStatusLabel('running')).toBe('Running');
    expect(taskStatusLabel('review')).toBe('Waiting');
    expect(taskStatusLabel('blocked', 1)).toBe('Blocked');
    expect(taskStatusLabel('blocked')).toBe('Blocked');
    expect(taskStatusLabel('done')).toBe('Done');
    expect(taskStatusLabel('archived')).toBe('Stopped');
  });

  it('reads only exact native Hermes task statuses', () => {
    const result = readMagneticRunStatus({
      runId: 'run-1',
      nativeRootId: 'root-1',
      state: 'running',
      nativeStatus: 'ready',
      nativeTasks: [
        {
          taskId: 'task-ready', title: 'Ready', assignee: 'signal', status: 'ready', dependencyIds: [],
          latestAttempt: { runId: 'native-run-2', status: 'waiting', startedAt: null, endedAt: '2026-09-21T00:00:00Z' },
        },
        { taskId: 'task-fake', title: 'Fake', assignee: 'signal', status: 'not-native', dependencyIds: [] },
        { taskId: 'task-fake-two', title: 'Fake', assignee: null, status: 'also-not-native', dependencyIds: [] },
      ],
    });
    expect(result?.nativeStatus).toBe('ready');
    expect(result?.nativeTasks.map((task) => task.taskId)).toEqual(['task-ready']);
    expect(result?.nativeTasks[0]?.latestAttempt).toEqual({
      runId: 'native-run-2', status: 'waiting', startedAt: null, endedAt: '2026-09-21T00:00:00Z',
    });
  });

  it('builds deterministic dependency layers and exact dependency edges', () => {
    const task = (
      taskId: string,
      dependencyIds: string[],
      status: MagneticNativeTask['status'] = 'ready',
    ): MagneticNativeTask => ({
      taskId, title: taskId, assignee: 'Magnetic', status, dependencyIds,
      latestAttempt: null, resultAvailable: false,
    });
    const graph = buildMagneticTaskGraph([
      task('root', []),
      task('research', ['root'], 'running'),
      task('summary', ['research'], 'blocked'),
    ], { Magnetic: 'Magnetic' });
    expect(graph.nodes.map((node) => [node.id, node.position.x, node.position.y])).toEqual([
      ['root', 0, 0],
      ['research', 176, 0],
      ['summary', 352, 0],
    ]);
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['root', 'research'],
      ['research', 'summary'],
    ]);
    expect(graph.nodes[0]?.data.assignmentLabel).toBe('Magnetic');
    expect(graph.nodes.every((node) => node.draggable === false && node.connectable === false)).toBe(true);

    const parallel = buildMagneticTaskGraph([
      task('one', []),
      task('two', []),
      task('root', ['one', 'two']),
    ]);
    expect(parallel.nodes.map((node) => [node.id, node.position.x, node.position.y])).toEqual([
      ['one', 0, 0],
      ['two', 0, 88],
      ['root', 176, 44],
    ]);
  });

  it('shows the task graph and selected attempt details without a mutating action', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        runId: 'run-1',
        nativeRootId: 'task-blocked',
        state: 'completed',
        nativeStatus: 'done',
        nativeTasks: [
          {
            taskId: 'task-running', title: 'Collect evidence', assignee: 'liquidaity-signal', status: 'running',
            dependencyIds: [], latestAttempt: { runId: 'attempt-7', status: 'running', startedAt: null, endedAt: null },
            resultAvailable: false,
          },
          {
            taskId: 'task-blocked', title: 'Synthesize', assignee: 'card_magentic', status: 'blocked',
            dependencyIds: ['task-running'], latestAttempt: null, resultAvailable: false,
          },
          {
            taskId: 'task-done', title: 'Scope mission', assignee: 'card_magentic', status: 'done',
            dependencyIds: [], latestAttempt: { runId: 3, status: 'completed', startedAt: 1, endedAt: 2 },
            resultAvailable: true,
          },
        ],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const view = render(<MagneticTasksTab
      projectId="project-1"
      deckId="deck_builder"
      cardId="card_magentic"
      cardTitlesByProfile={{
        'liquidaity-signal': 'Signal',
        card_magentic: 'Magnetic',
      }}
    />);

    expect(await screen.findByText('Collect evidence')).toBeTruthy();
    expect(screen.getByText('Signal')).toBeTruthy();
    expect(screen.getByText('Synthesize')).toBeTruthy();
    expect(screen.getByText('Scope mission')).toBeTruthy();
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getByTestId('flow-edge-task-running-task-blocked')).toBeTruthy();
    expect(screen.getByTestId('magnetic-task-task-running').getAttribute('style')).toContain('box-shadow');
    expect(screen.getByTestId('magnetic-task-task-done').getAttribute('style')).toContain('opacity: 0.58');
    expect(screen.queryByLabelText('Task details')).toBeNull();
    fireEvent.click(screen.getByTestId('flow-node-task-blocked'));
    const details = screen.getByLabelText('Task details');
    expect(details).toBeTruthy();
    expect(screen.getAllByText('Magnetic').length).toBeGreaterThan(0);
    expect(screen.getByText('Status · blocked')).toBeTruthy();
    expect(screen.getByText('Profile · card_magentic')).toBeTruthy();
    expect(screen.getByText('Depends · Collect evidence')).toBeTruthy();
    expect(details.textContent?.toLowerCase()).not.toContain('native');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body || '{}'));
    expect(body).toEqual({
      action: 'status',
      inspectOnly: true,
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId: 'card_magentic',
    });
    expect(body.action).not.toBe('execute');
    expect(body.action).not.toBe('stop');
    view.unmount();
  });

  it('shows a calm empty state when Magnetic has no current run', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const view = render(<MagneticTasksTab
      projectId="project-1"
      deckId="deck_builder"
      cardId="card_magentic"
      cardTitlesByProfile={{ card_magentic: 'Magnetic' }}
    />);
    await waitFor(() => expect(screen.getByText('Idle')).toBeTruthy());
    view.unmount();
  });

  it('bounds a stalled status read', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const view = render(<MagneticTasksTab
      projectId="project-1"
      deckId="deck_builder"
      cardId="card_magentic"
      cardTitlesByProfile={{ card_magentic: 'Magnetic' }}
    />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(screen.getByText('Unavailable').getAttribute('title')).toBe('timeout');
    view.unmount();
    vi.useRealTimers();
  });
});
