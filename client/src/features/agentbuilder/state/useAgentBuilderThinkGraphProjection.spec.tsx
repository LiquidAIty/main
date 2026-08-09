// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GraphProjectionV1 } from '../../../components/knowledge/NativeAuthorityGraphSurface';
import useAgentBuilderThinkGraphProjection, {
  mergeThinkGraphProjections,
} from './useAgentBuilderThinkGraphProjection';

function projection(
  id: string,
  properties: Record<string, unknown> = {},
): GraphProjectionV1 {
  return {
    schemaVersion: 'thinkgraph.live.projection.v1',
    authority: 'thinkgraph',
    projectId: 'project-1',
    counts: { nodes: 1, edges: 0 },
    nodes: [{
      id,
      label: id,
      mentionCount: 1,
      properties,
    }],
    edges: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('live ThinkGraph projection state', () => {
  it('merges transient observations without mutating the durable projection', () => {
    const durable = projection('durable-1', { persisted: true });
    const durableSnapshot = JSON.stringify(durable);
    const transient = projection('tg-live:1', { transient: true, persisted: false });

    const merged = mergeThinkGraphProjections(durable, transient);

    expect(merged?.nodes.map((node) => node.id)).toEqual(['durable-1', 'tg-live:1']);
    expect(merged?.nodes[0].properties?.presentationLayer).toBe('durable-background');
    expect(JSON.stringify(durable)).toBe(durableSnapshot);
  });

  it('projects the user immediately, coalesces reasoning, settles, and discards on next turn', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const source = body.streams.at(-1)?.source || 'user';
      return {
        ok: true,
        json: async () => projection(`tg-live:${source}`, {
          source,
          sourceId: `${body.runId}:${source}`,
          transient: true,
          persisted: false,
          state: body.state,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAgentBuilderThinkGraphProjection({
      activeProject: 'project-1',
      knowledgeGraphKind: 'knowgraph',
      workspaceView: 'chat',
    }));

    act(() => result.current.startLiveTurn({
      projectId: 'project-1',
      conversationId: 'main',
      runId: 'turn-1',
      text: 'Fix the build.',
      observedAt: '2026-08-09T12:00:00.000Z',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.projection?.nodes[0].id).toBe('tg-live:user');

    act(() => result.current.observeLiveTurnEvent({
      projectId: 'project-1',
      conversationId: 'main',
      runId: 'turn-1',
      observedAt: '2026-08-09T12:00:00.100Z',
      event: { kind: 'reasoning', text: 'Inspect startup ordering.' },
    }));
    act(() => result.current.observeLiveTurnEvent({
      projectId: 'project-1',
      conversationId: 'main',
      runId: 'turn-1',
      observedAt: '2026-08-09T12:00:00.120Z',
      event: { kind: 'reasoning', text: ' Check build output.' },
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const reasoningBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(reasoningBody.streams.find((stream: any) => stream.source === 'reasoning').text)
      .toBe('Inspect startup ordering. Check build output.');

    act(() => result.current.finishLiveTurn({
      projectId: 'project-1',
      conversationId: 'main',
      runId: 'turn-1',
      status: 'completed',
      observedAt: '2026-08-09T12:00:01.000Z',
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.projection?.nodes[0].properties?.state).toBe('settled');

    act(() => result.current.startLiveTurn({
      projectId: 'project-1',
      conversationId: 'main',
      runId: 'turn-2',
      text: 'Now inspect tests.',
      observedAt: '2026-08-09T12:00:02.000Z',
    }));
    expect(result.current.projection).toBeNull();
    const nextTurnBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1].body));
    expect(nextTurnBody.runId).toBe('turn-2');
    expect(nextTurnBody.streams).toHaveLength(1);
    expect(nextTurnBody.streams[0].source).toBe('user');
  });
});
