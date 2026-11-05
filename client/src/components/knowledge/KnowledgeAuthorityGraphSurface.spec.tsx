// @vitest-environment jsdom

/**
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies one joined renderer, provider-status isolation, settings, selection, and shared Inspector without inventing graph identity or mutation.
 * Entity: ThinkGraph
 * Relationship: This file verifies exact Think records, relationships, Jev fields, provider IDs, positions, and confirmed removal remain intact in the shared surface.
 * Entity: KnowGraph
 * Relationship: This file verifies exact atomic and historical Knows, sources, relationships, provider isolation, and confirmed removal remain intact in the shared surface.
 * Entity: CodeGraph
 * Relationship: This file verifies CodeGraph remains opt-in, reuses the same renderer and Inspector, expands only the selected File, and exposes no iframe or Feature sorter.
 * Entity: Jev Decisions
 * Relationship: This file verifies probability-driven knowledge presentation, Code isolation from Jev, and manual setting preservation without another graph write.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as graphVisualTokens from '../graph/graphVisualTokens';

const forceGraphMocks = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('../../vendor/engraphis/vendor/d3.min.js', () => ({}));
vi.mock('../../vendor/engraphis/vendor/force-graph.min.js', () => ({}));
vi.mock('../../vendor/engraphis/engraphis-graph.js', () => {
  window.EngraphisGraph = { create(host, options) {
    expect(Object.keys(options).sort()).toEqual(
      options.onNodeDoubleClick
        ? ['onBackgroundClick', 'onLinkClick', 'onNodeClick', 'onNodeDoubleClick']
        : ['onBackgroundClick', 'onLinkClick', 'onNodeClick'],
    );
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const instance: any = {
      data: { nodes: [], links: [] }, nodeClick: options.onNodeClick,
      nodeDoubleClick: options.onNodeDoubleClick,
      linkClick: options.onLinkClick, backgroundClick: options.onBackgroundClick,
      setData: vi.fn(function (this: any, data: any) {
        const prior = new Map(this.data.nodes.map((node: any) => [node.id, node]));
        this.data = {
          ...data,
          nodes: data.nodes.map((node: any) => {
            const before: any = prior.get(node.id);
            return before
              ? { ...node, x: before.x, y: before.y, vx: before.vx, vy: before.vy }
              : { ...node };
          }),
          links: data.links || data.edges || [],
        };
      }),
      setHighlight: vi.fn(), setLayers: vi.fn(), setThemeColors: vi.fn(),
      setColorBy: vi.fn(), setTypeColors: vi.fn(),
      graphToScreen: (x: number, y: number) => ({ x, y }),
      setPreset: vi.fn(() => ({ size: 5, font: 13, linkw: 1, labelDensity: 40, repel: 120, link: 30, gravity: 14 })), setStyle: vi.fn(), setSettings: vi.fn(),
      resize: vi.fn(), setCollapse: vi.fn(), focus: vi.fn(() => true), clearFocus: vi.fn(), freeze: vi.fn(), reheat: vi.fn(), fit: vi.fn(), destroy: vi.fn(() => canvas.remove()),
      wheel: vi.fn(),
    };
    canvas.addEventListener('wheel', instance.wheel);
    forceGraphMocks.instances.push(instance);
    return instance;
  } };
  return {};
});

class ResizeObserverStub { observe() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import {
  JoinedKnowledgeGraphSurface,
  KnowledgeGraphProjectionSurface,
} from './KnowledgeAuthorityGraphSurface';
import {
  type GraphProjectionV1,
} from './knowledgeGraphProjection';
import KnowledgeGraphFramework from './KnowledgeGraphFramework';

function KnowGraphProjectionSurface({
  projection,
  error,
}: {
  projection: GraphProjectionV1;
  error: string | null;
}) {
  return <KnowledgeGraphProjectionSurface
    authority="knowgraph"
    projection={projection}
    status={error ? 'error' : 'ready'}
    error={error}
  />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forceGraphMocks.instances.length = 0;
  window.localStorage.clear();
});

describe('knowledge authority graph surfaces', () => {
  const empty = (authority: 'thinkgraph' | 'knowgraph'): GraphProjectionV1 => ({
    schemaVersion: authority === 'thinkgraph'
      ? 'thinkgraph.engraphis.v1'
      : 'knowgraph.projection.v1',
    authority,
    projectId: 'project-1',
    nodes: [],
    edges: [],
  });

  const emptyCode = (): GraphProjectionV1 => ({
    schemaVersion: 'codegraph.projection.v1',
    authority: 'codegraph',
    projectId: 'project-1',
    nodes: [],
    edges: [],
  });

  const knowRecord = (
    episodeId: string,
    title: string,
    observation: string,
    url: string,
  ) => ({
    id: episodeId,
    graphitiEpisodeId: episodeId,
    graphitiEntityId: `entity-${episodeId}`,
    kind: 'Know',
    title,
    observation,
    interpretation: 'Bounded interpretation.',
    citation: {
      url,
      title: `${title} source`,
      publisher: 'Example',
      evidence: `${observation} Exact source passage.`,
    },
  });

  const codeProps = (projection: GraphProjectionV1 = emptyCode()) => ({
    codeGraph: {
      projection,
      status: 'ready' as const,
      error: null,
      warning: null,
      freshness: 'current',
    },
    onOpenCodeGraph: vi.fn(async () => projection),
    onReadCodeGraphFiles: vi.fn(async () => null),
    onReadCodeGraphSource: vi.fn(async () => null),
  });

  const currentProjections = (
    think: GraphProjectionV1,
    know: GraphProjectionV1,
  ) => {
    const thinkNodes = think.nodes.map(node => ({
      ...node,
      canonicalName: node.canonicalName ?? node.label,
      entityKind: node.entityKind ?? node.type ?? 'person_or_concept',
      projectId: node.projectId ?? think.projectId,
    }));
    const knowNodes = know.nodes.map(node => ({
      ...node,
      canonicalName: node.canonicalName ?? node.label,
      entityKind: node.entityKind ?? node.type ?? 'Entity',
      projectId: node.projectId ?? know.projectId,
    }));
    const thinkEntities = thinkNodes.filter(node => Boolean(node.canonicalName));
    const knowEntities = knowNodes.filter(node => Boolean(node.canonicalName));
    const entitiesByName = new Map<string, any>();
    for (const node of thinkEntities) {
      entitiesByName.set(String(node.canonicalName), {
        authority: 'thinkgraph' as const,
        canonicalName: String(node.canonicalName),
        engraphisEntityId: node.id,
      });
    }
    for (const node of knowEntities) {
      const canonicalName = String(node.canonicalName);
      const current = entitiesByName.get(canonicalName);
      entitiesByName.set(canonicalName, current ? {
        authority: 'both' as const,
        canonicalName,
        engraphisEntityId: current.engraphisEntityId,
        graphitiEntityId: node.id,
      } : {
        authority: 'knowgraph' as const,
        canonicalName,
        graphitiEntityId: node.id,
      });
    }
    const entities = [...entitiesByName.values()];
    const directory = {
      schemaVersion: 'graph-entity-directory' as const,
      projectId: think.projectId,
      complete: true as const,
      counts: {
        engraphis: thinkEntities.length,
        graphiti: knowEntities.length,
        total: entities.length,
      },
      revisions: { engraphis: 'think-current', graphiti: 'know-current' },
      entities,
      sha256: 'a'.repeat(64),
      bytes: 512,
      estimatedTokens: 128,
      readDurationMs: 1,
    };
    return {
      thinkgraph: {
        ...think,
        nodes: thinkNodes,
        canonicalEntityDirectory: directory,
      },
      knowgraph: { ...know, nodes: knowNodes },
    };
  };








  it.each([
    ['thinkgraph', 'Know'],
    ['knowgraph', 'Think'],
  ] as const)('focuses a mixed-canvas %s-only node without inventing another authority lens', (authority, absentTab) => {
    const providerProjection = {
      ...empty(authority),
      nodes: [{ id: `${authority}-only`, label: 'Single authority', properties: {} }],
    };
    render(<JoinedKnowledgeGraphSurface
      projections={{
        thinkgraph: authority === 'thinkgraph' ? providerProjection : empty('thinkgraph'),
        knowgraph: authority === 'knowgraph' ? providerProjection : empty('knowgraph'),
      }}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));

    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBe('Single authority');
    expect(screen.getByTestId(`${authority}-node-inspector`).getAttribute('data-provider-id'))
      .toBe(`${authority}-only`);
    expect(screen.getByRole('complementary').textContent).not.toContain(absentTab);
    expect(screen.queryByRole('tab', { name: absentTab })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Load$/ })).toBeNull();
  });

  it('renders only real direct Think and Know records and deletes the exact atomic fact', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{
        id: 'think-shared', label: 'Shared', properties: {
          evidence: [{
            id: 'memory-1',
            ingestedAt: '2026-10-03T12:00:00Z',
            summary: 'Direct Think summary.',
            metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
          }],
        },
      }],
      edges: [],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-shared', label: 'Shared', properties: { evidence: [{
          ...knowRecord(
            'episode-1', 'Know', 'Direct sourced Know.', 'https://example.com/source',
          ),
          ingestedAt: '2026-10-03T12:30:00Z',
        }] } },
        { id: 'know-target', label: 'Target', properties: {} },
      ],
      edges: [{
        id: 'visual-edge',
        source: 'know-shared',
        target: 'know-target',
        predicate: 'SUPPORTS',
        properties: {
          graphitiFactUuid: 'fact-provider-1',
          fact: 'Direct sourced Know.',
          createdAt: '2026-10-03T12:30:00Z',
        },
      }],
    };
    const removeThink = vi.fn().mockResolvedValue(undefined);
    const removeKnow = vi.fn().mockResolvedValue(undefined);
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(think, know)}
      onRemoveThinkGraphEvidence={removeThink}
      onRemoveKnowGraphEvidence={removeKnow}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes.find((node: any) => node.label === 'Shared')));

    expect(screen.getByRole('tab', { name: 'Think' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Know' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Know' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Technical details')).toBeNull();
    expect(screen.queryByText('Reread contents')).toBeNull();
    expect(screen.queryByText('Use selected in chat')).toBeNull();

    expect(screen.getByTestId('knowledge-know-records').textContent)
      .toContain('Direct sourced Know.');
    expect(screen.getAllByRole('link').some(link => (
      link.getAttribute('href') === 'https://example.com/source'
      && link.textContent?.includes('Know source')
    ))).toBe(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    await waitFor(() => expect(removeKnow).toHaveBeenCalledExactlyOnceWith('episode-1'));
    expect(removeThink).not.toHaveBeenCalled();
  });

  it('opens the exact Run-linked Know ahead of the ordinary two-record recency window', async () => {
    const know = {
      ...empty('knowgraph'),
      nodes: [{
        id: 'know-shared',
        label: 'Shared',
        properties: { evidence: [
          {
            ...knowRecord(
              'episode-new', 'Newest Know', 'Newest ordinary Know.',
              'https://example.test/new',
            ),
            ingestedAt: '2026-10-20T12:00:00Z',
          },
          {
            ...knowRecord(
              'episode-middle', 'Middle Know', 'Middle ordinary Know.',
              'https://example.test/middle',
            ),
            ingestedAt: '2026-10-20T11:00:00Z',
          },
          {
            ...knowRecord(
              'episode-exact', 'Exact Know', 'Exact Run-linked Know.',
              'https://example.test/exact',
            ),
            ingestedAt: '2026-10-20T10:00:00Z',
          },
        ] },
      }],
    };
    const projections = currentProjections(empty('thinkgraph'), know);
    render(<JoinedKnowledgeGraphSurface
      projections={projections}
      entityFocusRequest={{
        projectId: 'project-1',
        directorySha256: 'a'.repeat(64),
        canonicalName: 'Shared',
        view: 'knowgraph',
        members: [{ authority: 'knowgraph', entityId: 'know-shared' }],
        graphitiEpisodeId: 'episode-exact',
        requestId: 1,
      }}
    />);

    await waitFor(() => expect(screen.getByTestId('knowledge-know-records')).toBeTruthy());
    const text = screen.getByTestId('knowledge-know-records').textContent || '';
    expect(text).toContain('Exact Run-linked Know.');
    expect(text).toContain('Newest ordinary Know.');
    expect(text).not.toContain('Middle ordinary Know.');
    expect(text.indexOf('Exact Run-linked Know.'))
      .toBeLessThan(text.indexOf('Newest ordinary Know.'));
  });

  it('defaults joined Entities to Know and preserves the chosen authority lens across node selections', () => {
    const thinkRecord = (id: string, summary: string) => ({
      id,
      ingestedAt: '2026-10-03T12:00:00Z',
      summary,
      metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
    });
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-a', label: 'Joined A', properties: { evidence: [thinkRecord('memory-a', 'Think A.')] } },
        { id: 'think-b', label: 'Joined B', properties: { evidence: [thinkRecord('memory-b', 'Think B.')] } },
        { id: 'think-only', label: 'Think only', properties: { evidence: [thinkRecord('memory-only', 'Think only record.')] } },
      ],
      edges: [],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-a', label: 'Joined A', properties: { evidence: [
          knowRecord('know-a-episode', 'Know A', 'Know A.', 'https://example.test/a'),
        ] } },
        { id: 'know-b', label: 'Joined B', properties: { evidence: [
          knowRecord('know-b-episode', 'Know B', 'Know B.', 'https://example.test/b'),
        ] } },
        { id: 'know-only', label: 'Know only', properties: { evidence: [
          knowRecord(
            'know-only-episode', 'Know only', 'Know only record.',
            'https://example.test/only',
          ),
        ] } },
        { id: 'target-a', label: 'Target A', properties: {} },
        { id: 'target-b', label: 'Target B', properties: {} },
        { id: 'target-only', label: 'Target only', properties: {} },
      ],
      edges: [
        { id: 'edge-a', source: 'know-a', target: 'target-a', predicate: 'SUPPORTS', properties: {
          graphitiFactUuid: 'fact-a', fact: 'Know A.', temporalStatus: 'current',
        } },
        { id: 'edge-b', source: 'know-b', target: 'target-b', predicate: 'SUPPORTS', properties: {
          graphitiFactUuid: 'fact-b', fact: 'Know B.', temporalStatus: 'current',
        } },
        { id: 'edge-only', source: 'know-only', target: 'target-only', predicate: 'SUPPORTS', properties: {
          graphitiFactUuid: 'fact-only', fact: 'Know only record.', temporalStatus: 'current',
        } },
      ],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(think, know)}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    const node = (label: string) => graph.data.nodes.find((candidate: any) => candidate.label === label);

    act(() => graph.nodeClick(node('Joined A')));
    expect(screen.getByRole('tab', { name: 'Know' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Know A.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Think' }));
    expect(screen.getByRole('tab', { name: 'Think' }).getAttribute('aria-selected')).toBe('true');

    act(() => graph.nodeClick(node('Joined B')));
    expect(screen.getByRole('tab', { name: 'Think' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Think B.')).toBeTruthy();

    act(() => graph.nodeClick(node('Think only')));
    expect(screen.getByRole('tab', { name: 'Think' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Think only record.')).toBeTruthy();

    act(() => graph.nodeClick(node('Know only')));
    expect(screen.getByRole('tab', { name: 'Know' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Know only record.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('selects without a Focus control, collapse, Jev request, or view replacement', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const think = { ...empty('thinkgraph'), nodes: [
      { id: 'center', label: 'Center', properties: {} },
      { id: 'neighbor', label: 'Neighbor', properties: {} },
    ], edges: [{ id: 'edge', source: 'center', target: 'neighbor', predicate: 'RELATES_TO' }] };
    render(<JoinedKnowledgeGraphSurface projections={{ thinkgraph: think, knowgraph: empty('knowgraph') }} />);
    const graph = forceGraphMocks.instances.at(-1);
    const ids = graph.data.nodes.map((node: any) => node.id);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();
    expect(screen.queryByTestId('jev-focus-toolbar')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(ids);
    act(() => graph.backgroundClick());
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(ids);
  });

  it('keeps a healthy authority visible while truthfully reporting the other authority failure', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'think-only', label: 'Healthy Think', properties: {} }],
    };
    render(<JoinedKnowledgeGraphSurface
      projections={{ thinkgraph: think, knowgraph: empty('knowgraph') }}
      statuses={{ thinkgraph: 'ready', knowgraph: 'error' }}
      errors={{ knowgraph: 'request timed out' }}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.nodes.map((node: any) => node.label)).toEqual(['Healthy Think']);
    expect(screen.getByTestId('knowledge-authority-warning').textContent)
      .toBe('KnowGraph unavailable: request timed out');
    expect(screen.queryByText(/Graph failed/)).toBeNull();
  });

  it.each(['knowgraph'] as const)('uses internal Engraphis layout for %s with zoom and shared paper', (authority) => {
    const { container } = render(<KnowledgeGraphProjectionSurface authority={authority}
      projection={empty(authority)} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(container.querySelector('[data-renderer="engraphis-1.7.1"]')).toBeTruthy();
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    expect(graph.setStyle).toHaveBeenCalledWith('cyber');
    expect(graph.setSettings).toHaveBeenCalledWith({
      size: 5, font: 13, linkw: 1, labelDensity: 40,
      repel: 120, link: 30, gravity: 14, labels: true,
    });
    const paper = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(paper.style.backgroundSize.startsWith('24px 24px')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(graph.wheel.mock.calls.at(-1)[0].deltaY).toBe(-120);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(graph.wheel.mock.calls.at(-1)[0].deltaY).toBe(120);
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));
    expect(graph.fit).toHaveBeenCalledOnce();
    expect(paper.style.backgroundSize.startsWith('24px 24px')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.queryByRole('combobox', { name: 'Layout' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(graph.setCollapse).toHaveBeenCalledWith(false);
    expect(graph.data.nodes).toEqual([]);
    expect(screen.queryByRole('button', { name: /Freeze|Resume|Reheat|Focus/ })).toBeNull();
    expect(graph.freeze).not.toHaveBeenCalled();
  });

  it.each(['thinkgraph', 'knowgraph'] as const)(
    'applies the internal Jev profile to %s without user tuning, graph mutation or another Jev call',
    authority => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const projection = {
        ...empty(authority),
        nodes: [{ id: 'a', label: 'Alpha', properties: {} }, { id: 'b', label: 'Beta', properties: {} }],
        edges: [{
          id: 'ab', source: 'a', target: 'b', predicate: 'PROVIDES',
          properties: {
            jev: {
              status: 'success',
              winner: 'PROVIDES',
              distribution: { PROVIDES: 0.8, ASSOCIATED_WITH: 0.2 },
            },
          },
        }],
      };
      const original = structuredClone(projection);
      const { container } = render(<KnowledgeGraphProjectionSurface authority={authority}
        projection={projection} status="ready" error={null} />);
      const graph = forceGraphMocks.instances.at(-1);
      expect(graph.data.links[0]).toMatchObject({
        relationship_strength: 0.8,
        visual_width: 2.35,
        spring_strength: 0.18640000000000004,
        rest_length: 22.639999999999997,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
      expect(screen.queryByRole('combobox', { name: 'Physics profile' })).toBeNull();
      expect(container.querySelector('[data-physics-profile="galaxy"]')).toBeTruthy();
      expect(graph.data.links[0].visual_width).toBeCloseTo(2.35);
      act(() => graph.nodeClick(graph.data.nodes[1]));
      for (const implementationField of ['Semantic mass', 'Physics profile', 'Source graph', 'Provider ID']) {
        expect(screen.queryByText(implementationField)).toBeNull();
      }
      expect(projection).toEqual(original);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('preserves Engraphis scene metadata and source records while applying incoming size', () => {
    window.localStorage.setItem('liquidaity.graph.knowgraph.presentation.v1', JSON.stringify({
      schemaVersion: 6,
      style: 'cyber',
    }));
    const scene = {
      nodes: [{ id: 'jev', label: 'Jev', semantic_mass: 0.82, gravity_mass: 9.4, visual_radius: 7.2 }],
      edges: [{
        id: 'semantic-edge', source: 'jev', target: 'thinkgraph', predicate: 'QUALIFIES', relation: 'QUALIFIES',
        relationship_strength: 0.82, label_confidence: 0.71,
        spring_strength: 0.1744, rest_length: 16.16,
      }],
      communities: [], meta: { layout_seed: 7 },
    };
    render(<KnowledgeGraphProjectionSurface authority="knowgraph"
      projection={{ ...empty('thinkgraph'), scene }} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(scene.nodes[0]).not.toHaveProperty('material_kind');
    expect(graph.setData.mock.calls[0][0]).toMatchObject({
      meta: { layout_seed: 7 },
      communities: [],
    });
    expect(graph.data.nodes[0]).toMatchObject({
      semantic_mass: 0.82, gravity_mass: 9.4, visual_radius: 2.5,
    });
    expect(scene.nodes[0].visual_radius).toBe(7.2);
    expect(graph.data.nodes[0].material_kind).toBe('solarpunk');
    expect(graph.setThemeColors).toHaveBeenLastCalledWith(expect.objectContaining({
      material_blue: '#4FA2AD', material_orange: '#F2A64A' }));
    expect(graph.data.links[0]).toMatchObject({
      relation: 'QUALIFIES', relationship_strength: 0.82,
      spring_strength: 0.1744, rest_length: 16.16,
    });
  });

  it('starts KnowGraph empty without loading the complete Neo4j graph', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<KnowGraphProjectionSurface projection={empty('knowgraph')} error={null} />);
    await waitFor(() => expect(screen.getByTestId('knowledge-knowgraph-surface')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open graph settings' })).toBeTruthy();
    expect(screen.getByText('No knowledge yet.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders provider entries without hiding isolated nodes or inventing connections', async () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [{ id: 'entity-one', label: 'Existing entity', mentionCount: 1 }],
    };
    render(<KnowGraphProjectionSurface projection={projection} error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes.map((node: { id: string }) => node.id)).toEqual(['entity-one']));
    expect(graph.data.links).toEqual([]);
    expect(screen.queryByRole('checkbox', { name: 'Hide unconnected entities' })).toBeNull();
    expect(projection.nodes).toEqual([{ id: 'entity-one', label: 'Existing entity', mentionCount: 1 }]);
    expect(projection.edges).toEqual([]);
  });

  it('loads provider records into the replacement renderer after Strict Mode effect replay', () => {
    const projection = { ...empty('knowgraph'), nodes: [{ id: 'source', label: 'W3C', mentionCount: 1 }] };
    render(<StrictMode><KnowGraphProjectionSurface projection={projection} error={null} /></StrictMode>);
    expect(forceGraphMocks.instances).toHaveLength(2);
    expect(forceGraphMocks.instances.at(-1).data.nodes.map((node: { id: string }) => node.id)).toEqual(['source']);
  });

  it('controls Think, Know, and lazy Code as independent layers on one canvas', async () => {
    const thinkProjection: GraphProjectionV1 = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'think-one', label: 'Think one', properties: {} }],
    };
    const knowProjection: GraphProjectionV1 = {
      ...empty('knowgraph'),
      nodes: [{ id: 'know-one', label: 'Know one', properties: {} }],
    };
    const codeProjection: GraphProjectionV1 = {
      ...emptyCode(),
      nodes: [
        { id: 'feature:CodeGraph', label: 'CodeGraph', authority: 'codegraph', type: 'Feature', etype: 'Feature', properties: { recordKind: 'feature', featureName: 'CodeGraph', memberFilePaths: ['client/src/surface.tsx'] } },
        { id: 'source-file:client/src/surface.tsx', label: 'surface.tsx', authority: 'codegraph', type: 'File', etype: 'File', properties: { recordKind: 'file', filePath: 'client/src/surface.tsx', sourceReference: 'source-file:client/src/surface.tsx', sourceAuthority: 'repository-file', features: ['CodeGraph'], contributions: [{ feature: 'CodeGraph', relationship: 'Renders the shared graph.' }] } },
      ],
      edges: [{ id: 'feature-file', source: 'feature:CodeGraph', target: 'source-file:client/src/surface.tsx', predicate: 'FEATURE_CONTRIBUTION', properties: { filePath: 'client/src/surface.tsx', relationship: 'Renders the shared graph.' } }],
    };
    const openCode = vi.fn();
    const readCodeFile = vi.fn(async () => null);
    const readCodeSource = vi.fn(async () => null);
    function LayerHarness() {
      const [codeGraph, setCodeGraph] = useState({
        projection: emptyCode(),
        status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
        error: null as string | null,
        warning: null as string | null,
        freshness: 'unverified',
      });
      return <KnowledgeGraphFramework
        projections={currentProjections(thinkProjection, knowProjection)}
        errors={{}}
        codeGraph={codeGraph}
        onOpenCodeGraph={async () => {
          openCode();
          setCodeGraph({
            projection: codeProjection,
            status: 'ready',
            error: null,
            warning: null,
            freshness: 'current',
          });
          return codeProjection;
        }}
        onReadCodeGraphFiles={readCodeFile}
        onReadCodeGraphSource={readCodeSource}
      />;
    }
    const { container } = render(
      <LayerHarness />,
    );

    expect(container.querySelector('[data-testid="knowledge-codegraph-surface"]')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Graph authority' })).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'CodeGraph Feature' })).toBeNull();
    expect(screen.queryByText('All Features')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')).toBeTruthy());
    expect(container.querySelectorAll('.knowledge-authority-network')).toHaveLength(1);
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes.map((node: any) => node.label))
      .toEqual(['Think one', 'Know one']));
    expect(openCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    const thinkLayer = screen.getByRole('button', { name: 'Think source' });
    const knowLayer = screen.getByRole('button', { name: 'Know source' });
    const codeLayer = screen.getByRole('button', { name: 'Code source' });
    expect(thinkLayer.getAttribute('aria-pressed')).toBe('true');
    expect(knowLayer.getAttribute('aria-pressed')).toBe('true');
    expect(codeLayer.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('codegraph-scope').textContent)
      .toContain('CodeGraph · Repository-scoped');

    fireEvent.click(knowLayer);
    await waitFor(() => expect(graph.data.nodes.map((node: any) => node.label))
      .toEqual(['Think one']));
    expect(thinkLayer.getAttribute('aria-pressed')).toBe('true');
    expect(knowLayer.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(knowLayer);
    await waitFor(() => expect(graph.data.nodes.map((node: any) => node.label))
      .toEqual(['Think one', 'Know one']));

    fireEvent.click(codeLayer);
    await waitFor(() => expect(openCode).toHaveBeenCalledTimes(1));
    expect(readCodeFile).not.toHaveBeenCalled();
    expect(graph.data.nodes.map((node: any) => node.label)).toEqual(['Think one', 'Know one']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'CodeGraph' }));
    await waitFor(() => expect(graph.data.nodes.map((node: any) => node.label)).toEqual([
      'surface.tsx', 'Think one', 'Know one',
    ]));
    expect(graph.setTypeColors).not.toHaveBeenCalled();
    expect(graph.data.nodes.find((node: any) => node.etype === 'File')).not.toHaveProperty('material_kind');
    expect(graph.data.nodes.some((node: any) => node.etype === 'Feature')).toBe(false);
    expect(graph.data.links).toEqual([]);
    expect(graph.setStyle).toHaveBeenCalledWith('cyber');
    act(() => graph.nodeClick(graph.data.nodes.find((node: any) => node.etype === 'File')));
    await waitFor(() => expect(readCodeFile).toHaveBeenCalledWith(['client/src/surface.tsx']));
    expect(screen.getByTestId('codegraph-node-details').textContent)
      .toContain('client/src/surface.tsx');
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    await waitFor(() => expect(readCodeSource).toHaveBeenCalledWith('client/src/surface.tsx'));
    act(() => graph.backgroundClick());
    expect(screen.getByRole('group', { name: 'Graph sources' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Code source' }).getAttribute('aria-pressed'))
      .toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Think source' }));
    await waitFor(() => expect(graph.data.nodes.map((node: any) => node.label)).toEqual([
      'surface.tsx', 'Know one',
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'Reset graph sources' }));
    await waitFor(() => expect(graph.data.nodes.map((node: any) => node.label))
      .toEqual(['Think one', 'Know one']));
    expect(screen.getByRole('button', { name: 'Think source' }).getAttribute('aria-pressed'))
      .toBe('true');
    expect(screen.getByRole('button', { name: 'Know source' }).getAttribute('aria-pressed'))
      .toBe('true');
    expect(screen.getByRole('button', { name: 'Code source' }).getAttribute('aria-pressed'))
      .toBe('false');
    expect(openCode).toHaveBeenCalledTimes(1);
  });

  it('keeps Think/Know tabs and a violet association rim while code files have their own inspector', async () => {
    const projections = currentProjections(
      { ...empty('thinkgraph'), nodes: [{ id: 'think-shared', label: 'Shared', properties: {} }] },
      { ...empty('knowgraph'), nodes: [{ id: 'know-shared', label: 'Shared', properties: {} }] },
    );
    const code: GraphProjectionV1 = { ...emptyCode(), nodes: [
      { id: 'feature:shared', label: 'Shared', authority: 'codegraph', etype: 'Feature', properties: {
        recordKind: 'feature', featureName: 'Shared', memberFilePaths: ['client/shared.ts'],
      } },
      { id: 'file:shared', label: 'shared.ts', authority: 'codegraph', etype: 'File', properties: {
        recordKind: 'file', filePath: 'client/shared.ts', qualifiedName: 'file:shared', features: ['Shared'], contributions: [{ feature: 'Shared', relationship: 'Implements the Shared feature.' }],
      } },
    ], edges: [{ id: 'shared-file', source: 'feature:shared', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION',
      properties: { relationship: 'Implements the Shared feature.', filePath: 'client/shared.ts' } }] };
    render(<JoinedKnowledgeGraphSurface projections={projections}
      codeGraph={{ projection: code, status: 'ready', error: null, warning: null, freshness: 'current' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Code source' }));
    const graph = forceGraphMocks.instances.at(-1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shared' }));
    await waitFor(() => expect(graph.data.nodes).toHaveLength(2));
    const shared = graph.data.nodes.find((node: any) => node.label === 'Shared');
    expect(shared).toMatchObject({ material_kind: 'joined-cyber', material_role: 'PAIRED_CYBER_MATERIAL',
      material_code_present: true });
    act(() => graph.nodeClick(shared));
    expect(screen.getByRole('tab', { name: 'Think' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Know' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Code' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Think' }));
    expect(screen.getByTestId('thinkgraph-node-inspector').getAttribute('data-provider-id')).toBe('think-shared');
    fireEvent.click(screen.getByRole('tab', { name: 'Know' }));
    expect(screen.getByTestId('knowgraph-node-inspector').getAttribute('data-provider-id')).toBe('know-shared');
    expect(graph.data.nodes.filter((node: any) => node.label === 'Shared')).toHaveLength(1);
    expect(graph.data.nodes.find((node: any) => node.label === 'Shared').material_code_present).toBe(true);
    act(() => graph.nodeClick(graph.data.nodes.find((node: any) => node.etype === 'File')));
    expect(screen.getByTestId('codegraph-node-inspector').getAttribute('data-provider-id')).toBe('file:shared');
    expect(screen.getByTestId('codegraph-node-details').textContent).toContain('Implements the Shared feature.');
    expect(screen.queryByRole('tab', { name: 'Know' })).toBeNull();
  });

  it('lets the inspector select multiple source categories without fetching the full structural graph', async () => {
    const onReadCodeGraphFiles = vi.fn(async () => null);
    const codeProjection: GraphProjectionV1 = {
      ...emptyCode(),
      nodes: [
        ...['CodeGraph', 'Source headers', 'Other'].map(label => ({ id: `feature:${label}`, label,
          authority: 'codegraph', etype: 'Feature', properties: { recordKind: 'feature', featureName: label, memberFilePaths: label === 'Other' ? ['client/other.ts'] : ['client/shared.ts'] } })),
        { id: 'file:shared', label: 'shared.ts', authority: 'codegraph', etype: 'File', properties: {
          recordKind: 'file', filePath: 'client/shared.ts', qualifiedName: 'file:shared',
        } },
        { id: 'file:other', label: 'other.ts', authority: 'codegraph', etype: 'File', properties: {
          recordKind: 'file', filePath: 'client/other.ts', qualifiedName: 'file:other',
        } },
      ],
      edges: ['CodeGraph', 'Source headers', 'Other'].map(label => ({ id: `${label}-file`, source: `feature:${label}`,
        target: label === 'Other' ? 'file:other' : 'file:shared', predicate: 'FEATURE_CONTRIBUTION', properties: { relationship: `${label} contribution.` } })),
    };
    render(<JoinedKnowledgeGraphSurface projections={currentProjections(empty('thinkgraph'), empty('knowgraph'))}
      codeGraph={{ projection: codeProjection, status: 'ready', error: null, warning: null, freshness: 'current' }}
      onReadCodeGraphFiles={onReadCodeGraphFiles} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Code source' }));
    const graph = forceGraphMocks.instances.at(-1);
    expect(screen.getByRole('group', { name: 'CodeGraph categories' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'CodeGraph' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source headers' }));
    await waitFor(() => expect(graph.data.nodes).toHaveLength(1));
    expect(graph.data.links).toEqual([]);
    expect(graph.data.nodes.filter((node: any) => node.etype === 'File')).toHaveLength(1);
    expect(graph.data.nodes.some((node: any) => node.label === 'Other')).toBe(false);
    expect(graph.data.nodes.some((node: any) => node.label === 'CodeGraph')).toBe(false);
    expect(graph.data.nodes.some((node: any) => node.label === 'Source headers')).toBe(false);
    await waitFor(() => expect(onReadCodeGraphFiles).toHaveBeenCalledWith(['client/shared.ts']));
    expect(onReadCodeGraphFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    await waitFor(() => expect(onReadCodeGraphFiles).toHaveBeenLastCalledWith(['client/other.ts', 'client/shared.ts']));
    expect(onReadCodeGraphFiles).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Clear category selection' }));
    await waitFor(() => expect(graph.data.nodes).toHaveLength(0));
    expect(graph.data.links).toHaveLength(0);
    expect(graph.data.nodes.every((node: any) => !node.ghost)).toBe(true);
  });

  it.each(['error', 'ready'] as const)('reloads Code on an explicit layer-open from %s without reloading the app', async status => {
    const onOpenCodeGraph = vi.fn(async () => null);
    render(<JoinedKnowledgeGraphSurface projections={currentProjections(empty('thinkgraph'), empty('knowgraph'))}
      statuses={{ thinkgraph: 'ready', knowgraph: 'ready' }} errors={{}}
      codeGraph={{ projection: emptyCode(), status, error: status === 'error' ? 'read_timeout' : null, warning: null, freshness: 'unverified' }}
      onOpenCodeGraph={onOpenCodeGraph} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Code source' }));
    await waitFor(() => expect(onOpenCodeGraph).toHaveBeenCalledTimes(1));
  });

  it('keeps the relationship word and probability hover-only on a ThinkGraph edge', () => {
    const projection = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'subject', label: 'Subject' }, { id: 'idea', label: 'Idea' }],
      edges: [{ id: 'edge', source: 'subject', target: 'idea', predicate: 'DEPENDS_ON',
        provenance: { memoryId: 'stored-memory' }, properties: {
          summary: 'Recorded relationship.', relationship_strength: 0.71,
          jev: { winner: 'DEPENDS_ON', distribution: { DEPENDS_ON: 0.71, AFFECTS: 0.29 } },
        } }],
    };
    const before = JSON.stringify(projection);
    render(<KnowledgeGraphProjectionSurface authority="thinkgraph" projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.links).toHaveLength(1);
    expect(graph.data.links[0]).toMatchObject({
      ...projection.edges[0], relation: 'DEPENDS_ON', hover_label: 'DEPENDS_ON · .71',
      directional_arrow_length: 3, directional_arrow_rel_pos: 0.9,
    });
    expect(graph.data.links[0].label).toBe('');
    expect(graph.data.nodes.map((node: any) => [node.id, node.label])).toEqual([['subject', 'Subject'], ['idea', 'Idea']]);
    expect(JSON.stringify(projection)).toBe(before);
    act(() => graph.linkClick(graph.data.links[0]));
    expect(screen.getByTestId('thinkgraph-edge-inspector').textContent).toContain('Recorded relationship.');
  });

  it('keeps the shared canvas and source controls without exposing renderer tuning', async () => {
    const { container } = render(<KnowledgeGraphFramework
      projections={{ thinkgraph: empty('thinkgraph'), knowgraph: empty('knowgraph') }}
      errors={{}} {...codeProps()} />);
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')).toBeTruthy());
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('No knowledge yet.')).toBeTruthy();
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    for (const source of ['Think source', 'Know source', 'Code source']) {
      expect(screen.getByRole('button', { name: source })).toBeTruthy();
    }
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset to preset defaults' })).toBeNull();
    expect(graph.setSettings).toHaveBeenCalledWith({
      size: 5, font: 13, linkw: 1, labelDensity: 40,
      repel: 120, link: 30, gravity: 14, labels: true,
    });
    expect(graph.data.nodes).toEqual([]);
    expect(graph.data.links).toEqual([]);
  });

  it('restores the saved layout, Jev profile, force settings and line multiplier without exposing tuning', () => {
    const key = 'liquidaity.graph.thinkgraph.presentation.v1';
    const stored = JSON.stringify({ schemaVersion: 6, layout: 'radial', style: 'classic',
      physicsProfile: 'open', settings: {
        repel: 80, link: 44, gravity: 20, linkw: 0.6, size: 3, labels: false,
      } });
    window.localStorage.setItem(key, stored);
    const projection = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
      edges: [{ id: 'ab', source: 'a', target: 'b', predicate: 'PROVIDES', properties: {
        jev: { status: 'success', winner: 'PROVIDES',
          distribution: { PROVIDES: 0.8, ASSOCIATED_WITH: 0.2 } },
      } }],
    };
    const { container } = render(<KnowledgeGraphProjectionSurface authority="thinkgraph"
      projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.setPreset).toHaveBeenCalledWith('radial');
    expect(graph.setSettings).toHaveBeenCalledWith({
      size: 5, font: 13, linkw: 0.6, labelDensity: 40,
      repel: 80, link: 44, gravity: 20, labels: true,
    });
    expect(container.querySelector('[data-style="solarpunk"][data-physics-profile="open"]')).toBeTruthy();
    expect(graph.data.links[0].visual_width).toBeCloseTo(1.8);
    expect(graph.data.links[0].spring_strength).toBeCloseTo(0.121);
    expect(graph.data.links[0].rest_length).toBeCloseTo(24.4);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(window.localStorage.getItem(key)).toBe(stored);
  });

  it('keeps canonical colors without rewriting legacy presentation data', () => {
    const key = 'liquidaity.graph.joined.presentation.v1';
    const stored = JSON.stringify({ schemaVersion: 3, style: 'cyber',
      settings: { size: 3 }, solarpunkColors: { think: '#6e5fae', know: '#ffffff' } });
    window.localStorage.setItem(key, stored);
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(empty('thinkgraph'), empty('knowgraph'))} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.setThemeColors).toHaveBeenLastCalledWith(expect.objectContaining({
      material_blue: '#4FA2AD', material_orange: '#F2A64A' }));
    expect(window.localStorage.getItem(key)).toBe(stored);
  });

  it('renders the mixed canvas with the original Solarpunk material and authority-matched colors', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-shared', label: 'Shared', properties: {} },
        { id: 'think-only', label: 'Think only', properties: {} },
      ],
      edges: [{
        id: 'think-edge', source: 'think-shared', target: 'think-only',
        predicate: 'REASONS_ABOUT', properties: { providerRecord: 'think' },
      }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-shared', label: 'Shared', properties: {} },
        { id: 'know-only', label: 'Know only', properties: {} },
      ],
      edges: [{
        id: 'know-edge', source: 'know-shared', target: 'know-only',
        predicate: 'SOURCED_BY', properties: { providerRecord: 'know' },
      }],
    };
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(think, know)}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes).toHaveLength(3));
    expect(graph.setStyle).toHaveBeenCalledWith('cyber');

    expect(graph.data.nodes.find((node: any) => node.label === 'Shared')).toMatchObject({
      material_kind: 'joined-cyber', material_role: 'PAIRED_CYBER_MATERIAL',
      material_blue: '#4FA2AD', material_orange: '#F2A64A', material_surface: '#0B0E12',
    });
    expect(graph.data.nodes.find((node: any) => node.label === 'Think only')).toMatchObject({
      material_kind: 'joined-cyber', material_role: 'THINK_MATERIAL', material_blue: '#4FA2AD',
    });
    expect(graph.data.nodes.find((node: any) => node.label === 'Know only')).toMatchObject({
      material_kind: 'joined-cyber', material_role: 'KNOW_MATERIAL', material_orange: '#F2A64A',
    });
    expect(graph.data.links.map((edge: any) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      predicate: edge.predicate,
      authority: edge.material_authority,
      color: edge.material_color,
      providerRecord: edge.properties.providerRecord,
    }))).toEqual([
      {
        id: 'thinkgraph:think-edge', source: 'node-name:Shared', target: 'thinkgraph:think-only',
        predicate: 'REASONS_ABOUT', authority: 'thinkgraph', color: '#4FA2AD', providerRecord: 'think',
      },
      {
        id: 'knowgraph:know-edge', source: 'node-name:Shared', target: 'knowgraph:know-only',
        predicate: 'SOURCED_BY', authority: 'knowgraph', color: '#F2A64A', providerRecord: 'know',
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.queryByRole('group', { name: 'Solarpunk colors' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Style' })).toBeNull();
  });

  it('keeps internal presentation stable on remount and leaves old saved keys untouched', () => {
    const key = 'liquidaity.graph.thinkgraph.presentation.v1';
    const oldKey = 'liquidaity.graph.combined.presentation.v1';
    window.localStorage.setItem(key, 'old-size-and-style');
    window.localStorage.setItem(oldKey, 'leave-this-untouched');
    const first = render(<KnowledgeGraphProjectionSurface authority="thinkgraph"
      projection={empty('thinkgraph')} status="ready" error={null} />);
    first.unmount();
    render(<KnowledgeGraphProjectionSurface authority="thinkgraph"
      projection={empty('thinkgraph')} status="ready" error={null} />);
    expect(forceGraphMocks.instances.at(-1).setPreset).toHaveBeenCalledWith('compact');
    expect(window.localStorage.getItem(key)).toBe('old-size-and-style');
    expect(window.localStorage.getItem(oldKey)).toBe('leave-this-untouched');
  });

  it('ignores malformed legacy tuning and exposes no physics controls', () => {
    const key = 'liquidaity.graph.knowgraph.presentation.v1';
    window.localStorage.setItem(key, JSON.stringify({ style: 'unknown', layout: 'everything',
      physicsProfile: 'unsafe', settings: { size: 99, gravity: Infinity } }));
    render(<KnowledgeGraphProjectionSurface authority="knowgraph"
      projection={empty('knowgraph')} status="ready" error={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(forceGraphMocks.instances.at(-1).setSettings)
      .toHaveBeenCalledWith({
        size: 5, font: 13, linkw: 1, labelDensity: 40,
        repel: 120, link: 30, gravity: 14, labels: true,
      });
  });

  it('displays the full union without inventing a join when no Entity directory is supplied', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'shared-think', canonicalId: 'think-provider', label: 'Shared', properties: {} },
        { id: 'canonical-only-think', canonicalId: 'same-canonical', label: 'Think name', properties: {} },
        { id: 'think-only', label: 'Think only', properties: {} },
      ],
      edges: [{ id: 'think-edge', source: 'shared-think', target: 'think-only', predicate: 'THINKS_WITH', properties: {} }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'shared-know', canonicalId: 'know-provider', label: 'Shared', properties: {} },
        { id: 'canonical-only-know', canonicalId: 'same-canonical', label: 'Know name', properties: {} },
        { id: 'know-only', label: 'Know only', properties: {} },
      ],
      edges: [{ id: 'know-edge', source: 'shared-know', target: 'know-only', predicate: 'KNOWS_WITH', properties: {} }],
    };
    render(<KnowledgeGraphFramework
      projections={{ thinkgraph: think, knowgraph: know }}
      errors={{}}
      {...codeProps()}
    />);
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')).toBeTruthy());
    const graph = forceGraphMocks.instances.at(-1);
    expect(forceGraphMocks.instances).toHaveLength(1);
    expect(graph.data.nodes.map((node: any) => node.label))
      .toEqual(['Shared', 'Think name', 'Think only', 'Shared', 'Know name', 'Know only']);
    expect(graph.data.links.map((edge: any) => edge.layer)).toEqual(['thinkgraph', 'knowgraph']);
    expect(screen.queryByRole('button', { name: 'Think relationships' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Know relationships' })).toBeNull();
    expect(graph.setLayers).not.toHaveBeenCalled();
    expect(screen.queryByRole('tablist', { name: 'Knowledge graph view' })).toBeNull();
    expect(graph.destroy).not.toHaveBeenCalled();
    expect(forceGraphMocks.instances).toHaveLength(1);
  });

  it('opens only the selected ThinkGraph entry and keeps graph settings separate', () => {
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry', properties: {
      evidence: [{ id: 'memory-one', title: 'Existing saved Think', ingestedAt: 100,
        summary: 'Saved Think.',
        metadata: { thinkgraph_origin: { authority: 'thinkgraph' }, relations: [] } }],
    } }] };
    render(<KnowledgeGraphProjectionSurface authority="thinkgraph" projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByRole('region', { name: 'Existing entry details' }).textContent).toContain('Saved Think.');
    expect(screen.getByText('Existing saved Think')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Expand$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use in chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('region', { name: 'Existing entry details' })).toBeNull();
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('region', { name: 'Existing entry details' }).textContent)
      .toContain('Saved Think.');
  });

  it('shows the two bounded complete Thinks in newest-first order', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Removal unavailable'));
    const paragraph = 'Rocket Lab launch cadence is a useful leading indicator only when the complete '
      + 'launch-services revenue attribution remains tied to completed customer missions across the '
      + 'four-quarter test; missing disclosure leaves the thesis unproven rather than contradicted.';
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry',
      properties: { evidence: [
        { id: 'memory-new', title: 'Neutron as discounted option value', summary: paragraph, ingestedAt: 300,
          metadata: { keywords: ['latest', 'decision'],
            thinkgraph_origin: { authority: 'thinkgraph' }, relations: [
            { source: 'Electron', relation: 'SUPPORTS', target: 'Execution quality' },
            { source: 'Neutron', relation: 'DEPENDS_ON', target: 'Launch cadence' },
            { source: 'Dilution', relation: 'AFFECTS', target: 'Neutron' },
          ] } },
        { id: 'memory-second', title: 'Second retained Think', summary: 'Second recent saved Think.', ingestedAt: 200,
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' }, relations: [] } },
      ] } }] };
    render(<KnowledgeGraphProjectionSurface authority="thinkgraph" projection={projection}
      status="ready" error={null} onRemoveEvidence={remove} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByText('Recent Thinks')).toBeTruthy();
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(paragraph.length).toBeGreaterThan(140);
    expect(screen.getByText('Second recent saved Think.')).toBeTruthy();
    expect(screen.getByText('Neutron as discounted option value')).toBeTruthy();
    expect(screen.getByText('Second retained Think')).toBeTruthy();
    expect(screen.getByText('Relationships')).toBeTruthy();
    expect(screen.getByText('Electron SUPPORTS Execution quality')).toBeTruthy();
    expect(screen.getByText('Neutron DEPENDS_ON Launch cadence')).toBeTruthy();
    expect(screen.getByText('Dilution AFFECTS Neutron')).toBeTruthy();
    for (const rejected of ['Importance', 'Confidence', 'Probability', 'Technical details']) {
      expect(screen.queryByText(rejected)).toBeNull();
    }
    expect(document.querySelector('time')?.getAttribute('datetime'))
      .toBe('1970-01-01T00:05:00.000Z');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete record' })[0]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Removal unavailable'));
    expect(remove).toHaveBeenCalledExactlyOnceWith('memory-new');
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(['stored']);
  });

  it('opens the exact selected relationship with its recorded claim and keeps diagnostics out of the inspector', () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'source', label: 'Source', mentionCount: 1, properties: { summary: 'The recorded source summary.' } },
        { id: 'claim', label: 'Claim', mentionCount: 1 },
      ],
      edges: [{ id: 'evidence', source: 'source', target: 'claim', predicate: 'SUPPORTS', mentionCount: 1,
        properties: { fact: 'This source supports this claim within the recorded scope.' } }],
    };
    render(<KnowGraphProjectionSurface projection={projection} error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.linkClick(graph.data.links[0]));
    const inspector = screen.getByTestId('knowgraph-edge-inspector');
    expect(inspector.getAttribute('data-provider-id')).toBe('evidence');
    expect(inspector.textContent).toContain('SUPPORTS');
    expect(inspector.textContent).toContain(projection.edges[0].properties.fact);
    expect(screen.queryByTestId('knowgraph-node-inspector')).toBeNull();
    for (const label of ['Identity', 'Controls', 'Graph stats', 'Technical details']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByPlaceholderText('Find entity…')).toBeNull();
  });

  it.each(['thinkgraph', 'knowgraph'] as const)(
    'shows the meaningful Jev winner, natural relation, and full distribution for %s without system fields',
    authority => {
    const distribution = {
      QUALIFIES: 0.76,
      SUPPORTS: 0.14,
      ASSOCIATED_WITH: 0.10,
    };
    const projection = {
      ...empty(authority),
      nodes: [
        { id: 'jev', label: 'Jev', mentionCount: 1 },
        { id: 'thinkgraph', label: 'ThinkGraph', mentionCount: 1 },
      ],
      edges: [{
        id: 'semantic-edge', source: 'jev', target: 'thinkgraph', predicate: 'QUALIFIES',
        properties: {
          directed: true,
          relationship_strength: 0.76,
          label_confidence: 0.76,
          jev: {
            winner: 'QUALIFIES', distribution,
            vocabulary_version: 'jev.semantic-relationships.v1',
            natural_relationship: 'provides probabilistic semantic classification for',
          },
        },
      }],
    };
    render(<KnowledgeGraphProjectionSurface authority={authority} projection={projection}
      status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.linkClick(graph.data.links[0]));

    expect(screen.getByText('Jev winner').nextSibling?.textContent).toBe('QUALIFIES');
    expect(screen.getByText('Probability').nextSibling?.textContent).toBe('76.0%');
    expect(screen.getByText('Natural extracted relationship').nextSibling?.textContent)
      .toBe('provides probabilistic semantic classification for');
    for (const implementationField of ['Edge ontology', 'Physics profile', 'Source graph', 'Provider ID', 'Record']) {
      expect(screen.queryByText(implementationField)).toBeNull();
    }
    const probabilityDetails = screen.getByText('Jev relationship probabilities')
      .parentElement as HTMLDetailsElement;
    expect(probabilityDetails.open).toBe(true);
    const probability = (choice: string) => Array.from(
      probabilityDetails.querySelectorAll('dt'),
    ).find(item => item.textContent === choice)?.nextElementSibling?.textContent;
    expect(probability('QUALIFIES')).toBe('76.0%');
    expect(probability('SUPPORTS')).toBe('14.0%');
    expect(probability('ASSOCIATED_WITH')).toBe('10.0%');
    const winner = Array.from(probabilityDetails.querySelectorAll('div'))
      .find(item => item.querySelector('dt')?.textContent === 'QUALIFIES')!;
    expect(winner.getAttribute('data-winner')).toBe('true');
    expect((winner.querySelector('.graph-jev-probability-fill') as HTMLElement).style.width)
      .toBe('76.0%');
    },
  );

  it('shows Know citations as direct clickable sources on the selected Entity', () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'company', label: 'Rocket Lab', mentionCount: 1, properties: { evidence: [{
          ...knowRecord(
            'episode-company',
            'Rocket Lab market Know',
            'Rocket Lab participates in the launch market.',
            'https://www.sec.gov/Archives/rocket-lab-10-k',
          ),
          interpretation: 'The filing reports participation without resolving long-term market share.',
          citation: {
            url: 'https://www.sec.gov/Archives/rocket-lab-10-k',
            title: 'SEC filing',
            publisher: 'SEC',
            evidence: 'The filing reports Rocket Lab participation in the launch market.',
          },
        }, {
          ...knowRecord(
            'episode-company-risk',
            'Rocket Lab risk Know',
            'Participation does not establish durable market power.',
            'https://investors.rocketlabcorp.com/risk-factors',
          ),
          citation: {
            url: 'https://investors.rocketlabcorp.com/risk-factors',
            title: 'Risk factors',
            publisher: 'Rocket Lab',
            evidence: 'The company describes material competitive risks.',
          },
        }] } },
        { id: 'market', label: 'Launch market', mentionCount: 1, properties: {} },
      ],
      edges: [{
        id: 'fact-visual', source: 'company', target: 'market', predicate: 'PARTICIPATES_IN',
        properties: {
          graphitiFactUuid: 'fact-provider',
          fact: 'Rocket Lab participates in the launch market.',
          supportingEpisodeUuids: ['article'],
        },
      }],
    };
    render(<KnowGraphProjectionSurface projection={projection} error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));

    expect(screen.getByTestId('knowledge-know-records').textContent)
      .toContain('Rocket Lab participates in the launch market.');
    expect(screen.getAllByRole('link', { name: /SEC filing/ }).some(link => (
      link.getAttribute('href') === 'https://www.sec.gov/Archives/rocket-lab-10-k'
    ))).toBe(true);
    expect(screen.getByText('Participation does not establish durable market power.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Risk factors/ }).some(link => (
      link.getAttribute('href') === 'https://investors.rocketlabcorp.com/risk-factors'
    ))).toBe(true);
    expect(screen.getByText('The filing reports participation without resolving long-term market share.'))
      .toBeTruthy();
    expect(screen.queryByRole('link', { name: 'example.org' })).toBeNull();
  });

  it('keeps paragraph Knows intact, limits the calm landing to two, and lists each supporting source', () => {
    const paragraph = 'Across the latest four reported quarters, Rocket Lab disclosed completed launch '
      + 'activity and total revenue growth, but the official releases did not provide mission-level '
      + 'launch-services revenue attribution sufficient to prove the proposed cadence thesis.';
    const firstUrl = 'https://investors.rocketlabcorp.com/news/third-quarter-2025-results';
    const secondUrl = 'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results';
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'company', label: 'Rocket Lab', properties: { evidence: [
          {
            ...knowRecord('episode-one', 'Know one', paragraph, firstUrl),
            citation: {
              url: firstUrl,
              title: 'Third quarter 2025 results',
              publisher: 'Rocket Lab',
              evidence: 'Exact third-quarter evidence.',
            },
            ingestedAt: '2026-10-03T12:03:00Z',
          },
          {
            ...knowRecord(
              'episode-two', 'Know two', 'Second complete current Know.', secondUrl,
            ),
            citation: {
              url: secondUrl,
              title: 'Fourth quarter 2025 results',
              publisher: 'Rocket Lab',
              evidence: 'Exact fourth-quarter evidence.',
            },
            ingestedAt: '2026-10-03T12:02:00Z',
          },
        ] } },
        { id: 'one', label: 'One', properties: {} },
        { id: 'two', label: 'Two', properties: {} },
      ],
      edges: [
        { id: 'edge-one', source: 'company', target: 'one', predicate: 'REPORTS', properties: {
          graphitiFactUuid: 'fact-one', fact: paragraph,
          createdAt: '2026-10-03T12:03:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
        { id: 'edge-two', source: 'company', target: 'two', predicate: 'REPORTS', properties: {
          graphitiFactUuid: 'fact-two', fact: 'Second complete current Know.',
          createdAt: '2026-10-03T12:02:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
      ],
    };
    render(<KnowGraphProjectionSurface projection={projection} error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes.find((node: any) => node.id === 'company')));

    expect(paragraph.length).toBeGreaterThan(140);
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(screen.getByText('Second complete current Know.')).toBeTruthy();
    expect(screen.queryByText(/Research package/)).toBeNull();
    const sourceList = screen.getByRole('heading', { name: 'Sources' }).parentElement!;
    const sourceHrefs = Array.from(sourceList.querySelectorAll('a')).map(link => link.getAttribute('href'));
    expect(sourceHrefs).toEqual([
      'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
      'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results',
    ]);
    expect(sourceList.textContent).toContain('Third quarter 2025 results');
    expect(sourceList.textContent).toContain('Fourth quarter 2025 results');
    expect(sourceList.textContent).toContain('Rocket Lab');
  });

  it.each(['thinkgraph', 'knowgraph'] as const)('opens a compact movable %s inspector and preserves graph settings without exposing record plumbing', async authority => {
    const panelStyles = vi.spyOn(graphVisualTokens, 'graphInspectorPanelStyle');
    const key = `liquidaity.drawer.${authority}.width`;
    window.localStorage.setItem(key, '390');
    const projection = authority === 'thinkgraph'
      ? { ...empty(authority), nodes: [{ id: 'provider-1', label: 'Recorded subject',
        createdAt: '2026-09-01',
        properties: { evidence: [{
          id: 'memory-one', ingestedAt: 100, summary: 'The complete Think summary.',
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
        }] } }] }
      : { ...empty(authority), nodes: [
        { id: 'provider-1', label: 'Recorded subject',
          properties: { evidence: [{
            ...knowRecord(
              'episode-one', 'Recorded Know', 'The complete original statement.',
              'https://example.test/support',
            ),
          }] } },
        { id: 'provider-target', label: 'Recorded target' },
      ], edges: [{
        id: 'fact-one', source: 'provider-1', target: 'provider-target', predicate: 'SUPPORTS',
        properties: { graphitiFactUuid: 'fact-one',
          fact: 'The complete original statement.', supportingEpisodeUuids: ['episode-one'] },
      }] };
    const { container } = render(<KnowledgeGraphProjectionSurface authority={authority} projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    act(() => graph.nodeClick(graph.data.nodes[0]));
    const panel = screen.getByRole('complementary');
    expect(panel.style.width).toBe('340px');
    expect(screen.getByLabelText('Move panel').textContent).toContain('Recorded subject');
    expect(container.querySelector('[data-testid$="-node-inspector"]')).toBe(document.activeElement);
    expect(panel.textContent).toContain(authority === 'thinkgraph'
      ? 'The complete Think summary.'
      : 'The complete original statement.');
    for (const implementationValue of ['provider-1', 'provider-0']) {
      expect(panel.textContent).not.toContain(implementationValue);
    }
    expect(screen.queryByText('Record')).toBeNull();
    fireEvent.mouseDown(screen.getByLabelText('Resize drawer'), { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 490 });
    fireEvent.mouseUp(window);
    expect(panel.style.width).toBe('350px');
    expect(window.localStorage.getItem(key)).toBe('390');
    expect(screen.queryByRole('button', { name: 'Detach panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dock panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close drawer' })).toBeTruthy();
    vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {},
    });
    fireEvent.mouseDown(screen.getByLabelText('Move panel'), { clientX: 900, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 180 });
    fireEvent.mouseUp(window);
    expect(panelStyles).toHaveBeenLastCalledWith(expect.objectContaining({ right: 'auto' }));
    expect((screen.getByLabelText('Move panel') as HTMLElement).style.cursor).toBe('move');
    fireEvent.mouseDown(screen.getByLabelText('Resize floating panel'), { clientX: 1000, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 1080, clientY: 560 });
    fireEvent.mouseUp(window);
    expect(panel.style.height).not.toBe('auto');
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('complementary').style.width).toBe('340px');
    expect(screen.getByLabelText('Move panel').textContent).toContain('Recorded subject');
    expect(screen.queryByRole('slider', { name: 'Node size' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    act(() => graph.backgroundClick());
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.queryByRole('slider', { name: 'Node size' })).toBeNull();
    expect(screen.getByRole('complementary').style.width).toBe('340px');
    expect(screen.queryByRole('combobox', { name: 'Style' })).toBeNull();
    expect(graph.data.nodes[0].material_kind).toBe('solarpunk');
    expect(screen.queryByRole('group', { name: 'Solarpunk colors' })).toBeNull();
    expect(graph.setStyle).toHaveBeenLastCalledWith('cyber');
    expect(container.querySelector('.thinkgraph-entry')).toBeNull();
    expect(graph.setPreset).toHaveBeenCalledTimes(1);
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    expect(graph.setStyle).toHaveBeenCalledWith('cyber');
    expect(graph.fit).not.toHaveBeenCalled();
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(
      authority === 'thinkgraph' ? ['provider-1'] : ['provider-1', 'provider-target'],
    );
    act(() => graph.nodeClick(graph.data.nodes[0]));
    act(() => graph.backgroundClick());
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.queryByRole('combobox', { name: 'Layout' })).toBeNull();
    expect(screen.getByRole('complementary').style.width).toBe('340px');
  });
});
