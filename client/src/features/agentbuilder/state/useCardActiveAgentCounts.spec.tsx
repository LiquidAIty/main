// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckDocument } from '../../../types/agentgraph';
import useCardActiveAgentCounts from './useCardActiveAgentCounts';

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
      id: 'card_test_delegate', templateId: 'template_assist', title: 'Delegate',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' }, position: { x: 0, y: 0 },
    },
    {
      id: 'card_hermes_steward', templateId: 'template_hermes_steward', title: 'Graph Agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'liquidaity-hermes-steward' }, position: { x: 100, y: 0 },
    },
  ],
  edges: [],
};

describe('useCardActiveAgentCounts', () => {
  it('keeps the polling schedule when rendering updates leave agent IDs unchanged', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ ok: true, result: null }), { status: 200 },
    ));
    const { rerender, unmount } = renderHook(({ currentDeck }) => useCardActiveAgentCounts({
      projectId: 'project-one', deck: currentDeck,
    }), { initialProps: { currentDeck: deck } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    for (let index = 0; index < 4; index += 1) {
      rerender({ currentDeck: { ...deck, nodes: deck.nodes.map((node) => ({ ...node, title: `${node.title} updated` })) } });
      await act(async () => undefined);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    rerender({ currentDeck: { ...deck, nodes: deck.nodes.slice(0, 1) } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    unmount();
  });

  it('projects only actual live owner plus child-worker counts without executing or reconciling', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({
        ok: true,
        result: body.cardId === 'card_hermes_steward'
          ? { cardId: body.cardId, state: 'running', activeWorkers: 2 }
          : { cardId: body.cardId, state: 'running', activeWorkers: 0 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const { result, unmount } = renderHook(() => useCardActiveAgentCounts({
      projectId: 'project-one', deck,
    }));

    await waitFor(() => expect(result.current.activeAgentCounts).toEqual({
      card_test_delegate: 1,
      card_hermes_steward: 3,
    }));
    expect(new Set(result.current.activeCardIds)).toEqual(new Set([
      'card_test_delegate', 'card_hermes_steward',
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toMatchObject({
        action: 'status', inspectOnly: true, projectId: 'project-one', deckId: 'deck_builder',
      });
    }
    unmount();
  });

  it('hides all counts for terminal Runs and before the canonical Deck is ready', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({
        ok: true,
        result: { cardId: body.cardId, state: 'completed', activeWorkers: 4 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const { result, unmount } = renderHook(() => useCardActiveAgentCounts({
      projectId: 'project-one', deck,
    }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.activeAgentCounts).toEqual({});
    unmount();

    fetchMock.mockClear();
    const notReady = renderHook(() => useCardActiveAgentCounts({ projectId: '', deck }));
    await act(async () => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notReady.result.current.activeAgentCounts).toEqual({});
  });

  it('fails closed to no badge when passive status observation is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }));
    const { result, unmount } = renderHook(() => useCardActiveAgentCounts({
      projectId: 'project-one', deck,
    }));
    await waitFor(() => expect(result.current.activeAgentCounts).toEqual({}));
    unmount();
  });
});
