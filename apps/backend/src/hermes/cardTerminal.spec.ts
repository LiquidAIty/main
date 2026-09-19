import { describe, expect, it } from 'vitest';
import { buildCardTerminal, projectKanbanTerminal, terminalText } from './cardTerminal';

const run = {
  projectId: 'p',
  deckId: 'd',
  cardId: 'c',
  runId: 'root',
  state: 'running',
  runtimeKind: 'hermes',
  startedAt: '2026-08-26T01:00:00Z',
  terminal: {
    cardName: 'Saved name',
    parentRunIds: ['sender'],
    activeChildren: 1,
    children: [
      {
        runId: 'child', cardId: 'c', cardName: 'Saved name', parentRunId: 'root',
        nativeChildId: 'native-child', state: 'running',
        startedAt: '2026-08-26T01:00:01Z', finishedAt: null,
      },
      {
        runId: 'done-child', cardId: 'c', cardName: 'Saved name', parentRunId: 'root',
        nativeChildId: 'native-done', state: 'failed',
        startedAt: '2026-08-26T01:00:02Z', finishedAt: '2026-08-26T01:00:03Z',
        errorCode: 'hermes_native_child_failed',
      },
    ],
  },
};

describe('persisted Run to Card terminal presentation', () => {
  it('retains saved Run identity, child lineage, terminal failures, and executing-only count', () => {
    const value = buildCardTerminal(run);
    expect(value.activeAgentCount).toBe(2);
    expect(value.events[0]).toMatchObject({
      id: 'root:session', kind: 'session', runId: 'root', parentRunId: 'sender', status: 'running',
    });
    expect(value.events.find((event) => event.kind === 'child_finished')).toMatchObject({
      runId: 'done-child', nativeChildId: 'native-done', parentRunId: 'root',
      status: 'failed', detail: 'hermes_native_child_failed',
    });
    expect(buildCardTerminal({ ...run, state: 'completed', result: 'Accepted result' })).toMatchObject({
      activeAgentCount: 0, finalText: 'Accepted result', observation: 'finished', unavailableReason: null,
    });
    expect(buildCardTerminal({ ...run, state: 'pending' })).toMatchObject({
      activeAgentCount: 0, observation: 'unavailable', unavailableReason: null,
    });
  });

  it('reports only the owning runtime surface for live detail', () => {
    expect(buildCardTerminal(run)).toMatchObject({
      observation: 'unavailable', unavailableReason: 'hermes_gateway_stream_only',
    });
    expect(buildCardTerminal({ ...run, runtimeMode: 'magentic_one' })).toMatchObject({
      observation: 'unavailable', unavailableReason: 'magentic_execution_headless',
    });
  });

  it('uses persistent native task event and attempt IDs across refresh', () => {
    const native = {
      task: { id: 't_native', title: 'Native task', status: 'running' },
      parents: [],
      children: [],
      events: [{
        id: 7, kind: 'claimed', run_id: 42, created_at: 1780000002,
        payload: { status: 'running' },
      }],
      runs: [
        { id: 41, status: 'failed', started_at: 1780000000, ended_at: 1780000001 },
        { id: 42, status: 'running', started_at: 1780000002, ended_at: null },
      ],
    };
    const value = projectKanbanTerminal(
      { ...run, runtimeMode: 'kanban', terminal: {} },
      [native],
    );
    expect(value.activeAgentCount).toBe(1);
    expect(value.nativeTasks).toEqual([native.task]);
    expect(value.events.find((event) => event.kind === 'task')).toMatchObject({
      taskId: 't_native', agentId: '42', runId: 'root', id: 'root:kanban:t_native:event:7',
    });
    expect(value.events.filter((event) => event.kind === 'child_started').map((event) => event.agentId))
      .toEqual(['41', '42']);
    expect(projectKanbanTerminal(
      { ...run, runtimeMode: 'kanban', terminal: {} },
      [native],
    ).events).toEqual(value.events);
  });

  it('redacts credential-shaped fields without changing the source value', () => {
    const raw = '{"query":"keep this","headers":{"Authorization":"Bearer example"},"nested":{"api_key":"private"}}';
    expect(terminalText(raw)).toContain('keep this');
    expect(terminalText(raw)).not.toContain('private');
    expect(terminalText(raw)).not.toContain('Bearer example');
    expect(terminalText('failure Bearer secret sk-example123')).toBe('failure Bearer [redacted] [redacted]');
    expect(raw).toContain('private');
    expect(terminalText('SOME_ENV="not for display" password=hidden https://user:pass@example.com'))
      .not.toMatch(/not for display|hidden|user:pass/);
    expect(terminalText({
      environment: { HOME: 'private location' }, credentials: 'hidden', blob: 'binary content',
    })).not.toMatch(/private location|hidden|binary content/);
  });
});
