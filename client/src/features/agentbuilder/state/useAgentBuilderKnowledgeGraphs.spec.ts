// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GraphProjectionV1 } from '../../../components/knowledge/KnowledgeAuthorityGraphSurface';
import useAgentBuilderKnowledgeGraphs, {
  withSettlementHeat,
} from './useAgentBuilderKnowledgeGraphs';

function projection(): GraphProjectionV1 {
  return {
    schemaVersion: 'thinkgraph.engraphis.v1',
    authority: 'engraphis',
    projectId: 'project-one',
    nodes: [
      { id: 'entity-one', canonicalId: 'canonical-one', label: 'One' },
      { id: 'entity-two', canonicalId: 'canonical-two', label: 'Two', turn_heat_active: true, turn_heat: 4 },
    ],
    edges: [],
  };
}

describe('settled graph heat', () => {
  it('marks only exact nodes changed by the completed settlement', () => {
    const source = projection();
    const heated = withSettlementHeat(source, ['entity-one']);

    expect(heated.nodes[0]).toMatchObject({ turn_heat_active: true, turn_heat: 1 });
    expect(heated.nodes[1]).not.toHaveProperty('turn_heat_active');
    expect(source.nodes[0]).not.toHaveProperty('turn_heat_active');
    expect(source.nodes[1]).toMatchObject({ turn_heat_active: true, turn_heat: 4 });
  });

  it('accepts the provider canonical entity ID and clears prior settlement heat', () => {
    const heated = withSettlementHeat(projection(), ['canonical-two']);

    expect(heated.nodes[0]).not.toHaveProperty('turn_heat_active');
    expect(heated.nodes[1]).toMatchObject({ turn_heat_active: true, turn_heat: 1 });
  });

  it('applies heat from the exact completed settlement during the ordinary refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
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
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));

    act(() => result.current.observeThinkGraphRevision({
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
      originatingRunId: 'run-one',
      stage: 'settled',
      revision: 'revision-two',
      changedNodeIds: ['entity-one'],
      changedEdgeIds: [],
      affectedNodeIds: ['entity-one'],
    }));

    await waitFor(() => expect(result.current.projections.thinkgraph.nodes[0])
      .toMatchObject({ turn_heat_active: true, turn_heat: 1 }));
    expect(result.current.projections.thinkgraph.nodes[1])
      .not.toHaveProperty('turn_heat_active');
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
