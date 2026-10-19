// @vitest-environment jsdom

/**
 * Entity: KnowGraph
 * Relationship: This file verifies accepted Know deletion refreshes the provider projection exactly once while refusal preserves the current graph and avoids false refresh.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies the shared workspace keeps provider projections independent and performs no eager CodeGraph read.
 * Entity: ThinkGraph
 * Relationship: This file verifies the Engraphis projection loads alongside KnowGraph without being replaced by another authority.
 * Entity: CodeGraph
 * Relationship: This file verifies CodeGraph opens only on demand, merges exact File structure, and loads current Symbol source only after explicit selection.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('KnowGraph route contracts', () => {
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

  it('loads CodeGraph only on demand, merges exact File structure, and reads source explicitly', async () => {
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
          return new Response(JSON.stringify({
            schemaVersion: 'codegraph.read.v1', status: 'ready', mode, scope,
            projection: {
              schemaVersion: 'codegraph.projection.v1', authority: 'codegraph',
              projectId: 'project-one', nodes: [
                { id: 'file:one', label: 'one.ts', authority: 'codegraph', type: 'File', etype: 'File', properties: { recordKind: 'file', filePath: 'client/one.ts', qualifiedName: 'file:one' } },
                { id: 'symbol:run', label: 'run', authority: 'codegraph', type: 'Function', etype: 'Symbol', properties: { recordKind: 'symbol', filePath: 'client/one.ts', qualifiedName: 'symbol:run' } },
              ],
              edges: [{ id: 'defines', source: 'file:one', target: 'symbol:run', predicate: 'DEFINES' }],
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
