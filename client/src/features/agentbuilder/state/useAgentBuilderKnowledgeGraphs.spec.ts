// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GraphProjectionV1 } from '../../../components/knowledge/KnowledgeAuthorityGraphSurface';
import useAgentBuilderKnowledgeGraphs from './useAgentBuilderKnowledgeGraphs';

function projection(): GraphProjectionV1 {
  return {
    schemaVersion: 'thinkgraph.engraphis.v1',
    authority: 'engraphis',
    projectId: 'project-one',
    nodes: [
      { id: 'entity-one', canonicalId: 'canonical-one', label: 'One' },
      { id: 'entity-two', canonicalId: 'canonical-two', label: 'Two' },
    ],
    edges: [],
  };
}

describe('KnowGraph route contracts', () => {
  it('deletes one exact Graphiti episode through the mounted endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith('/api/thinkgraph/projection?')) {
        return new Response(JSON.stringify(projection()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ nodes: [], relationships: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const { result } = renderHook(() => useAgentBuilderKnowledgeGraphs({
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
    }));
    await waitFor(() => expect(result.current.statuses.knowgraph).toBe('ready'));

    await act(async () => {
      await result.current.removeKnowGraphEvidence('episode-one');
    });

    const deletion = calls.find(call => call.url === '/api/knowgraph/delete-episode');
    expect(deletion?.init?.method).toBe('POST');
    expect(JSON.parse(String(deletion?.init?.body))).toEqual({
      project_id: 'project-one',
      graphiti_episode_uuid: 'episode-one',
    });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
