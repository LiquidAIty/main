// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as graphVisualTokens from '../graph/graphVisualTokens';

vi.mock('../../vendor/codebase-memory-ui/src/components/GraphTab', () => ({
  GraphTab: ({ project, attentionData }: { project: string | null; attentionData?: { nodes: unknown[] } }) => <div data-testid="cbm-graph-tab">{project}:{attentionData?.nodes.length ?? 'native'}</div>,
}));

const forceGraphMocks = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('../../vendor/engraphis/vendor/d3.min.js', () => ({}));
vi.mock('../../vendor/engraphis/vendor/force-graph.min.js', () => ({}));
vi.mock('../../vendor/engraphis/engraphis-graph.js', () => {
  window.EngraphisGraph = { create(host, options) {
    expect(Object.keys(options).sort()).toEqual(['onBackgroundClick', 'onNodeClick']);
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const instance: any = {
      data: { nodes: [], links: [] }, nodeClick: options.onNodeClick, backgroundClick: options.onBackgroundClick,
      setData: vi.fn(function (this: any, data: any) {
        this.data = { ...data, nodes: data.nodes.map((node: any) => ({ ...node })), links: data.links || data.edges || [] };
      }),
      setHighlight: vi.fn(), graphToScreen: (x: number, y: number) => ({ x, y }),
      setPreset: vi.fn(() => ({ size: 3, font: 13, linkw: 1, labelDensity: 40, repel: 120, link: 30, gravity: 14 })), setStyle: vi.fn(), setSettings: vi.fn(),
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
  NativeCodeGraphSurface,
  NativeGraphProjectionSurface,
  NativeKnowGraphSurface,
} from './NativeAuthorityGraphSurface';
import KnowledgeGraphFramework from './KnowledgeGraphFramework';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forceGraphMocks.instances.length = 0;
  window.localStorage.clear();
});

describe('native authority graph surfaces', () => {
  const empty = (authority: 'thinkgraph' | 'knowgraph' | 'codegraph') => ({
    schemaVersion: `${authority}.attention.projection.v1`,
    authority,
    projectId: 'project-1',
    nodes: [],
    edges: [],
  });

  it('passes the bounded native projection to the embedded CBM GraphTab', async () => {
    render(<Suspense fallback={null}><NativeCodeGraphSurface project="C-Projects-main" projection={empty('codegraph')} onExpand={vi.fn()} /></Suspense>);
    await waitFor(() => expect(screen.getByTestId('cbm-graph-tab').textContent).toBe('C-Projects-main:0'));
  });

  it.each(['knowgraph'] as const)('uses the selected Engraphis preset for %s with zoom and shared paper', (authority) => {
    const { container } = render(<NativeGraphProjectionSurface authority={authority}
      projection={empty(authority)} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(container.querySelector('[data-renderer="engraphis-1.7.1"]')).toBeTruthy();
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    expect(graph.setStyle).toHaveBeenCalledWith('classic');
    expect(graph.setSettings).toHaveBeenCalledWith({ labels: true });
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
    expect(screen.getByRole('combobox', { name: 'Layout' }).getAttribute('aria-label')).toBe('Layout');
    expect(graph.setCollapse).toHaveBeenCalledWith(false);
    for (const value of ['original', 'communities', 'radial', 'galaxy', 'compact']) {
      fireEvent.change(screen.getByRole('combobox', { name: 'Layout' }), { target: { value } });
      expect(graph.setPreset).toHaveBeenLastCalledWith(value);
      expect(graph.data.nodes).toEqual([]);
    }
    expect(screen.queryByRole('button', { name: /Freeze|Resume|Reheat|Focus/ })).toBeNull();
    expect(graph.freeze).not.toHaveBeenCalled();
    expect(graph.reheat).not.toHaveBeenCalled();
  });

  it.each(['thinkgraph', 'knowgraph'] as const)(
    'switches %s physics profiles locally without mutating graph data or calling Jev',
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
              winner: 'PROVIDES',
              distribution: { PROVIDES: 0.8, ASSOCIATED_WITH: 0.2 },
            },
          },
        }],
      };
      const original = structuredClone(projection);
      const { container } = render(<NativeGraphProjectionSurface authority={authority}
        projection={projection} status="ready" error={null} />);
      const graph = forceGraphMocks.instances.at(-1);
      expect(graph.data.links[0]).toMatchObject({
        relationship_strength: 0.8,
        visual_width: 2.25,
        spring_strength: 0.171,
        rest_length: 16.4,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
      expect((screen.getByRole('combobox', { name: 'Physics profile' }) as HTMLSelectElement).value)
        .toBe('balanced');
      fireEvent.change(screen.getByRole('combobox', { name: 'Physics profile' }), {
        target: { value: 'open' },
      });
      expect(container.querySelector(`[data-physics-profile="open"]`)).toBeTruthy();
      expect(graph.data.links[0]).toMatchObject({
        relationship_strength: 0.8,
        spring_strength: 0.121,
        rest_length: 24.4,
      });
      expect(graph.data.links[0].visual_width).toBeCloseTo(1.8);
      act(() => graph.nodeClick(graph.data.nodes[1]));
      for (const implementationField of ['Semantic mass', 'Physics profile', 'Source graph', 'Native ID']) {
        expect(screen.queryByText(implementationField)).toBeNull();
      }
      expect(projection).toEqual(original);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('passes the complete Engraphis scene unchanged, including layout metadata', () => {
    const scene = {
      nodes: [{ id: 'jev', label: 'Jev', semantic_mass: 0.82, gravity_mass: 9.4, visual_radius: 7.2 }],
      edges: [{
        id: 'semantic-edge', source: 'jev', target: 'thinkgraph', predicate: 'QUALIFIES', relation: 'QUALIFIES',
        relationship_strength: 0.82, label_confidence: 0.71,
        spring_strength: 0.1744, rest_length: 16.16,
      }],
      communities: [], meta: { layout_seed: 7 },
    };
    render(<NativeGraphProjectionSurface authority="knowgraph"
      projection={{ ...empty('thinkgraph'), scene }} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.setData.mock.calls[0][0]).toBe(scene);
    expect(graph.data.nodes[0]).toMatchObject({
      semantic_mass: 0.82, gravity_mass: 9.4, visual_radius: 7.2,
    });
    expect(graph.data.links[0]).toMatchObject({
      relation: 'QUALIFIES', relationship_strength: 0.82,
      spring_strength: 0.1744, rest_length: 16.16,
    });
  });

  it('starts KnowGraph empty without loading the complete Neo4j graph', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<NativeKnowGraphSurface projection={empty('knowgraph')} error={null} onExpand={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('native-knowgraph-surface')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open graph settings' })).toBeTruthy();
    expect(screen.getByText('No knowledge yet.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders native entries without hiding isolated nodes or inventing connections', async () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [{ id: 'entity-one', label: 'Existing entity', mentionCount: 1 }],
    };
    render(<NativeKnowGraphSurface projection={projection} error={null} onExpand={vi.fn()} />);
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes.map((node: { id: string }) => node.id)).toEqual(['entity-one']));
    expect(graph.data.links).toEqual([]);
    expect(screen.queryByRole('checkbox', { name: 'Hide unconnected entities' })).toBeNull();
    expect(projection.nodes).toEqual([{ id: 'entity-one', label: 'Existing entity', mentionCount: 1 }]);
    expect(projection.edges).toEqual([]);
  });

  it('loads native records into the replacement renderer after Strict Mode effect replay', () => {
    const projection = { ...empty('knowgraph'), nodes: [{ id: 'source', label: 'W3C', mentionCount: 1 }] };
    render(<StrictMode><NativeKnowGraphSurface projection={projection} error={null} onExpand={vi.fn()} /></StrictMode>);
    expect(forceGraphMocks.instances).toHaveLength(2);
    expect(forceGraphMocks.instances.at(-1).data.nodes.map((node: { id: string }) => node.id)).toEqual(['source']);
  });

  it('shows the exact CodeGraph project-resolution failure instead of mounting an arbitrary index', () => {
    const { container } = render(
      <KnowledgeGraphFramework
        codeGraphProjectName={null}
        codeGraphProjectError="CBM project identity is ambiguous: C-Projects-main-a, C-Projects-main-b"
        kind="codegraph"
        attentionProjections={{
          thinkgraph: empty('thinkgraph'),
          knowgraph: empty('knowgraph'),
          codegraph: empty('codegraph'),
        }}
        attentionErrors={{}}
        onExpandAttentionNode={vi.fn()}
        onUseAttentionNode={vi.fn()}
        onKindChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'C-Projects-main-a, C-Projects-main-b',
    );
    expect(container.querySelector('[data-testid="cbm-graph-tab"]')).toBeNull();
  });

  it('preserves selection and supplied records across activity refreshes', async () => {
    const first = {
      schemaVersion: 'knowgraph.attention.projection.v1',
      authority: 'knowgraph',
      projectId: 'project-1',
      nodes: [{
        id: 'mem-one',
        label: 'build',
        mentionCount: 1,
        currentState: 'active',
        properties: { attentionActive: true, attentionActorColor: '#37ADAA', attentionActorCardId: 'card_main_chat' },
      }],
      edges: [],
    };
    const { rerender } = render(
      <NativeGraphProjectionSurface
        projection={first}
        status="ready"
        error={null}
      />,
    );
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes).toHaveLength(1));
    const survivingNode = graph.data.nodes[0];
    expect(survivingNode.properties.attentionActorColor).toBe('#37ADAA');
    act(() => graph.nodeClick(survivingNode));
    expect(screen.getByTestId('knowgraph-node-inspector').getAttribute('data-native-id')).toBe('mem-one');
    expect(survivingNode.properties.attentionActorCardId).toBe('card_main_chat');

    rerender(
      <NativeGraphProjectionSurface
        projection={{
          ...first,
          nodes: [{ ...first.nodes[0], currentState: 'settled', properties: { ...first.nodes[0].properties, state: 'settled' } }],
        }}
        status="ready"
        error={null}
      />,
    );
    await waitFor(() => expect(graph.data.nodes).toHaveLength(1));
    expect(graph.data.nodes[0].id).toBe(survivingNode.id);
    expect(graph.data.nodes[0].currentState).toBe('settled');
    expect(screen.getByTestId('knowgraph-node-inspector').getAttribute('data-native-id')).toBe('mem-one');

    rerender(
      <NativeGraphProjectionSurface
        projection={{
          ...first,
          nodes: [
            first.nodes[0],
            {
              ...first.nodes[0],
              id: 'mem-two',
              label: 'tests',
              properties: { attentionActive: true, attentionActorColor: '#37ADAA', attentionActorCardId: 'card_main_chat' },
            },
          ],
          edges: [{
            id: 'memory-edge',
            source: 'mem-one',
            target: 'mem-two',
            predicate: 'related',
            mentionCount: 1,
            properties: { attentionActorColor: '#37ADAA', attentionActorCardId: 'card_main_chat' },
          }],
        }}
        status="ready"
        error={null}
      />,
    );
    await waitFor(() => expect(graph.data.nodes).toHaveLength(2));
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(['mem-one', 'mem-two']);
    expect(screen.getByTestId('knowgraph-node-inspector').getAttribute('data-native-id')).toBe('mem-one');
    expect(graph.data.links[0].properties.attentionActorColor).toBe('#37ADAA');
    expect(graph.data.links.map((link: any) => [link.id, link.source, link.target, link.relation]))
      .toEqual([['memory-edge', 'mem-one', 'mem-two', 'related']]);
  });

  it('attaches only the exact selected native node to Main', async () => {
    const onUseAsContext = vi.fn();
    const projection = {
      ...empty('knowgraph'),
      nodes: [{
        id: 'mem-one', canonicalId: 'mem-one', label: 'Decision', mentionCount: 1,
        properties: {},
      }],
    };
    render(
      <NativeGraphProjectionSurface
        projection={projection}
        status="ready"
        error={null}
        onUseAsContext={onUseAsContext}
      />,
    );
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes).toHaveLength(1));
    act(() => graph.nodeClick(graph.data.nodes[0]));
    screen.getByRole('button', { name: 'Use in chat' }).click();
    expect(onUseAsContext).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mem-one', canonicalId: 'mem-one',
    }));
  });

  it('passes the Jev winner and probability as the ThinkGraph line label without changing endpoints or evidence', () => {
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
    render(<NativeGraphProjectionSurface authority="thinkgraph" projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.links).toHaveLength(1);
    expect(graph.data.links[0]).toMatchObject({
      ...projection.edges[0], relation: 'DEPENDS_ON', label: 'DEPENDS_ON · .71',
      label_min_scale: 0.35, directional_arrow_length: 3, directional_arrow_rel_pos: 0.9,
    });
    expect(graph.data.nodes.map((node: any) => [node.id, node.label])).toEqual([['subject', 'Subject'], ['idea', 'Idea']]);
    expect(JSON.stringify(projection)).toBe(before);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Subject DEPENDS_ON Idea' }));
    expect(screen.getByTestId('thinkgraph-edge-inspector').textContent).toContain('Recorded relationship.');
  });

  it('renders ThinkGraph in the existing canvas and binds the pull tab to Engraphis settings', async () => {
    const { container } = render(<KnowledgeGraphFramework codeGraphProjectName={null} codeGraphProjectError={null}
      kind="thinkgraph" attentionProjections={{ thinkgraph: empty('thinkgraph'), knowgraph: empty('knowgraph'), codegraph: empty('codegraph') }}
      attentionErrors={{}} onKindChange={vi.fn()} onExpandAttentionNode={vi.fn()} onUseAttentionNode={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('native-thinkgraph-surface')).toBeTruthy());
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('No knowledge yet.')).toBeTruthy();
    await waitFor(() => expect(forceGraphMocks.instances.at(-1)?.data.nodes).toEqual([]));
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.nodes).toEqual([]);
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Node size' }), { target: { value: '7' } });
    expect(graph.setSettings).toHaveBeenLastCalledWith({ size: 7 });
    expect(graph.data.nodes).toEqual([]);
    expect(graph.data.links).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to preset defaults' }));
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('3');
    expect(screen.queryByRole('button', { name: /^Freeze$/ })).toBeNull();
  });

  it('opens only the selected ThinkGraph entry and keeps graph settings separate', () => {
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry', properties: {
      evidence: [{ id: 'memory-one', ingestedAt: 100, metadata: { thinkgraph_note: {
        kind: 'OBSERVATION', summary: 'Saved Thought.', propositions: [], relationship_observations: [],
      } } }],
    } }] };
    render(<NativeGraphProjectionSurface authority="thinkgraph" projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByRole('region', { name: 'Existing entry details' }).textContent).toContain('Saved Thought.');
    expect(screen.queryByRole('button', { name: /^Expand$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use in chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('region', { name: 'Existing entry details' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Text size' })).toBeTruthy();
  });

  it('shows the complete latest direct Thought and keeps older direct Thoughts in newest-first history', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Removal unavailable'));
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry',
      properties: { evidence: [
        { id: 'memory-new', summary: 'Latest saved Thought.', ingestedAt: 200,
          metadata: { thinkgraph_note: {
            kind: 'DECISION', summary: 'Latest saved Thought.', importance: 0.91,
            keywords: ['latest', 'decision'], concepts: ['Current thesis'],
            properties: [{ name: 'time_horizon', value: 'one year' }],
            propositions: ['The current thesis depends on execution.'],
            relationship_observations: ['Rocket Lab DEPENDS_ON Neutron'],
          } } },
        { id: 'memory-old', summary: 'Older saved Thought.', ingestedAt: 100,
          metadata: { thinkgraph_note: {
            kind: 'OBSERVATION', summary: 'Older saved Thought.', propositions: [],
            relationship_observations: [],
          } } },
      ] } }] };
    render(<NativeGraphProjectionSurface authority="thinkgraph" projection={projection}
      status="ready" error={null} onRemoveEvidence={remove} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByText('Latest Thought')).toBeTruthy();
    expect(screen.getByText('Latest saved Thought.')).toBeTruthy();
    expect(screen.getByText('DECISION')).toBeTruthy();
    expect(screen.getByText('The current thesis depends on execution.')).toBeTruthy();
    expect(screen.getByText('Rocket Lab DEPENDS_ON Neutron')).toBeTruthy();
    expect(screen.getByText('time_horizon').nextSibling?.textContent).toBe('one year');
    const older = screen.getByText('Older Thoughts (1)').parentElement as HTMLDetailsElement;
    expect(older.open).toBe(false);
    expect(older.textContent).toContain('Older saved Thought.');
    fireEvent.click(screen.getByText('Older Thoughts (1)'));
    expect(older.open).toBe(true);
    expect(screen.getByText('Older saved Thought.')).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime'))
      .toBe('1970-01-01T00:03:20.000Z');
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Removal unavailable'));
    expect(remove).toHaveBeenCalledExactlyOnceWith('memory-new');
    expect(screen.getByText('Latest saved Thought.')).toBeTruthy();
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
    render(<NativeKnowGraphSurface projection={projection} error={null} onExpand={vi.fn()} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByTestId('knowgraph-node-inspector').textContent).toContain('The recorded source summary.');
    fireEvent.click(screen.getByRole('button', { name: 'Source SUPPORTS Claim' }));
    const inspector = screen.getByTestId('knowgraph-edge-inspector');
    expect(inspector.getAttribute('data-native-id')).toBe('evidence');
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
      NONE: 0.14,
      INSUFFICIENT_CONTEXT: 0.10,
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
    render(<NativeGraphProjectionSurface authority={authority} projection={projection}
      status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Jev QUALIFIES ThinkGraph' }));

    expect(screen.getByText('Jev winner').nextSibling?.textContent).toBe('QUALIFIES');
    expect(screen.getByText('Probability').nextSibling?.textContent).toBe('76.0%');
    expect(screen.getByText('Natural extracted relationship').nextSibling?.textContent)
      .toBe('provides probabilistic semantic classification for');
    for (const implementationField of ['Edge ontology', 'Physics profile', 'Source graph', 'Native ID', 'Record']) {
      expect(screen.queryByText(implementationField)).toBeNull();
    }
    const probabilityDetails = screen.getByText('Jev relationship probabilities')
      .parentElement as HTMLDetailsElement;
    expect(probabilityDetails.open).toBe(true);
    const probability = (choice: string) => Array.from(
      probabilityDetails.querySelectorAll('dt'),
    ).find(item => item.textContent === choice)?.nextElementSibling?.textContent;
    expect(probability('QUALIFIES')).toBe('76.0%');
    expect(probability('NONE')).toBe('14.0%');
    expect(probability('INSUFFICIENT_CONTEXT')).toBe('10.0%');
    const winner = Array.from(probabilityDetails.querySelectorAll('div'))
      .find(item => item.querySelector('dt')?.textContent === 'QUALIFIES')!;
    expect(winner.getAttribute('data-winner')).toBe('true');
    expect((winner.querySelector('.graph-jev-probability-fill') as HTMLElement).style.width)
      .toBe('76.0%');
    },
  );

  it('follows native episode references to citations without treating unrelated sources as evidence', () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'company', label: 'Rocket Lab', mentionCount: 1, properties: { summary: 'Launch provider.' } },
        { id: 'mission', label: 'CAPSTONE', mentionCount: 1 },
        { id: 'article', label: 'NASA launch report', type: 'Episodic', mentionCount: 1, properties: { content: JSON.stringify({ source_url: 'https://www.nasa.gov/mission', publisher: 'NASA', summary: 'The launch report.' }) } },
        { id: 'unrelated', label: 'Unrelated source', type: 'Episodic', mentionCount: 1, properties: { source_url: 'https://example.org/unrelated' } },
      ],
      edges: [{ id: 'launch', source: 'company', target: 'mission', predicate: 'PROVIDES', mentionCount: 1, properties: {
        portableKind: 'know', nativeFactUuid: 'launch', supportingEpisodeUuids: ['article'],
        temporalStatus: 'current', createdAt: '2026-09-23T12:00:00Z',
        validAt: '2022-06-28T00:00:00Z', fact: 'Rocket Lab launched CAPSTONE.',
        nativeRelation: 'provided launch services for',
        jev: { status: 'success', winner: 'PROVIDES', distribution: { PROVIDES: 0.9, ASSOCIATED_WITH: 0.1 } },
      } }],
    };
    render(<NativeKnowGraphSurface projection={projection} error={null} onExpand={vi.fn()} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    fireEvent.click(screen.getByText('NASA launch report'));
    expect(screen.getByRole('link', { name: 'NASA' }).getAttribute('href')).toBe('https://www.nasa.gov/mission');
    expect(screen.queryByRole('link', { name: 'example.org' })).toBeNull();
    act(() => screen.getByRole('button', { name: 'Rocket Lab PROVIDES CAPSTONE' }).click());
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('Rocket Lab launched CAPSTONE.');
    expect(screen.getByTestId('portable-know').textContent).toContain('Current Know');
    expect(screen.getByTestId('portable-know').textContent).toContain('2022-06-28');
    expect(screen.getByTestId('portable-know').textContent).toContain('provided launch services for');
    expect(screen.getByTestId('portable-know').textContent).toContain('PROVIDES');
    expect(screen.getByText('Jev relationship probabilities')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'NASA' })).toBeTruthy();
    act(() => graph.nodeClick(graph.data.nodes[2]));
    expect(screen.getByTestId('knowgraph-node-inspector').textContent).toContain('The launch report.');
  });

  it.each(['thinkgraph', 'knowgraph'] as const)('preserves %s inspector width, keyboard access and graph settings without exposing record plumbing', authority => {
    const panelStyles = vi.spyOn(graphVisualTokens, 'graphInspectorPanelStyle');
    const key = `liquidaity.drawer.${authority}.width`;
    window.localStorage.setItem(key, '390');
    const projection = { ...empty(authority), nodes: [{ id: 'native-1', label: 'Recorded subject',
      runId: 'run-1', conversationId: 'chat-1', createdAt: '2026-09-01',
      properties: authority === 'thinkgraph' ? { evidence: [{
        id: 'memory-one', ingestedAt: 100, metadata: { thinkgraph_note: {
          kind: 'OBSERVATION', summary: 'The complete Thought summary.',
          propositions: [], relationship_observations: [],
        } },
      }] } : { statement: 'The complete original statement.', certainty: 0.4, supersedes: 'native-0' },
      provenance: { author: 'Research Agent', correction: 'Source corrected its estimate.' } }] };
    const { container } = render(<NativeGraphProjectionSurface authority={authority} projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Node size' }), { target: { value: '5' } });
    act(() => graph.nodeClick(graph.data.nodes[0]));
    const panel = screen.getByRole('complementary');
    expect(panel.style.width).toBe('390px');
    expect(screen.getByRole('heading', { name: 'Recorded subject' })).toBe(document.activeElement);
    expect(panel.textContent).toContain(authority === 'thinkgraph'
      ? 'The complete Thought summary.'
      : 'The complete original statement.');
    for (const implementationValue of ['native-1', 'run-1', 'chat-1', 'Research Agent', 'native-0']) {
      expect(panel.textContent).not.toContain(implementationValue);
    }
    expect(screen.queryByText('Record')).toBeNull();
    fireEvent.mouseDown(screen.getByLabelText('Resize drawer'), { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 490 });
    fireEvent.mouseUp(window);
    expect(panel.style.width).toBe('400px');
    expect(window.localStorage.getItem(key)).toBe('400');
    fireEvent.click(screen.getByRole('button', { name: 'Detach panel' }));
    expect(screen.getByRole('button', { name: 'Dock panel' })).toBeTruthy();
    vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {},
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dock panel' }));
    // This jsdom version ignores assigning CSS left:auto over a pixel value.
    // Check the real material helper's input; browser layout is separate proof.
    expect(panelStyles).toHaveBeenLastCalledWith(expect.objectContaining({ left: 'auto', right: 12 }));
    expect(panel.style.right).toBe('12px');
    expect(screen.getByRole('button', { name: 'Detach panel' })).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.getByRole('combobox', { name: 'Physics profile' })).toBe(document.activeElement);
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('complementary').style.width).toBe('400px');
    expect(container.querySelector('.thinkgraph-entry')).toBeNull();
    expect(graph.setPreset).toHaveBeenCalledTimes(1);
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    expect(graph.setStyle).toHaveBeenCalledWith('classic');
    expect(graph.fit).not.toHaveBeenCalled();
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(['native-1']);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    act(() => graph.backgroundClick());
    expect(screen.getByRole('combobox', { name: 'Layout' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.getByRole('complementary').getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('complementary').style.width).toBe('400px');
  });
});
