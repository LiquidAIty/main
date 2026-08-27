import { describe, expect, it } from 'vitest';
import { buildCardTerminal, projectHermesEvent, projectKanbanTerminal, terminalHistoryEvents, terminalText } from './cardTerminal';
import type { HermesRunSnapshot } from './mainAdapter';

const run = {
  projectId: 'p', deckId: 'd', cardId: 'c', runId: 'root', state: 'running', runtimeKind: 'hermes',
  terminal: { cardName: 'Saved name', parentRunIds: ['sender'], activeChildren: 1, children: [
    { runId: 'child', cardId: 'c', cardName: 'Saved name', parentRunId: 'root', nativeChildId: 'native-child',
      state: 'running', startedAt: '2026-08-26T01:00:01Z', finishedAt: null },
    { runId: 'done-child', cardId: 'c', cardName: 'Saved name', parentRunId: 'root', nativeChildId: 'native-done',
      state: 'failed', startedAt: '2026-08-26T01:00:02Z', finishedAt: '2026-08-26T01:00:03Z', errorCode: 'hermes_native_child_failed' },
  ], transcript: { sessionId: 's', unavailableReason: null } },
};
const snapshot: HermesRunSnapshot = { projectId: 'p', deckId: 'd', cardId: 'c', cardName: 'Saved name', runId: 'root',
  sessionId: 's', fullText: 'Actual model text', textSequence: 1, textTimestamp: '2026-08-26T01:00:00Z',
  tools: [{ toolName: 'cbm.search_graph', toolUseId: 'tool-1', argsJson: '{"query":"one symbol"}',
    output: '{"error":"not_indexed"}', isError: true, sequence: 2,
    timestamp: '2026-08-26T01:00:01Z', completedAt: '2026-08-26T01:00:02Z' }],
};

describe('existing Run to Card terminal presentation', () => {
  it('uses one native tool identity for Main SSE, Card status and transcript replay', () => {
    const statusEvent = buildCardTerminal(run, snapshot).events.find((event) => event.kind === 'tool_error')!;
    const native = { kind: 'tool_result' as const, toolName: 'cbm.search_graph', toolUseId: 'tool-1',
      output: '{"error":"not_indexed"}', isError: true };
    const live = projectHermesEvent(statusEvent, native, 99, null)!;
    const replay = terminalHistoryEvents(run, [native])[0];
    expect(live.id).toBe(statusEvent.id);
    expect(replay.id).toBe(statusEvent.id);
    expect(live.detail).toBe(statusEvent.detail);
    expect(replay.detail).toBe(statusEvent.detail);
  });
  it('uses persistent native task event and attempt IDs across refresh/replacement', () => {
    const native = { task: { id: 't_native', title: 'Native task', status: 'running' }, parents: [], children: [],
      events: [{ id: 7, kind: 'claimed', run_id: 42, created_at: 1780000002, payload: { status: 'running' } }],
      runs: [{ id: 41, status: 'failed', started_at: 1780000000, ended_at: 1780000001 },
        { id: 42, status: 'running', started_at: 1780000002, ended_at: null }],
    };
    const value = projectKanbanTerminal({ ...run, runtimeMode: 'kanban', terminal: {} }, [native]);
    expect(value.activeAgentCount).toBe(1);
    expect(value.nativeTasks).toEqual([native.task]);
    expect(value.events.find((event) => event.kind === 'task')).toMatchObject({ taskId: 't_native', agentId: '42',
      runId: 'root', id: 'root:kanban:t_native:event:7' });
    expect(value.events.filter((event) => event.kind === 'child_started').map((event) => event.agentId)).toEqual(['41', '42']);
    expect(projectKanbanTerminal({ ...run, runtimeMode: 'kanban', terminal: {} }, [native]).events).toEqual(value.events);
  });

  it('retains partial tool output before its final structured failure', () => {
    const value = buildCardTerminal(run, { ...snapshot, tools: [{ ...snapshot.tools[0], partialOutput: 'first page', partialSequence: 3,
      partialTimestamp: '2026-08-26T01:00:01Z', completedSequence: 4 }] });
    expect(value.events.find((event) => event.status === 'running' && event.kind === 'tool_result')?.detail).toBe('first page');
    expect(value.events.find((event) => event.kind === 'tool_error')?.detail).toContain('not_indexed');
    expect(buildCardTerminal(run, null).activeAgentCount).toBeNull();
  });
  it('retains attribution, tool failure, native child identity and an executing-only count', () => {
    const value = buildCardTerminal(run, snapshot);
    expect(value.activeAgentCount).toBe(2);
    expect(value.events.find((event) => event.kind === 'tool_error')).toMatchObject({
      projectId: 'p', deckId: 'd', cardId: 'c', cardName: 'Saved name', runId: 'root', parentRunId: 'sender',
      toolUseId: 'tool-1', status: 'failed', timestamp: snapshot.tools[0].completedAt,
    });
    expect(value.events.find((event) => event.kind === 'child_finished')).toMatchObject({
      runId: 'done-child', nativeChildId: 'native-done', parentRunId: 'root', status: 'failed',
    });
    expect(buildCardTerminal({ ...run, state: 'completed', result: 'Accepted result' }, null)).toMatchObject({
      activeAgentCount: 0, finalText: 'Accepted result', observation: 'finished',
    });
    expect(buildCardTerminal({ ...run, state: 'pending' }, null)).toMatchObject({
      activeAgentCount: 0, observation: 'unavailable', unavailableReason: null,
    });
  });

  it('refuses a mismatched snapshot and never substitutes Hermes for AutoGen', () => {
    expect(() => buildCardTerminal(run, { ...snapshot, cardId: 'another' })).toThrow('identity_mismatch');
    expect(buildCardTerminal({ ...run, runtimeKind: 'autogen' }, null)).toMatchObject({
      observation: 'unavailable', unavailableReason: 'autogen_adapter_completion_only', events: expect.any(Array),
    });
  });

  it('uses stable IDs for repeated snapshots and leaves unavailable timestamps unknown', () => {
    expect(buildCardTerminal(run, snapshot).events).toEqual(buildCardTerminal(run, snapshot).events);
    const events = terminalHistoryEvents(run, [
      { kind: 'reasoning', source: 'provider_exposed', text: 'not public output' },
      { kind: 'text', text: 'Persisted model text' },
      { kind: 'tool_result', toolName: 'lookup', toolUseId: 'one', output: 'failed', isError: true },
    ]);
    expect(events.map((event) => event.kind)).toEqual(['model', 'tool_error']);
    expect(events.every((event) => event.timestamp === null)).toBe(true);
    expect(events[0]).toMatchObject({ runId: 'root', cardId: 'c', parentRunId: 'sender' });
  });

  it('redacts credential-shaped fields without changing the original saved/native data', () => {
    const raw = '{"query":"keep this","headers":{"Authorization":"Bearer example"},"nested":{"api_key":"private"}}';
    expect(terminalText(raw)).toContain('keep this');
    expect(terminalText(raw)).not.toContain('private');
    expect(terminalText(raw)).not.toContain('Bearer example');
    expect(terminalText('failure Bearer secret sk-example123')).toBe('failure Bearer [redacted] [redacted]');
    expect(raw).toContain('private');
    expect(terminalText('SOME_ENV="not for display" password=hidden https://user:pass@example.com')).not.toMatch(/not for display|hidden|user:pass/);
    expect(terminalText({ environment: { HOME: 'private location' }, credentials: 'hidden', blob: 'binary content' }))
      .not.toMatch(/private location|hidden|binary content/);
  });
});
