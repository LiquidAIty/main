// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useAgentBuilderGraphAttention, {
  mergeAttentionProjection,
  overlayAuthoritativeGraphAttention,
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
      : authority === 'knowgraph' ? 'graphiti.search_nodes' : 'engraphis_recall_context',
    nativeNodeIds,
    nativeEdgeIds,
    nativeEdges,
    resultHash: 'a'.repeat(64),
    truncated: false,
  };
}

function thinkgraphResponse(
  nodes: Array<Record<string, unknown>> = [],
  edges: Array<Record<string, unknown>> = [],
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      schemaVersion: 'thinkgraph.engraphis.v1',
      authority: 'engraphis',
      projectId: 'project-1',
      revision: 'thinkgraph-test-revision',
      embedding: { state: 'degraded', reason: 'test_embedding_unavailable' },
      counts: { nodes: nodes.length, edges: edges.length },
      nodes,
      edges,
    }),
  };
}

function knowledgeResponse(nodes: Array<Record<string, unknown>> = [], relationships: Array<Record<string, unknown>> = []) {
  return { ok: true, status: 200, json: async () => ({ nodes, relationships }) };
}

afterEach(() => vi.unstubAllGlobals());

describe('attention-activated native graph projection', () => {
  it('refreshes the stored projection after Main completes even without attention delivery', async () => {
    let response = thinkgraphResponse();
    const fetchMock = vi.fn(async (url: string) => url.startsWith('/api/thinkgraph/')
      ? response : knowledgeResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    const records = [{ id: 'stored-entity', label: 'Stored entity' }];
    response = thinkgraphResponse(records);
    await act(async () => result.current.finishAttentionScope({ ...turn, status: 'completed' }));
    await waitFor(() => expect(result.current.projections.thinkgraph.nodes).toEqual(records));
    const count = fetchMock.mock.calls.length;
    await act(async () => result.current.finishAttentionScope({
      ...turn, projectId: 'another-project', status: 'completed',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(count);
    response = thinkgraphResponse();
    await act(async () => result.current.refreshThinkGraph());
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
  });
  it('loads CodeGraph records from the saved-workspace reader and preserves stored edge identity', async () => {
    const prefix = 'C-Projects-LiquidAIty-main.client.src.features.agentbuilder.state.useAgentBuilderGraphAttention.';
    const source = prefix + 'overlayAuthoritativeGraphAttention';
    const target = prefix + 'retain';
    const records = { schemaVersion: 'native-card-context.v1', authority: 'codegraph', projectId: 'project-1',
      nodes: [{ id: source, label: 'overlayAuthoritativeGraphAttention', properties: { id: '2130' } },
        { id: target, label: 'retain', properties: { id: '2131' } }],
      edges: [{ id: '17367', source, target, predicate: 'CALLS', provenance: { edgeId: '17367' } }],
    };
    const fetchMock = vi.fn(async (url: string) => url === '/api/codegraph/read'
      ? { ok: true, json: async () => records }
      : url.startsWith('/api/thinkgraph/') ? thinkgraphResponse() : knowledgeResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));
    await act(async () => result.current.observeAttentionEvent(attention('codegraph', [source, target], ['17367'])));
    expect(result.current.projections.codegraph.nodes.map(node => node.id)).toEqual([source, target]);
    expect(result.current.projections.codegraph.edges[0]).toMatchObject(records.edges[0]);
    const request = fetchMock.mock.calls.find(call => call[0] === '/api/codegraph/read');
    expect(request).toBeDefined();
    await act(async () => result.current.expandNode({ authority: 'codegraph', node: records.nodes[0],
      projectId: 'project-1', codeGraphProject: 'C-Projects-LiquidAIty-main', readerCardId: 'card_main_chat' }));
    expect(result.current.projections.codegraph.edges.map(edge => edge.id)).toEqual(['17367']);
  });

  it('does not bring a late CodeGraph result into another selected Card', async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/codegraph/read'
      ? { ok: true, json: () => new Promise(resolve => { finish = resolve; }) }
      : url.startsWith('/api/thinkgraph/') ? thinkgraphResponse() : knowledgeResponse()));
    const { result, rerender } = renderHook(({ selectedCardId }) => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main', selectedCardId,
    }), { initialProps: { selectedCardId: null as string | null } });
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));
    act(() => result.current.observeAttentionEvent(attention('codegraph', ['absent'])));
    await waitFor(() => expect(finish).toBeDefined());
    rerender({ selectedCardId: 'card_main_chat' });
    await act(async () => finish({ authority: 'codegraph', projectId: 'project-1', nodes: [{
      id: 'C-Projects-LiquidAIty-main.client.src.features.agentbuilder.state.useAgentBuilderGraphAttention.retain',
      label: 'retain',
    }], edges: [] }));
    expect(result.current.projections.codegraph.nodes).toEqual([]);
    expect(result.current.errors.codegraph).toBeUndefined();
  });

  it('retains attention across refreshes without retaining removed graph records or old knowledge', () => {
    const current = { schemaVersion: 'projection', projectId: 'project-1',
      nodes: [{ id: 'existing', label: 'Current label', properties: { summary: 'Current content' } }],
      edges: [],
    };
    const previous = { ...current, nodes: [
      { id: 'existing', label: 'Old label', properties: { summary: 'Old content', attentionActive: true, attentionRunId: 'run-1' } },
      { id: 'removed', label: 'Removed', properties: { attentionActive: true, attentionRunId: 'run-1' } },
    ] };
    const result = overlayAuthoritativeGraphAttention(current, previous);
    expect(result.nodes).toEqual([{ id: 'existing', label: 'Current label', properties: {
      summary: 'Current content', attentionActive: true, attentionRunId: 'run-1',
    } }]);
    expect(result.edges).toEqual([]);
    expect(overlayAuthoritativeGraphAttention({ ...current, nodes: [] }, previous).nodes).toEqual([]);
  });
  it('keeps native knowledge when selecting another agent without loading it again', async () => {
    const fetchMock = vi.fn(async (url: string) => url.startsWith('/api/thinkgraph/')
      ? thinkgraphResponse([{ id: 'idea', label: 'An open question' }])
      : knowledgeResponse([{ id: 'source', label: 'W3C' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ selectedCardId }) => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main', selectedCardId,
    }), { initialProps: { selectedCardId: 'card-one' } });
    await waitFor(() => expect(result.current.projections.knowgraph.nodes).toHaveLength(1));
    rerender({ selectedCardId: 'card-two' });
    expect(result.current.projections.knowgraph.nodes[0].label).toBe('W3C');
    expect(result.current.projections.thinkgraph.nodes[0].label).toBe('An open question');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads named native knowledge and overlays activity without inventing receipt nodes', async () => {
    const native = {
      nodes: [{ id: 'source', label: 'W3C', type: 'Entity', properties: { summary: 'Standards body' } },
        { id: 'claim', label: 'Provenance model', type: 'Entity', properties: { summary: 'Current native summary' } }],
      relationships: [{ id: 'element-1', source: 'know', from: 'source', to: 'claim', type: 'RELATES_TO',
        properties: { uuid: 'native-edge', name: 'PUBLISHED', episodes: ['source-episode'], group_id: 'group-one', valid_at: '2026-09-07T10:00:00Z' } }],
    };
    const fetchMock = vi.fn(async (url: string) => url.startsWith('/api/thinkgraph/')
      ? thinkgraphResponse() : { ok: true, json: async () => native });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    await waitFor(() => expect(result.current.projections.knowgraph.nodes).toHaveLength(2));
    expect(result.current.projections.knowgraph.nodes[0].properties?.attentionActive).toBeUndefined();
    act(() => result.current.observeAttentionEvent(attention('knowgraph', ['claim', 'old-receipt'])));
    expect(result.current.projections.knowgraph.nodes.map(node => node.label)).toEqual(['W3C', 'Provenance model']);
    expect(result.current.projections.knowgraph.nodes[1].properties).toMatchObject({
      summary: 'Current native summary', attentionActive: true,
    });
    expect(result.current.projections.knowgraph.edges).toEqual([
      expect.objectContaining({ id: 'element-1', source: 'source', target: 'claim', predicate: 'RELATES_TO',
        properties: native.relationships[0].properties }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });





  it('loads completed Graphiti writes from the native owner and keeps knowledge across turns', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/thinkgraph/')
      ? thinkgraphResponse() : knowledgeResponse(
        [{ id: 'node-a', label: 'Alpha' }, { id: 'node-b', label: 'Beta' }],
        [{ id: 'edge-1', from: 'node-a', to: 'node-b', type: 'USES' }],
      )));
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
    expect(result.current.projections.knowgraph.edges[0].properties?.attentionOperation).toBe('write');
    expect(result.current.projections.knowgraph.edges[0].provenance).toBeUndefined();
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    expect(result.current.projections.codegraph.nodes).toEqual([]);

    act(() => result.current.startAttentionScope({ ...turn, runId: 'run-2' }));
    expect(result.current.projections.knowgraph.nodes.map(node => node.label)).toEqual(['Alpha', 'Beta']);
    expect(result.current.projections.knowgraph.nodes[0].properties?.attentionActive).toBeUndefined();
  });

  it('restores persisted ThinkGraph attention only on an authoritative Engraphis node', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(thinkgraphResponse([
      { id: 'mem-1', canonicalId: 'mem-1', label: 'Real memory', mentionCount: 1, properties: {}, provenance: { engine: 'engraphis' } },
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
    expect(result.current.projections.thinkgraph.nodes[0].provenance).toEqual({ engine: 'engraphis' });
    expect(result.current.projections.thinkgraph.nodes[0].properties).toMatchObject({
      attentionToolName: 'engraphis_recall_context',
    });
    expect(result.current.projections.codegraph.nodes).toEqual([]);
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
  });


  it('restores only the latest scoped Run and ignores duplicate event identities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(thinkgraphResponse([
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
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));
    act(() => result.current.observeAttentionSession({
      projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat',
      runId: 'current-run', state: 'running',
    }));
    act(() => [
      old,
      latest,
      latest,
      { ...latest, eventId: 'wrong-project', projectId: 'project-2', timestamp: '2026-08-18T13:00:00Z' },
      { ...latest, eventId: 'wrong-run', runId: 'old-run' },
      { ...latest, eventId: 'wrong-card', cardId: 'card-other' },
    ].forEach(result.current.observeAttentionEvent));

    await waitFor(() => expect(result.current.projections.thinkgraph.nodes.map((node) => node.id)).toEqual([
      'current-memory',
    ]));
    expect(result.current.projections.thinkgraph.nodes[0].properties).toMatchObject({
      attentionEventId: 'current-event', attentionRunId: 'current-run',
      attentionTimestamp: latest.timestamp,
    });
  });




  it('never lights pending writes and rereads native records after acknowledged changes', async () => {
    let nativeNodes: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/thinkgraph/')
      ? thinkgraphResponse() : knowledgeResponse(nativeNodes)));
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    const event = { ...attention('knowgraph', ['node-a']), operation: 'write' as const, change: 'create' as const };
    act(() => result.current.observeAttentionEvent({ ...event, phase: 'pending' }));
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
    nativeNodes = [{ id: 'node-a', label: 'Alpha' }];
    act(() => result.current.observeAttentionEvent({ ...event, phase: 'completed' }));
    await waitFor(() => expect(result.current.projections.knowgraph.nodes.map((node) => node.id)).toEqual(['node-a']));
    nativeNodes = [];
    act(() => result.current.observeAttentionEvent({ ...event, eventId: 'delete', change: 'delete', phase: 'completed' }));
    await waitFor(() => expect(result.current.projections.knowgraph.nodes).toEqual([]));
  });

  it('expands a visible ThinkGraph memory through the native neighborhood route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(thinkgraphResponse([
        { id: 'mem-1', canonicalId: 'mem-1', label: 'Center', mentionCount: 1, properties: {} },
      ]))
      .mockResolvedValueOnce(knowledgeResponse())
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
      .mockResolvedValueOnce(thinkgraphResponse())
      .mockResolvedValueOnce(knowledgeResponse([{ id: 'node-a', label: 'Alpha', type: 'Entity', properties: { uuid: 'node-a' } }]))
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
    await waitFor(() => expect(result.current.projections.knowgraph.nodes).toHaveLength(1));
    const center = result.current.projections.knowgraph.nodes[0];

    await act(async () => result.current.expandNode({
      authority: 'knowgraph', node: center, projectId: 'project-1', codeGraphProject: null,
    }));

    expect(fetch).toHaveBeenCalledWith('/api/knowgraph/expand?projectId=project-1&nodeId=node-a&limit=50&depth=1');
    expect(result.current.projections.knowgraph.nodes.map((node) => node.id)).toEqual(['node-a', 'node-b']);
    expect(result.current.projections.knowgraph.edges.map((edge) => edge.id)).toEqual(['edge-1']);
  });


  it('keeps every graph empty after activity and materialized references, including unknown IDs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/codegraph/read'
      ? { ok: true, json: async () => ({ authority: 'codegraph', projectId: 'project-1', nodes: [], edges: [] }) }
      : url.startsWith('/api/thinkgraph/')
      ? thinkgraphResponse() : knowledgeResponse()));
    const { result } = renderHook(() => useAgentBuilderGraphAttention({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));
    await act(async () => {
      for (const authority of ['thinkgraph', 'knowgraph', 'codegraph'] as const) {
        result.current.observeAttentionEvent(attention(authority, ['unknown-id'], ['unknown-edge'], 'card_main_chat', [
          { id: 'unknown-edge', source: 'unknown-id', target: 'another-unknown-id', predicate: 'unused' },
        ]));
        result.current.observeAttentionSession({ projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card_main_chat', runId: 'server-run-1', state: 'running',
          materializedNativeReferences: [{ authority, nativeId: 'unknown-id' }] });
      }
    });
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));
    for (const value of Object.values(result.current.projections)) {
      expect(value.nodes).toEqual([]);
      expect(value.edges).toEqual([]);
    }
  });

});
