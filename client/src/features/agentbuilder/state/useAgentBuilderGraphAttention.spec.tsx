// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useAgentBuilderGraphAttention, {
  projectNativeAttentionEvent,
  type NativeAttentionEdge,
  type NativeAttentionEvent,
} from './useAgentBuilderGraphAttention';

const turn = {
  projectId: 'project-1',
  conversationId: 'main',
  runId: 'run-1',
  text: 'Inspect native graph data.',
  observedAt: '2026-08-17T12:00:00.000Z',
};

function attention(
  authority: NativeAttentionEvent['authority'],
  nativeNodeIds: string[],
  nativeEdgeIds: string[] = [],
  cardId: string | null = 'card_main_chat',
  nativeEdges: NativeAttentionEdge[] = [],
): NativeAttentionEvent {
  return {
    kind: 'native_attention',
    eventId: `event-${authority}`,
    timestamp: '2026-08-18T12:00:00Z',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'main',
    runId: 'server-run-1',
    cardId,
    authority,
    operation: 'read',
    toolName: authority === 'codegraph' ? 'cbm.search_graph'
      : authority === 'knowgraph' ? 'graphiti.search_nodes' : 'constellation.context',
    nativeNodeIds,
    nativeEdgeIds,
    nativeEdges,
    resultHash: 'a'.repeat(64),
    truncated: false,
  };
}

function constellationResponse(
  nodes: Array<Record<string, unknown>> = [],
  edges: Array<Record<string, unknown>> = [],
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      schemaVersion: 'thinkgraph.constellation.v1',
      authority: 'constellation-engine',
      projectId: 'project-1',
      revision: 'constellation-test-revision',
      embedding: { state: 'degraded', reason: 'test_embedding_unavailable' },
      counts: { nodes: nodes.length, edges: edges.length },
      nodes,
      edges,
    }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('attention-activated native graph projection', () => {
  it('projects only exact Python-owned native references without parsing provider JSON', () => {
    const result = projectNativeAttentionEvent({
      event: attention('codegraph', ['pkg.alpha', 'pkg.beta', 'pkg.alpha']),
      projectId: 'project-1',
    });

    expect(result?.authority).toBe('codegraph');
    expect(result?.projection.nodes.map((node) => node.id)).toEqual(['pkg.alpha', 'pkg.beta']);
    expect(result?.projection.edges).toEqual([]);
    expect(result?.projection.nodes[0].properties).toMatchObject({
      nativeId: 'pkg.alpha',
      attentionActorCardId: 'card_main_chat',
      attentionActorColor: '#37ADAA',
      attentionToolName: 'cbm.search_graph',
    });
  });

  it('uses the canonical Python-owned tool name without browser normalization', () => {
    const event = attention('codegraph', ['pkg.alpha']);
    const result = projectNativeAttentionEvent({
      event,
      projectId: 'project-1',
    });

    expect(result?.authority).toBe('codegraph');
    expect(result?.projection.nodes[0].properties?.attentionToolName).toBe(
      'cbm.search_graph',
    );
  });

  it('uses neutral provenance when no Card identity is proven', () => {
    const result = projectNativeAttentionEvent({
      event: attention('thinkgraph', ['memory-one'], [], null),
      projectId: 'project-1',
    });

    expect(result?.projection.nodes[0].properties).toMatchObject({
      attentionActorCardId: null,
      attentionActorColor: '#8B95A7',
    });
  });

  it('keeps authorities separate and never invents endpoints for edge-only events', () => {
    const think = projectNativeAttentionEvent({
      event: attention('thinkgraph', ['mem-1']),
      projectId: 'project-1',
    })!;
    const know = projectNativeAttentionEvent({
      event: attention('knowgraph', [], ['edge-1']),
      projectId: 'project-1',
    });

    expect(think.authority).toBe('thinkgraph');
    expect(think.projection.nodes.map((node) => node.id)).toEqual(['mem-1']);
    expect(know).toBeNull();
  });

  it('starts all three canvases empty, wakes exact Graphiti write data, and clears on the next scope', async () => {
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
    expect(result.current.projections.codegraph.nodes).toEqual([]);

    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: {
        kind: 'session', runId: 'server-run-1', projectId: 'project-1',
        deckId: 'deck_builder', conversationId: 'main',
      },
    }));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: {
        ...attention('knowgraph', ['node-a', 'node-b'], ['edge-1'], 'card_main_chat', [{
          id: 'edge-1', source: 'node-a', target: 'node-b', predicate: 'USES',
          provenance: { group_id: 'group-one' },
        }]),
        operation: 'write',
      },
    }));

    await waitFor(() => expect(result.current.projections.knowgraph.nodes).toHaveLength(2));
    expect(result.current.projections.knowgraph.edges).toEqual([
      expect.objectContaining({ id: 'edge-1', source: 'node-a', target: 'node-b', predicate: 'USES' }),
    ]);
    expect(result.current.projections.knowgraph.nodes[0].properties).toMatchObject({
      attentionOperation: 'write', attentionActorColor: '#EE8C66', attentionRunId: 'server-run-1',
    });
    expect(result.current.projections.knowgraph.edges[0].provenance).toMatchObject({
      authority: 'knowgraph', operation: 'write', group_id: 'group-one',
    });
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    expect(result.current.projections.codegraph.nodes).toEqual([]);

    act(() => result.current.startAttentionScope({ ...turn, runId: 'run-2' }));
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
  });

  it('restores persisted ThinkGraph attention only on an authoritative Constellation node', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(constellationResponse([
      { id: 'mem-1', canonicalId: 'mem-1', label: 'Real memory', mentionCount: 1, properties: {}, provenance: { engine: 'constellation-engine' } },
    ])));
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    act(() => {
      result.current.observeAttentionEvent(attention('thinkgraph', ['mem-1']));
      result.current.observeAttentionEvent(attention('codegraph', ['pkg.materialize_idf']));
    });

    await waitFor(() => expect(result.current.projections.thinkgraph.nodes).toHaveLength(1));
    expect(result.current.projections.thinkgraph.nodes[0].id).toBe('mem-1');
    expect(result.current.projections.thinkgraph.nodes[0].label).toBe('Real memory');
    expect(result.current.projections.thinkgraph.nodes[0].provenance).toEqual({ engine: 'constellation-engine' });
    expect(result.current.projections.thinkgraph.nodes[0].properties).toMatchObject({
      attentionToolName: 'constellation.context',
    });
    expect(result.current.projections.codegraph.nodes[0].id).toBe('pkg.materialize_idf');
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
  });

  it('rejects duplicate, wrong-project, and wrong-Run live attention', async () => {
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: {
        kind: 'session', runId: 'server-run-1', projectId: 'project-1',
        deckId: 'deck_builder', conversationId: 'main',
      },
    }));
    const valid = attention('codegraph', ['pkg.alpha']);
    act(() => {
      result.current.observeNativeTurnEvent({ ...turn, event: valid });
      result.current.observeNativeTurnEvent({ ...turn, event: valid });
      result.current.observeNativeTurnEvent({
        ...turn,
        event: { ...attention('codegraph', ['pkg.wrong-project']), eventId: 'wrong-project', projectId: 'project-2' },
      });
      result.current.observeNativeTurnEvent({
        ...turn,
        event: { ...attention('codegraph', ['pkg.wrong-run']), eventId: 'wrong-run', runId: 'server-run-2' },
      });
    });

    await waitFor(() => expect(result.current.projections.codegraph.nodes.map((node) => node.id)).toEqual(['pkg.alpha']));
  });

  it('restores only the latest scoped Run and ignores duplicate event identities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(constellationResponse([
      { id: 'current-memory', canonicalId: 'current-memory', label: 'Current memory', mentionCount: 1, properties: {} },
    ])));
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      selectedCardId: 'card_main_chat',
    }));
    const old = {
      ...attention('thinkgraph', ['old-memory']),
      eventId: 'old-event', runId: 'old-run', timestamp: '2026-08-18T11:00:00Z',
    };
    const latest = {
      ...attention('thinkgraph', ['current-memory']),
      eventId: 'current-event', runId: 'current-run', timestamp: '2026-08-18T12:00:00Z',
    };
    act(() => result.current.observeAttentionSession({
      projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat',
      runId: 'current-run', state: 'running',
    }));
    act(() => [
      old,
      latest,
      latest,
      { ...latest, eventId: 'wrong-project', projectId: 'project-2', timestamp: '2026-08-18T13:00:00Z' },
    ].forEach(result.current.observeAttentionEvent));

    await waitFor(() => expect(result.current.projections.thinkgraph.nodes.map((node) => node.id)).toEqual([
      'current-memory',
    ]));
  });

  it('uses the same AGE events for GPT, Hermes, Kanban, Coder and Mag One without a Main turn', () => {
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    act(() => {
      ['gpt', 'hermes', 'kanban', 'coder', 'mag-one'].forEach((cardId) => {
        result.current.observeAttentionEvent({ ...attention('codegraph', [`pkg.${cardId}`], [], cardId),
          eventId: `event-${cardId}`, runId: `run-${cardId}`, conversationId: `conversation-${cardId}` });
      });
    });
    expect(result.current.projections.codegraph.nodes.map((node) => node.id)).toEqual([
      'pkg.gpt', 'pkg.hermes', 'pkg.kanban', 'pkg.coder', 'pkg.mag-one',
    ]);
    act(() => result.current.startAttentionScope(turn));
    expect(result.current.projections.codegraph.nodes).toHaveLength(5);
  });

  it('shows only direct current-Run materialization and hides it when the selected Card finishes', () => {
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main', selectedCardId: 'card-kanban',
    }));
    const session = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-kanban',
      runId: 'root-run', state: 'running', materializedNativeReferences: [{ authority: 'CodeGraph', nativeId: 'pkg.input' }] };
    act(() => result.current.observeAttentionSession(session));
    act(() => {
      const direct = { ...attention('codegraph', ['pkg.direct'], [], 'card-kanban'), eventId: 'direct', runId: 'root-run' };
      result.current.observeAttentionEvent(direct);
      result.current.observeAttentionEvent({ ...direct, eventId: 'child', nativeChildId: 'native-worker', nativeNodeIds: ['pkg.child'] });
      result.current.observeAttentionEvent({ ...direct, eventId: 'old', runId: 'old-run', nativeNodeIds: ['pkg.old'] });
      result.current.observeAttentionSession({ ...session, runId: 'child-run', nativeChildId: 'native-worker',
        materializedNativeReferences: [{ authority: 'CodeGraph', nativeId: 'pkg.child-input' }] });
    });
    expect(result.current.projections.codegraph.nodes.map((node) => node.id)).toEqual(['pkg.input', 'pkg.direct']);
    act(() => result.current.observeAttentionSession({ ...session, state: 'completed' }));
    expect(result.current.projections.codegraph.nodes).toEqual([]);
    act(() => result.current.observeAttentionEvent({ ...attention('codegraph', ['pkg.stale'], [], 'card-kanban'), runId: 'root-run' }));
    expect(result.current.projections.codegraph.nodes).toEqual([]);
  });

  it('keeps independent Card attention when Main switches conversations', () => {
    const { result, rerender } = renderHook(({ conversationId }) => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId,
    }), { initialProps: { conversationId: 'main' } });
    act(() => result.current.observeAttentionEvent({ ...attention('codegraph', ['pkg.coder'], [], 'card-coder'),
      eventId: 'coder-event', runId: 'coder-run', conversationId: 'coder-conversation' }));
    rerender({ conversationId: 'other-main-conversation' });
    expect(result.current.projections.codegraph.nodes.map((node) => node.id)).toEqual(['pkg.coder']);
  });

  it('never lights pending writes and applies only acknowledged native deletions', () => {
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    const event = { ...attention('knowgraph', ['node-a']), operation: 'write' as const, change: 'create' as const };
    act(() => result.current.observeAttentionEvent({ ...event, phase: 'pending' }));
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
    act(() => result.current.observeAttentionEvent({ ...event, phase: 'completed' }));
    expect(result.current.projections.knowgraph.nodes.map((node) => node.id)).toEqual(['node-a']);
    act(() => result.current.observeAttentionEvent({ ...event, eventId: 'delete', change: 'delete', phase: 'completed' }));
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
  });

  it('expands a visible ThinkGraph memory through the native neighborhood route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(constellationResponse([
        { id: 'mem-1', canonicalId: 'mem-1', label: 'Center', mentionCount: 1, properties: {} },
      ]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
        nodes: [
          { id: 'mem-1', canonicalId: 'mem-1', label: 'Center', properties: {} },
          { id: 'mem-2', canonicalId: 'mem-2', label: 'Neighbor', properties: {} },
        ],
        edges: [{ id: 'edge-1', source: 'mem-1', target: 'mem-2', predicate: 'related' }],
      }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    await waitFor(() => expect(result.current.projections.thinkgraph.nodes).toHaveLength(1));
    const center = result.current.projections.thinkgraph.nodes[0];

    await act(async () => result.current.expandNode({
      authority: 'thinkgraph',
      node: center,
      projectId: 'project-1',
      codeGraphProject: null,
    }));

    expect(fetchMock).toHaveBeenCalledWith('/api/thinkgraph/neighborhood?projectId=project-1&canonicalId=mem-1');
    expect(result.current.projections.thinkgraph.nodes.map((node) => node.id)).toEqual(['mem-1', 'mem-2']);
    expect(result.current.projections.thinkgraph.edges.map((edge) => edge.id)).toEqual(['edge-1']);
  });

  it('expands a visible KnowGraph UUID through the bounded native Neo4j route', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(constellationResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
        nodes: [
          { id: 'node-a', label: 'Alpha', type: 'Entity', properties: { uuid: 'node-a' } },
          { id: 'node-b', label: 'Beta', type: 'Entity', properties: { uuid: 'node-b' } },
        ],
        relationships: [{ id: 'edge-1', from: 'node-a', to: 'node-b', type: 'USES' }],
      }),
      }));
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: {
        kind: 'session', runId: 'server-run-1', projectId: 'project-1',
        deckId: 'deck_builder', conversationId: 'main',
      },
    }));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: attention('knowgraph', ['node-a']),
    }));
    const center = result.current.projections.knowgraph.nodes[0];

    await act(async () => result.current.expandNode({
      authority: 'knowgraph', node: center, projectId: 'project-1', codeGraphProject: null,
    }));

    expect(fetch).toHaveBeenCalledWith('/api/knowgraph/expand?projectId=project-1&nodeId=node-a&limit=50&depth=1');
    expect(result.current.projections.knowgraph.nodes.map((node) => node.id)).toEqual(['node-a', 'node-b']);
    expect(result.current.projections.knowgraph.edges.map((edge) => edge.id)).toEqual(['edge-1']);
  });

  it('expands a visible CodeGraph symbol through native CBM trace_path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(constellationResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
        result: {
          content: [{ type: 'text', text: JSON.stringify({
            function: 'pkg.alpha',
            callers: [],
            callees: [{ qualified_name: 'pkg.beta', name: 'beta', label: 'Function', file_path: 'src/b.ts' }],
          }) }],
        },
      }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: {
        kind: 'session', runId: 'server-run-1', projectId: 'project-1',
        deckId: 'deck_builder', conversationId: 'main',
      },
    }));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: attention('codegraph', ['pkg.alpha']),
    }));
    const center = result.current.projections.codegraph.nodes[0];

    await act(async () => result.current.expandNode({
      authority: 'codegraph', node: center, projectId: 'project-1', codeGraphProject: 'C-Projects-LiquidAIty-main',
    }));

    const rpcCall = fetchMock.mock.calls.find((call) => call[1]?.body);
    const rpcBody = JSON.parse(String(rpcCall?.[1].body));
    expect(rpcBody.params).toMatchObject({
      name: 'trace_path',
      arguments: { project: 'C-Projects-LiquidAIty-main', function_name: 'pkg.alpha', depth: 1 },
    });
    expect(result.current.projections.codegraph.nodes.map((node) => node.id)).toEqual(['pkg.alpha', 'pkg.beta']);
    expect(result.current.projections.codegraph.edges.map((edge) => edge.id)).toEqual(['pkg.alpha:CALLS:pkg.beta']);
  });
});
