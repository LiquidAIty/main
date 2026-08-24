// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useAgentBuilderGraphAttention, {
  projectNativeAttentionEvent,
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
): NativeAttentionEvent {
  return {
    kind: 'native_attention',
    eventId: `event-${authority}`,
    timestamp: '2026-08-18T12:00:00Z',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'main',
    runId: 'req-one',
    cardId,
    authority,
    operation: 'read',
    toolName: authority === 'codegraph' ? 'cbm.search_graph'
      : authority === 'knowgraph' ? 'graphiti.search_nodes' : 'engraphis.why',
    nativeNodeIds,
    nativeEdgeIds,
    resultHash: 'a'.repeat(64),
    truncated: false,
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
    const { result } = renderHook(() => useAgentBuilderGraphAttention({ projectId: 'project-1' }));
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
    expect(result.current.projections.codegraph.nodes).toEqual([]);

    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: { ...attention('knowgraph', ['node-a', 'node-b'], ['edge-1']), operation: 'write' },
    }));

    await waitFor(() => expect(result.current.projections.knowgraph.nodes).toHaveLength(2));
    expect(result.current.projections.knowgraph.edges).toEqual([]);
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    expect(result.current.projections.codegraph.nodes).toEqual([]);

    act(() => result.current.startAttentionScope({ ...turn, runId: 'run-2' }));
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
  });

  it('restores persisted native attention without inventing graph objects', async () => {
    const { result } = renderHook(() => useAgentBuilderGraphAttention({ projectId: 'project-1' }));
    act(() => result.current.restoreAttentionEvents([
      attention('thinkgraph', ['mem-1']),
      attention('codegraph', ['pkg.materialize_idf']),
    ]));

    await waitFor(() => expect(result.current.projections.thinkgraph.nodes).toHaveLength(1));
    expect(result.current.projections.thinkgraph.nodes[0].id).toBe('mem-1');
    expect(result.current.projections.codegraph.nodes[0].id).toBe('pkg.materialize_idf');
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
  });

  it('expands a visible ThinkGraph memory through the native neighborhood route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [
          { id: 'mem-1', canonicalId: 'mem-1', label: 'Center', properties: {} },
          { id: 'mem-2', canonicalId: 'mem-2', label: 'Neighbor', properties: {} },
        ],
        edges: [{ id: 'edge-1', source: 'mem-1', target: 'mem-2', predicate: 'related' }],
      }),
    }));
    const { result } = renderHook(() => useAgentBuilderGraphAttention({ projectId: 'project-1' }));
    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: attention('thinkgraph', ['mem-1']),
    }));
    const center = result.current.projections.thinkgraph.nodes[0];

    await act(async () => result.current.expandNode({
      authority: 'thinkgraph',
      node: center,
      projectId: 'project-1',
      codeGraphProject: null,
    }));

    expect(fetch).toHaveBeenCalledWith('/api/thinkgraph/neighborhood?projectId=project-1&canonicalId=mem-1');
    expect(result.current.projections.thinkgraph.nodes.map((node) => node.id)).toEqual(['mem-1', 'mem-2']);
    expect(result.current.projections.thinkgraph.edges.map((edge) => edge.id)).toEqual(['edge-1']);
  });

  it('expands a visible KnowGraph UUID through the bounded native Neo4j route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [
          { id: 'node-a', label: 'Alpha', type: 'Entity', properties: { uuid: 'node-a' } },
          { id: 'node-b', label: 'Beta', type: 'Entity', properties: { uuid: 'node-b' } },
        ],
        relationships: [{ id: 'edge-1', from: 'node-a', to: 'node-b', type: 'USES' }],
      }),
    }));
    const { result } = renderHook(() => useAgentBuilderGraphAttention({ projectId: 'project-1' }));
    act(() => result.current.startAttentionScope(turn));
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
    const fetchMock = vi.fn().mockResolvedValue({
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
    const { result } = renderHook(() => useAgentBuilderGraphAttention({ projectId: 'project-1' }));
    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: attention('codegraph', ['pkg.alpha']),
    }));
    const center = result.current.projections.codegraph.nodes[0];

    await act(async () => result.current.expandNode({
      authority: 'codegraph', node: center, projectId: 'project-1', codeGraphProject: 'C-Projects-LiquidAIty-main',
    }));

    const rpcBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(rpcBody.params).toMatchObject({
      name: 'trace_path',
      arguments: { project: 'C-Projects-LiquidAIty-main', function_name: 'pkg.alpha', depth: 1 },
    });
    expect(result.current.projections.codegraph.nodes.map((node) => node.id)).toEqual(['pkg.alpha', 'pkg.beta']);
    expect(result.current.projections.codegraph.edges.map((edge) => edge.id)).toEqual(['pkg.alpha:CALLS:pkg.beta']);
  });
});
