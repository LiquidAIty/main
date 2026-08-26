// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckDocument, KanbanCardRunStatus } from '../../../types/agentgraph';
import useKanbanCardRunStatus from './useKanbanCardRunStatus';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const deck: DeckDocument = {
  id: 'deck_builder',
  name: 'Agent Card Deck',
  version: 1,
  promptTemplates: [],
  nodes: [
    {
      id: 'card_hermes_steward',
      templateId: 'template_hermes_steward',
      title: 'Kanban',
      runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
      position: { x: 0, y: 0 },
    },
    {
      id: 'card_local_coder',
      templateId: 'template_local_coder',
      title: 'Coder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
      position: { x: 100, y: 0 },
    },
  ],
  edges: [],
};

const status: KanbanCardRunStatus = {
  runId: 'run-retained',
  correlationId: 'correlation-retained',
  cardId: 'card_hermes_steward',
  runtimeKind: 'hermes',
  runtimeMode: 'kanban',
  runtimeProfile: 'liquidaity-hermes-steward',
  state: 'running',
  status: 'working',
  nativeRootId: 't_retained_root',
  nativeRunId: 4,
  tasksCompleted: 2,
  tasksTotal: 5,
  activeWorkers: 2,
  elapsedMs: 10_000,
  toolCallCount: 7,
  graphReads: 2,
  graphWrites: 1,
  inputTokens: 120,
  outputTokens: 45,
  cachedTokens: 30,
  reasoningTokens: 12,
  costUsd: 0,
  resultReady: false,
  output: null,
  errorCode: null,
  errorSummary: null,
};

describe('useKanbanCardRunStatus', () => {
  it('reads only the saved Kanban Card and projects its retained Run without executing it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: status,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { result, unmount } = renderHook(() => useKanbanCardRunStatus({
      projectId: 'project-one',
      deck,
    }));

    await waitFor(() => expect(result.current.statuses.card_hermes_steward).toEqual(status));
    expect(result.current.activeCardIds).toEqual(['card_hermes_steward']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      action: 'status',
      projectId: 'project-one',
      deckId: 'deck_builder',
      cardId: 'card_hermes_steward',
    });
    unmount();
  });

  it('does not poll or retain stale status before the canonical Deck is ready', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useKanbanCardRunStatus({ projectId: '', deck }));

    await act(async () => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.statuses).toEqual({});
    expect(result.current.activeCardIds).toEqual([]);
  });
});
