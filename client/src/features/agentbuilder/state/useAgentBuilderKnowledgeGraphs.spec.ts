// @vitest-environment jsdom

/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: KnowGraph
 * Relationship: This file verifies accepted Know deletion refreshes the provider projection exactly once while refusal preserves the current graph and avoids false refresh.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies the shared workspace keeps provider projections independent and performs no eager CodeGraph read.
 * Entity: ThinkGraph
 * Relationship: This file verifies the Engraphis projection loads alongside KnowGraph without being replaced by another authority.
 * Entity: CodeGraph
 * Relationship: This file verifies CodeGraph opens only on demand, replaces the active File structure, and loads current Symbol source only after explicit selection.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphProjectionV1 } from '../../../components/knowledge/knowledgeGraphProjection';
import type { CodeGraphSelectedSymbol } from '../../../components/knowledge/codeGraphProjection';
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

class GraphStream extends EventTarget {
  static connections: GraphStream[] = [];
  close = vi.fn();
  constructor(public url: string, public options: EventSourceInit) {
    super();
    GraphStream.connections.push(this);
  }
}

beforeEach(() => {
  GraphStream.connections = [];
  vi.stubGlobal('EventSource', GraphStream);
});

describe('KnowGraph route contracts', () => {
  it('refreshes committed ThinkGraph data without Main, a Run ID, or a KnowGraph reload', async () => {
    const calls: string[] = [];
    let currentProjection = projection();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('/api/thinkgraph/projection?')) {
        return new Response(JSON.stringify(currentProjection), { status: 200 });
      }
      return new Response(JSON.stringify({ nodes: [], relationships: [] }), { status: 200 });
    }));
    const { result } = renderHook(() => useAgentBuilderKnowledgeGraphs({
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
    }));
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));

    const stream = GraphStream.connections[0];
    expect(stream.url).toBe('/api/thinkgraph/events?projectId=project-one');
    expect(stream.options).toEqual({ withCredentials: true });
    currentProjection = { ...projection(), nodes: [...projection().nodes, { id: 'created-entity', label: 'Created' }] };
    await act(async () => { stream.dispatchEvent(new Event('changed')); });
    await waitFor(() => expect(result.current.projections.thinkgraph.nodes).toHaveLength(3));

    const refresh = calls.filter(url => url.startsWith('/api/thinkgraph/projection?')).at(-1);
    const query = new URLSearchParams(refresh?.split('?')[1] || '');
    expect(query.get('projectId')).toBe('project-one');
    expect(query.has('afterRunId')).toBe(false);
    const knowCalls = calls.filter(url => url.startsWith('/api/knowgraph/graph?'));
    expect(knowCalls).toHaveLength(1);
    expect(calls.some(url => url.includes('/main/'))).toBe(false);
  });

  it('preserves the previous graph and reports a provider read failure after a change', async () => {
    let thinkReads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/thinkgraph/projection?')) {
        thinkReads += 1;
        if (thinkReads > 1) {
          return new Response(JSON.stringify({
            error: 'engraphis_unavailable',
          }), { status: 502 });
        }
        return new Response(JSON.stringify(projection()), { status: 200 });
      }
      return new Response(JSON.stringify({ nodes: [], relationships: [] }), { status: 200 });
    }));
    const { result } = renderHook(() => useAgentBuilderKnowledgeGraphs({
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
    }));
    await waitFor(() => expect(result.current.statuses.thinkgraph).toBe('ready'));

    const before = result.current.projections.thinkgraph;
    await act(async () => { GraphStream.connections[0].dispatchEvent(new Event('changed')); });

    expect(result.current.statuses.thinkgraph).toBe('error');
    expect(result.current.errors.thinkgraph).toBe('engraphis_unavailable');
    expect(result.current.projections.thinkgraph).toBe(before);
  });

  it('recovers missed updates on stream readiness and closes on unmount', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('/api/thinkgraph/projection?')) {
        return new Response(JSON.stringify(projection()), { status: 200 });
      }
      return new Response(JSON.stringify({ nodes: [], relationships: [] }), { status: 200 });
    }));
    const { result, unmount } = renderHook(() => useAgentBuilderKnowledgeGraphs({
      projectId: 'project-one', deckId: 'deck-one', conversationId: 'conversation-one',
    }));
    await waitFor(() => expect(result.current.statuses.knowgraph).toBe('ready'));

    const stream = GraphStream.connections[0];
    await act(async () => { stream.dispatchEvent(new Event('error')); });
    expect(result.current.errors.thinkgraph).toContain('disconnected');
    await act(async () => { stream.dispatchEvent(new Event('ready')); });
    await waitFor(() => expect(result.current.errors.thinkgraph).toBeUndefined());

    const refresh = calls.filter(url => url.startsWith('/api/thinkgraph/projection?')).at(-1)!;
    const query = new URLSearchParams(refresh.split('?')[1] || '');
    expect(query.get('projectId')).toBe('project-one');
    expect(query.has('afterRunId')).toBe(false);
    expect(calls.filter(url => url.startsWith('/api/knowgraph/graph?'))).toHaveLength(1);
    expect(calls.filter(url => url.startsWith('/api/thinkgraph/projection?'))).toHaveLength(2);
    unmount();
    expect(stream.close).toHaveBeenCalledOnce();
    const reads = calls.length;
    stream.dispatchEvent(new Event('changed'));
    expect(calls).toHaveLength(reads);
  });

  it('sends one exact delete request and refreshes after the server confirms it', async () => {
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
    expect(deletion?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(deletion?.init?.body))).toEqual({
      project_id: 'project-one',
      graphiti_episode_uuid: 'episode-one',
    });
    expect(calls.filter(call => call.url.startsWith('/api/knowgraph/graph?'))).toHaveLength(2);
  });

  it('preserves the current projection and does not refresh after delete refusal', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/knowgraph/delete-episode') {
        return new Response(JSON.stringify({ ok: false }), { status: 503 });
      }
      if (url.startsWith('/api/thinkgraph/projection?')) {
        return new Response(JSON.stringify(projection()), { status: 200 });
      }
      return new Response(JSON.stringify({ nodes: [], relationships: [] }), { status: 200 });
    }));
    const { result } = renderHook(() => useAgentBuilderKnowledgeGraphs({
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
    }));
    await waitFor(() => expect(result.current.statuses.knowgraph).toBe('ready'));
    const before = result.current.projections.knowgraph;

    await expect(result.current.removeKnowGraphEvidence('episode-one')).rejects.toThrow(
      'Could not delete this Know.',
    );

    expect(result.current.projections.knowgraph).toBe(before);
    expect(calls.filter(url => url.startsWith('/api/knowgraph/graph?'))).toHaveLength(1);
  });

  it('loads CodeGraph on demand, replaces File structure, and reads source explicitly', async () => {
    const codeBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/thinkgraph/projection?')) {
        return new Response(JSON.stringify(projection()), { status: 200 });
      }
      if (url.startsWith('/api/knowgraph/graph?')) {
        return new Response(JSON.stringify({ nodes: [], relationships: [] }), { status: 200 });
      }
      if (url === '/api/codegraph/read') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        codeBodies.push(body);
        const mode = String(body.mode);
        const scope = {
          projectId: 'project-one', deckId: 'deck_builder', cardId: 'builder',
          cbmProject: 'C-Projects-LiquidAIty-main',
        };
        if (mode === 'projection') {
          return new Response(JSON.stringify({
            schemaVersion: 'codegraph.read.v1', status: 'ready', mode, scope,
            projection: {
              schemaVersion: 'codegraph.projection.v1', authority: 'codegraph',
              projectId: 'project-one', nodes: [{
                id: 'file:one', label: 'one.ts', authority: 'codegraph',
                type: 'File', etype: 'File', properties: {
                  recordKind: 'file', filePath: 'client/one.ts', qualifiedName: 'file:one',
                },
              }], edges: [],
            },
            selectedSymbol: null, freshness: { status: 'unverified', coverage: null },
            truncated: false, errors: [],
          }), { status: 200 });
        }
        if (mode === 'file') {
          const filePath = String(body.filePath);
          const second = filePath === 'client/two.ts';
          return new Response(JSON.stringify({
            schemaVersion: 'codegraph.read.v1', status: 'ready', mode, scope,
            projection: {
              schemaVersion: 'codegraph.projection.v1', authority: 'codegraph',
              projectId: 'project-one', nodes: [
                { id: second ? 'file:two' : 'file:one', label: second ? 'two.ts' : 'one.ts', authority: 'codegraph', type: 'File', etype: 'File', properties: { recordKind: 'file', filePath, qualifiedName: second ? 'file:two' : 'file:one' } },
                { id: second ? 'symbol:stop' : 'symbol:run', label: second ? 'stop' : 'run', authority: 'codegraph', type: 'Function', etype: 'Symbol', properties: { recordKind: 'symbol', filePath, qualifiedName: second ? 'symbol:stop' : 'symbol:run' } },
              ],
              edges: [{ id: second ? 'defines-stop' : 'defines-run', source: second ? 'file:two' : 'file:one', target: second ? 'symbol:stop' : 'symbol:run', predicate: 'DEFINES' }],
            },
            selectedSymbol: null, freshness: { status: 'current', coverage: {} },
            truncated: false, errors: [],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          schemaVersion: 'codegraph.read.v1', status: 'ready', mode, scope,
          projection: null,
          selectedSymbol: {
            graphSystem: 'cbm', cbmQualifiedName: 'symbol:run', recordKind: 'symbol',
            type: 'Function', title: 'run', content: 'export function run() {}',
            properties: { project: 'C-Projects-LiquidAIty-main', file: 'client/one.ts' },
            provenance: {}, asOf: '2026-10-17T00:00:00Z',
            readOperation: 'cbm.get_code_snippet', truncated: false,
          },
          freshness: { status: 'unverified', coverage: null },
          truncated: false, errors: [],
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const { result } = renderHook(() => useAgentBuilderKnowledgeGraphs({
      projectId: 'project-one', deckId: 'deck-one', conversationId: 'conversation-one',
    }));
    await waitFor(() => expect(result.current.statuses.knowgraph).toBe('ready'));
    expect(codeBodies).toEqual([]);

    await act(async () => { await result.current.loadCodeGraph(); });
    expect(result.current.codeGraph.status).toBe('ready');
    expect(codeBodies).toEqual([{ projectId: 'project-one', mode: 'projection' }]);

    await act(async () => { await result.current.readCodeGraphFile('client/one.ts'); });
    expect(result.current.codeGraph.projection.nodes.map(node => node.id))
      .toEqual(['file:one', 'symbol:run']);
    expect(result.current.codeGraph.projection.edges[0].predicate).toBe('DEFINES');

    await act(async () => { await result.current.readCodeGraphFile('client/two.ts'); });
    expect(result.current.codeGraph.projection.nodes.map(node => node.id))
      .toEqual(['file:one', 'file:two', 'symbol:stop']);
    expect(result.current.codeGraph.projection.nodes.some(node => node.id === 'symbol:run'))
      .toBe(false);

    let source: CodeGraphSelectedSymbol | null = null;
    await act(async () => {
      source = await result.current.readCodeGraphSource('symbol:run');
    });
    expect(source).toMatchObject({
      cbmQualifiedName: 'symbol:run', content: 'export function run() {}',
    });
    expect(codeBodies.at(-1)).toEqual({
      projectId: 'project-one', mode: 'source', qualifiedName: 'symbol:run',
    });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
