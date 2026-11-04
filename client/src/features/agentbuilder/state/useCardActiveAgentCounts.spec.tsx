// @vitest-environment jsdom
// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Card Activity
// Relationship: Verifies that the existing activity view renders reported Hermes session counts and rejects malformed observations.

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

describe('Hermes live-session Card activity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the observed live-session count without inventing worker activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          { cardId: 'main', state: 'running', activeCount: 1 },
          { cardId: 'knowgraph', state: 'running', activeCount: 2, activeWorkers: 3 },
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
      knowgraph: 2,
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
