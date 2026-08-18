// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useAgentBuilderGraphAttention, {
  mergeAttentionProjection,
  projectNativeToolResult,
  unwrapNativeToolOutput,
} from './useAgentBuilderGraphAttention';

const turn = {
  projectId: 'project-1',
  conversationId: 'main',
  runId: 'run-1',
  text: 'Inspect native graph data.',
  observedAt: '2026-08-17T12:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('attention-activated native graph projection', () => {
  it('ignores execution receipts and projects only exact CBM result symbols', () => {
    expect(unwrapNativeToolOutput(JSON.stringify({ executionReceipt: { tool: 'cbm.search_graph' } }))).toBeNull();
    const result = projectNativeToolResult({
      toolName: 'cbm.search_graph',
      projectId: 'project-1',
      actorCardId: 'card_main_chat',
      output: JSON.stringify({
        content: [
          { type: 'text', text: JSON.stringify({ results: [
            { qualified_name: 'pkg.alpha', name: 'alpha', label: 'Function', file_path: 'src/a.ts' },
            { qualified_name: 'pkg.beta', name: 'beta', label: 'Function', file_path: 'src/b.ts' },
          ] }) },
          { type: 'text', text: JSON.stringify({ executionReceipt: { tool: 'cbm.search_graph' } }) },
        ],
      }),
    });

    expect(result?.authority).toBe('codegraph');
    expect(result?.projection.nodes.map((node) => node.id)).toEqual(['pkg.alpha', 'pkg.beta']);
    expect(result?.projection.edges).toEqual([]);
    expect(result?.projection.nodes[0].properties).toMatchObject({
      file_path: 'src/a.ts',
      attentionActorCardId: 'card_main_chat',
      attentionActorColor: '#37ADAA',
      attentionToolName: 'cbm.search_graph',
    });
  });

  it('recognizes the exact MCP-safe tool name Hermes emits over ACP', () => {
    const result = projectNativeToolResult({
      toolName: 'mcp__main_runtime_abcd__cbm_search_graph',
      projectId: 'project-1',
      actorCardId: 'card_main_chat',
      output: '{"results":[{"qualified_name":"pkg.alpha","name":"alpha","label":"Function"}]}',
    });

    expect(result?.authority).toBe('codegraph');
    expect(result?.projection.nodes.map((node) => node.id)).toEqual(['pkg.alpha']);
  });

  it('keeps graph authorities separate and never creates missing endpoint nodes', () => {
    const think = projectNativeToolResult({
      toolName: 'engraphis.recall',
      projectId: 'project-1',
      actorCardId: 'card_main_chat',
      output: { memories: [{ id: 'mem-1', title: 'Runtime decision', mtype: 'semantic' }] },
    })!;
    const know = projectNativeToolResult({
      toolName: 'graphiti.search_memory_facts',
      projectId: 'project-1',
      actorCardId: 'card_main_chat',
      output: { facts: [{ uuid: 'edge-1', source_node_uuid: 'node-a', target_node_uuid: 'node-b', name: 'USES' }] },
    })!;

    expect(think.authority).toBe('thinkgraph');
    expect(think.projection.nodes.map((node) => node.id)).toEqual(['mem-1']);
    expect(know.authority).toBe('knowgraph');
    expect(know.projection.nodes).toEqual([]);
    expect(mergeAttentionProjection(
      { ...know.projection, nodes: [], edges: [] },
      know.projection,
    ).edges).toEqual([]);
  });

  it('starts all three canvases empty, wakes exact Graphiti write data, and clears on the next scope', async () => {
    const { result } = renderHook(() => useAgentBuilderGraphAttention({ projectId: 'project-1' }));
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    expect(result.current.projections.knowgraph.nodes).toEqual([]);
    expect(result.current.projections.codegraph.nodes).toEqual([]);

    act(() => result.current.startAttentionScope(turn));
    act(() => result.current.observeNativeTurnEvent({
      ...turn,
      event: {
        kind: 'tool_result',
        toolName: 'graphiti.add_triplet',
        toolUseId: 'tool-1',
        invokingCardId: 'card_main_chat',
        isError: false,
        output: JSON.stringify({
          nodes: [
            { uuid: 'node-a', name: 'Alpha', labels: ['Entity'] },
            { uuid: 'node-b', name: 'Beta', labels: ['Entity'] },
          ],
          edges: [{ uuid: 'edge-1', source_node_uuid: 'node-a', target_node_uuid: 'node-b', name: 'USES' }],
        }),
      },
    }));

    await waitFor(() => expect(result.current.projections.knowgraph.nodes).toHaveLength(2));
    expect(result.current.projections.knowgraph.edges.map((edge) => edge.id)).toEqual(['edge-1']);
    expect(result.current.projections.thinkgraph.nodes).toEqual([]);
    expect(result.current.projections.codegraph.nodes).toEqual([]);

    act(() => result.current.startAttentionScope({ ...turn, runId: 'run-2' }));
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
      event: {
        kind: 'tool_result',
        toolName: 'engraphis.recall',
        toolUseId: 'tool-1',
        invokingCardId: 'card_main_chat',
        isError: false,
        output: JSON.stringify({ memories: [{ id: 'mem-1', title: 'Center' }] }),
      },
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
      event: {
        kind: 'tool_result', toolName: 'graphiti.search_nodes', toolUseId: 'tool-1',
        invokingCardId: 'card_main_chat', isError: false,
        output: JSON.stringify({ nodes: [{ uuid: 'node-a', name: 'Alpha', labels: ['Entity'] }] }),
      },
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
      event: {
        kind: 'tool_result', toolName: 'cbm.search_graph', toolUseId: 'tool-1',
        invokingCardId: 'card_main_chat', isError: false,
        output: JSON.stringify({ results: [{ qualified_name: 'pkg.alpha', name: 'alpha', label: 'Function', file_path: 'src/a.ts' }] }),
      },
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
