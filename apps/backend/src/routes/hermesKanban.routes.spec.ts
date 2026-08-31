import { describe, expect, it, vi } from 'vitest';

import {
  deriveHermesKanbanProgress,
  readHermesKanbanSessionUsage,
  readHermesKanbanCardSnapshots,
  reclaimNativeHermesKanbanTask,
  rejoinNativeHermesKanbanTask,
  resolveHermesKanbanCardExecutionContext,
  terminateNativeHermesKanbanRun,
  waitForHermesKanbanCardTask,
  type HermesKanbanTaskSnapshot,
} from './hermesKanban.routes';

function snapshot(
  id: string,
  task: Record<string, unknown>,
  children: string[] = [],
  parents: string[] = [],
): HermesKanbanTaskSnapshot {
  return {
    task: { id, ...task },
    latest_summary: task.result ?? null,
    parents,
    children,
    events: [],
    runs: [],
  };
}

describe('internal native Team task projection and recovery', () => {
  it('reads the exact root/child graph without dispatch or product routing', async () => {
    const root = snapshot('t_root', {
      created_by: 'delegate_task:team',
      project_id: 'project-1',
      status: 'working',
    }, ['t_child']);
    const child = snapshot('t_child', { status: 'done', result: 'worker result' });
    const show = vi.fn(async (id: string) => id === 't_root' ? root : child);

    await expect(readHermesKanbanCardSnapshots({
      nativeRootId: 't_root',
      cardId: 'delegate_task:team',
      projectId: 'project-1',
    }, show)).resolves.toEqual([root, child]);
    expect(show.mock.calls.map(([id]) => id)).toEqual(['t_root', 't_child']);
  });

  it('correlates a Team child to one SQL root/Card authority and sorts grants', async () => {
    const root = snapshot('t_root', {
      created_by: 'delegate_task:team',
      project_id: 'project-1',
      status: 'working',
    }, ['t_child']);
    const child = snapshot('t_child', { status: 'working' }, [], ['t_root']);
    const show = vi.fn(async (id: string) => id === 't_root' ? root : child);
    const resolveRun = vi.fn(async () => ({
      ok: true,
      context: {
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        runId: 'child-run-1',
        rootRunId: 'root-run-1',
        cardId: 'card_graph_agent',
        cardRevisionId: 'revision-1',
        runtimeMode: 'delegate',
        runtimeProfile: 'liquidaity-hermes-steward',
        nativeRootId: 't_root',
        grantedTools: ['graphiti.add_memory', 'cbm.search_graph'],
      },
    }));

    await expect(resolveHermesKanbanCardExecutionContext({
      projectId: 'project-1',
      deckId: 'deck_builder',
      taskId: 't_child',
      show,
      resolveRun,
    })).resolves.toEqual({
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      runId: 'child-run-1',
      rootRunId: 'root-run-1',
      cardId: 'card_graph_agent',
      cardRevisionId: 'revision-1',
      runtimeMode: 'delegate',
      runtimeProfile: 'liquidaity-hermes-steward',
      nativeRootId: 't_root',
      nativeChildId: 't_child',
      grantedTools: ['cbm.search_graph', 'graphiti.add_memory'],
    });
    expect(resolveRun).toHaveBeenCalledWith({
      projectId: 'project-1',
      deckId: 'deck_builder',
      nativeTaskIds: ['t_child', 't_root'],
    });
  });

  it('derives truthful active-worker progress from native task snapshots', () => {
    const root = snapshot('t_root', { status: 'working' }, ['t_done', 't_working']);
    const done = snapshot('t_done', { status: 'done', result: 'done' });
    const working = snapshot('t_working', { status: 'running', session_id: 'worker-session' });
    working.runs = [{
      id: 7,
      status: 'running',
      ended_at: null,
      metadata: { worker_session_id: 'worker-session' },
    }];

    expect(deriveHermesKanbanProgress('t_root', [root, done, working])).toEqual({
      nativeRootId: 't_root',
      nativeRunId: null,
      phase: 'working',
      tasksCompleted: 1,
      tasksTotal: 3,
      activeWorkers: 1,
      workerSessionIds: ['worker-session'],
      teamReceipt: null,
    });
  });

  it('projects the applied native Team policy as telemetry, not another receipt authority', () => {
    const root = snapshot('t_root', { status: 'triage' });
    root.events = [{
      kind: 'team_policy_applied',
      payload: {
        schema_version: 'hermes.team.policy.v1', source: 'host_session', mode: 'auto',
        max_workers: 2, retry_limit: 0, max_retries: 1,
        worker_provider: 'openai-codex', worker_model: 'gpt-5.6-luna',
        lead_provider: 'openai-codex', lead_model: 'gpt-5.6-terra', max_depth: 1,
      },
    }];
    expect(deriveHermesKanbanProgress('t_root', [root]).teamReceipt).toEqual({
      schemaVersion: 'hermes.team.policy.v1', source: 'host_session', mode: 'auto',
      maxWorkers: 2, retryLimit: 0, maxRetries: 1,
      workerProvider: 'openai-codex', workerModel: 'gpt-5.6-luna',
      leadProvider: 'openai-codex', leadModel: 'gpt-5.6-terra', maxDepth: 1,
    });
  });

  it('sums exact redacted native session usage without provider substitution', async () => {
    const runner = vi.fn(async (args: readonly string[]) => {
      const sessionId = String(args[args.indexOf('--session-id') + 1]);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: sessionId,
          tool_call_count: 2,
          input_tokens: 10,
          output_tokens: 4,
          cache_read_tokens: 5,
          cache_write_tokens: 1,
          reasoning_tokens: 3,
          actual_cost_usd: 0,
        }),
        stderr: '',
      };
    });

    await expect(readHermesKanbanSessionUsage(
      'liquidaity-hermes-steward',
      ['worker-one', 'worker-two'],
      runner as never,
    )).resolves.toEqual({
      toolCallCount: 4,
      providerInputTokens: 20,
      providerOutputTokens: 8,
      providerCachedTokens: 12,
      providerReasoningTokens: 6,
      totalCostUsd: 0,
    });
  });

  it('waits through the Team correlation barrier and returns one synthesis', async () => {
    const show = vi.fn()
      .mockResolvedValueOnce(snapshot('t_root', {
        status: 'blocked',
        workflow_template_id: 'delegate-team-v1',
        current_step_key: 'correlation',
      }))
      .mockResolvedValueOnce(snapshot('t_root', {
        status: 'done',
        result: 'Team synthesis',
      }));

    await expect(waitForHermesKanbanCardTask('default', 't_root', {
      show,
      pause: async () => undefined,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      taskId: 't_root',
      snapshot: { latest_summary: 'Team synthesis' },
    });
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('bounds transient native read loss and fails visibly after the limit', async () => {
    const show = vi.fn(async () => {
      throw new Error('bridge-unavailable');
    });
    await expect(waitForHermesKanbanCardTask('default', 't_root', {
      show,
      pause: async () => undefined,
      maxConsecutiveShowFailures: 2,
    })).rejects.toThrow('hermes_kanban_card_show_failed');
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('rejoins one retained Team root and enforces Card/project identity', async () => {
    const done = snapshot('t_root', {
      status: 'done',
      result: 'Recovered synthesis',
      created_by: 'delegate_task:team',
      project_id: 'project-1',
      session_id: 'root-session',
    });
    const requestExtension = vi.fn(async () => done);
    const onProgress = vi.fn();

    await expect(rejoinNativeHermesKanbanTask({
      profile: 'default',
      taskId: 't_root',
      expectedCardId: 'delegate_task:team',
      expectedProjectId: 'project-1',
      requestExtension: requestExtension as never,
      onProgress,
    })).resolves.toMatchObject({
      finalText: 'Recovered synthesis',
      sessionId: 'root-session',
      progress: { nativeRootId: 't_root', phase: 'complete' },
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('keeps native reclaim/terminate controls internal and authoritative', async () => {
    const requestExtension = vi.fn(async (method: string, params: Record<string, unknown>) =>
      snapshot(String(params.taskId || 't_running'), {
        status: 'todo',
        result: method,
      }));

    await expect(reclaimNativeHermesKanbanTask(
      't_running',
      'recovery reclaim',
      requestExtension as never,
    )).resolves.toMatchObject({ task: { id: 't_running', status: 'todo' } });
    await expect(terminateNativeHermesKanbanRun(
      41,
      'recovery terminate',
      requestExtension as never,
    )).resolves.toMatchObject({ task: { id: 't_running', status: 'todo' } });
    expect(requestExtension.mock.calls.map(([method]) => method)).toEqual([
      '_kanban/reclaim',
      '_kanban/terminate',
    ]);
  });
});
