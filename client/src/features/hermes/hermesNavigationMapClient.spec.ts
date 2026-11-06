// @vitest-environment jsdom
// Entity: Project Knowledge Graph
// Relationship: Verifies map construction plus four-profile publication requests against a mocked dashboard SDK without claiming loaded cache state.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JoinedGraphPresentation } from '../../components/knowledge/knowledgeGraphProjection';

const host = vi.hoisted(() => ({ fetchJSON: vi.fn(), onEvent: vi.fn() }));
vi.mock('./hermesHost', () => ({
  hermesWebappHost: () => ({ fetchJSON: host.fetchJSON }),
  onHermesEvent: host.onEvent,
}));

import {
  awaitHermesNavigationMapReady,
  buildHermesNavigationMap,
  clearHermesNavigationMap,
  NAVIGATION_MAP_PROFILES,
  publishHermesNavigationMap,
} from './hermesNavigationMapClient';

function presentation(): JoinedGraphPresentation {
  const thinkNode = {
    id: 'eng-1', label: 'Rocket Lab', canonicalName: 'Rocket Lab',
    properties: { evidence: [{ id: 'think-1', title: 'Cadence', summary: 'Cadence affects revenue.' }] },
  };
  const knowNode = {
    id: 'neo-1', label: 'Rocket Lab', canonicalName: 'Rocket Lab',
    properties: { evidence: [{
      graphitiEpisodeId: 'know-1', title: 'Launch record', observation: 'Electron launched.',
      interpretation: 'Cadence is demonstrated.', citation: { url: 'https://example.test' },
    }] },
  };
  const codeNode = {
    id: 'source-file:client/main.ts', label: 'main.ts',
    properties: {
      recordKind: 'file', filePath: 'client/main.ts',
      categoryTargets: { 'Rocket Lab': 'node-name:Rocket%20Lab' },
    },
  };
  return {
    projection: {
      schemaVersion: 'think-know-code.presentation.v1',
      projectId: 'trading',
      revision: 'revision-one',
      nodes: [
        { id: 'node-name:Rocket%20Lab', label: 'Rocket Lab', canonicalName: 'Rocket Lab' },
        { ...codeNode, id: 'codegraph:main' },
      ],
      edges: [{
        id: 'thinkgraph:edge-1', source: 'node-name:Rocket%20Lab',
        target: 'node-name:Rocket%20Lab', predicate: 'SUPPORTS',
      }],
    },
    providerProjections: {
      thinkgraph: { schemaVersion: 't', projectId: 'trading', nodes: [thinkNode], edges: [] },
      knowgraph: { schemaVersion: 'k', projectId: 'trading', nodes: [knowNode], edges: [] },
    },
    nodeVariants: new Map([['node-name:Rocket%20Lab', [
      { authority: 'thinkgraph' as const, node: thinkNode },
      { authority: 'knowgraph' as const, node: knowNode },
    ]]]),
    edgeVariants: new Map([['thinkgraph:edge-1', {
      authority: 'thinkgraph' as const,
      edge: { id: 'edge-1', source: 'eng-1', target: 'eng-1', predicate: 'SUPPORTS' },
    }]]),
    visualNodeIdByProviderMember: new Map(),
    codeProviderProjection: { schemaVersion: 'c', projectId: 'trading', nodes: [codeNode], edges: [] },
    codeNodeVariants: new Map([['codegraph:main', codeNode]]),
    codeEdgeVariants: new Map(),
    visualNodeIdByCodeProviderMember: new Map(),
    layerVisibility: { thinkgraph: true, knowgraph: true, codegraph: true },
  };
}

describe('Hermes navigation map', () => {
  beforeEach(async () => {
    host.fetchJSON.mockResolvedValue({ ok: true });
    await clearHermesNavigationMap();
    vi.clearAllMocks();
    host.onEvent.mockResolvedValue(() => undefined);
  });

  it('matches enabled visible layers and includes only one open node context', () => {
    const map = buildHermesNavigationMap(presentation(), 'node-name:Rocket%20Lab');
    expect(map.layers).toEqual(['thinkgraph', 'knowgraph', 'codegraph']);
    expect(map.nodes).toEqual([
      ['Rocket Lab', 'Entity', [['thinkgraph', 'eng-1'], ['knowgraph', 'neo-1']]],
      ['main.ts', 'File', [['codegraph', 'client/main.ts']]],
    ]);
    expect(map.relationships).toEqual([
      ['thinkgraph', 'edge-1', 0, 'SUPPORTS', 0],
    ]);
    expect(map.focus).toEqual([
      0,
      [['think-1', 'Cadence', 'Cadence affects revenue.']],
      [['know-1', 'Launch record', 'Electron launched.', 'Cadence is demonstrated.', 'https://example.test']],
      [1],
    ]);

    const thinkOnly = presentation();
    thinkOnly.layerVisibility = { thinkgraph: true, knowgraph: false, codegraph: false };
    const reduced = buildHermesNavigationMap(thinkOnly, null);
    expect(reduced.layers).toEqual(['thinkgraph']);
    expect(reduced.nodes).toEqual([
      ['Rocket Lab', 'Entity', [['thinkgraph', 'eng-1']]],
    ]);
    expect(reduced.focus).toBeNull();

    const focusedReduced = buildHermesNavigationMap(
      thinkOnly,
      'node-name:Rocket%20Lab',
    );
    expect(focusedReduced.focus).toEqual([
      0,
      [['think-1', 'Cadence', 'Cadence affects revenue.']],
      [],
      [],
    ]);
  });

  it('clears then publishes identical JSON to all four profile plugin hosts', async () => {
    host.fetchJSON.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: true };
      const body = JSON.parse(String(init?.body || '{}'));
      return {
        ok: true,
        sha256: 'a'.repeat(64),
        bytes: JSON.stringify(body).length,
        estimatedTokens: 100,
        nodes: body.nodes.length,
        relationships: body.relationships.length,
        focused: body.focus !== null,
      };
    });
    const map = buildHermesNavigationMap(presentation(), null);
    const result = await publishHermesNavigationMap(map);
    expect(result).toMatchObject({ status: 'synced', nodes: 2, relationships: 1 });
    const deleteCalls = host.fetchJSON.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    const putCalls = host.fetchJSON.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(deleteCalls).toHaveLength(NAVIGATION_MAP_PROFILES.length);
    expect(putCalls).toHaveLength(NAVIGATION_MAP_PROFILES.length);
    expect(putCalls.map(([path]) => path)).toEqual(NAVIGATION_MAP_PROFILES.map(
      (profile) => `/api/plugins/liquidaity/navigation-map?profile=${profile}`,
    ));
    expect(new Set(putCalls.map(([, init]) => String(init?.body))).size).toBe(1);
  });

  it('serializes overlapping Project publications and leaves only the newest map ready', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    host.fetchJSON.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: true };
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.projectId === 'trading') await firstGate;
      return {
        ok: true,
        sha256: body.projectId === 'trading' ? 'a'.repeat(64) : 'b'.repeat(64),
        bytes: JSON.stringify(body).length,
        nodes: body.nodes.length,
        relationships: body.relationships.length,
        focused: body.focus !== null,
      };
    });
    const first = buildHermesNavigationMap(presentation(), null);
    const nextPresentation = presentation();
    nextPresentation.projection = {
      ...nextPresentation.projection,
      projectId: 'next-project',
      revision: 'revision-two',
    };
    const second = buildHermesNavigationMap(nextPresentation, null);

    const firstPublication = publishHermesNavigationMap(first);
    const secondPublication = publishHermesNavigationMap(second);
    await Promise.resolve();
    releaseFirst();
    await Promise.all([firstPublication, secondPublication]);
    await expect(awaitHermesNavigationMapReady()).resolves.toBeUndefined();

    const bodies = host.fetchJSON.mock.calls
      .filter(([, init]) => init?.method === 'PUT')
      .map(([, init]) => JSON.parse(String(init?.body || '{}')).projectId);
    expect(bodies).toEqual([
      ...NAVIGATION_MAP_PROFILES.map(() => 'trading'),
      ...NAVIGATION_MAP_PROFILES.map(() => 'next-project'),
    ]);
  });

  it('queues Project clearing behind an in-flight publication', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    host.fetchJSON.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: true };
      const body = JSON.parse(String(init?.body || '{}'));
      await gate;
      return {
        ok: true,
        sha256: 'c'.repeat(64),
        bytes: JSON.stringify(body).length,
        nodes: body.nodes.length,
        relationships: body.relationships.length,
        focused: false,
      };
    });
    const publication = publishHermesNavigationMap(
      buildHermesNavigationMap(presentation(), null),
    );
    const clearing = clearHermesNavigationMap();
    await Promise.resolve();
    release();
    await Promise.all([publication, clearing]);
    await expect(awaitHermesNavigationMapReady()).resolves.toBeUndefined();

    const methods = host.fetchJSON.mock.calls.map(([, init]) => init?.method);
    expect(methods.slice(-NAVIGATION_MAP_PROFILES.length)).toEqual(
      NAVIGATION_MAP_PROFILES.map(() => 'DELETE'),
    );
  });
});
