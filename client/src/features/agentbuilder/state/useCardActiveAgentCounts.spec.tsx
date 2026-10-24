// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckDocument } from '../../../types/agentgraph';
import useCardActiveAgentCounts from './useCardActiveAgentCounts';

const deck = {
  id: 'deck-one',
  name: 'Deck',
  promptTemplates: [],
  nodes: [
    {
      id: 'main', title: 'Main', templateId: 'template_assist',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      runtimeOptions: {}, position: { x: 0, y: 0 },
    },
    {
      id: 'knowgraph', title: 'KnowGraph', templateId: 'template_assist',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' },
      runtimeOptions: {}, position: { x: 0, y: 0 },
    },
  ],
  edges: [],
  version: 1,
} as DeckDocument;

describe('Run-derived Card activity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows one agent only for each actual active Card Run', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          { cardId: 'main', state: 'running' },
          { cardId: 'knowgraph', state: 'running', activeWorkers: 3 },
        ],
        failedCardIds: [],
      }),
    })));
    const { result, unmount } = renderHook(() => useCardActiveAgentCounts({
      projectId: 'project-one',
      deck,
    }));
    await waitFor(() => expect(result.current.activeAgentCounts).toEqual({
      main: 1,
      knowgraph: 1,
    }));
    expect(result.current.activeCardIds).toEqual(['main', 'knowgraph']);
    unmount();
  });

  it('does not present a failed or malformed observation as live activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          { cardId: 'main', state: 'completed' },
          { cardId: 'knowgraph', state: 9 },
        ],
        failedCardIds: [],
      }),
    })));
    const { result, unmount } = renderHook(() => useCardActiveAgentCounts({
      projectId: 'project-one',
      deck,
    }));
    await waitFor(() => expect(result.current.activeAgentCounts).toEqual({}));
    unmount();
  });
});
