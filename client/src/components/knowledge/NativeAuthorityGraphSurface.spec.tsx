// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../vendor/codebase-memory-ui/src/components/GraphTab', () => ({
  GraphTab: ({ project, attentionData }: { project: string | null; attentionData?: { nodes: unknown[] } }) => <div data-testid="cbm-graph-tab">{project}:{attentionData?.nodes.length ?? 'native'}</div>,
}));

const forceGraphMocks = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('force-graph', () => ({ default: function ForceGraphMock() {
  const instance: any = {
    data: { nodes: [], links: [] },
    backgroundColor() { return this; }, cooldownTime() { return this; }, warmupTicks() { return this; },
    nodeRelSize() { return this; }, autoPauseRedraw() { return this; }, onNodeClick(handler: unknown) { this.nodeClick = handler; return this; },
    onLinkClick(handler: unknown) { this.linkClick = handler; return this; },
    onNodeHover() { return this; }, nodeCanvasObject() { return this; }, nodePointerAreaPaint() { return this; },
    linkColor() { return this; }, linkWidth() { return this; }, linkDirectionalArrowLength() { return this; },
    linkDirectionalArrowRelPos() { return this; }, linkCanvasObjectMode() { return this; }, linkCanvasObject() { return this; },
    onRenderFramePost() { return this; }, d3Force() { return { strength: () => undefined, distance: () => undefined }; },
    graphData(value?: unknown) { if (value === undefined) return this.data; this.data = value; return this; },
    d3ReheatSimulation: vi.fn(function (this: any) { return this; }), refresh: vi.fn(function (this: any) { return this; }),
    width() { return this; }, height() { return this; }, zoomToFit() { return this; }, _destructor() {},
  };
  forceGraphMocks.instances.push(instance);
  return instance;
} }));

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
  forceGraphMocks.instances.length = 0;
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

  it('starts KnowGraph empty without loading the complete Neo4j graph', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<NativeKnowGraphSurface projection={empty('knowgraph')} error={null} onExpand={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('native-knowgraph-surface')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open KnowGraph Inspector' })).toBeTruthy();
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

  it('reuses surviving node objects and reheats only when topology grows', async () => {
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
    expect(survivingNode.attentionActorColor).toBe('#37ADAA');
    act(() => graph.nodeClick(survivingNode));
    expect(screen.getByTestId('knowgraph-node-inspector').getAttribute('data-native-id')).toBe('mem-one');
    expect(survivingNode.attentionActorCardId).toBe('card_main_chat');
    survivingNode.x = 42;
    const initialReheats = graph.d3ReheatSimulation.mock.calls.length;

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
    await waitFor(() => expect(graph.refresh).toHaveBeenCalled());
    expect(graph.data.nodes[0]).toBe(survivingNode);
    expect(graph.data.nodes[0].x).toBe(42);
    expect(graph.d3ReheatSimulation).toHaveBeenCalledTimes(initialReheats);

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
    expect(graph.data.nodes[0]).toBe(survivingNode);
    expect(graph.data.nodes[0].x).toBe(42);
    expect(graph.d3ReheatSimulation).toHaveBeenCalledTimes(initialReheats + 1);
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
    act(() => graph.linkClick(graph.data.links[0]));
    const inspector = screen.getByTestId('knowgraph-edge-inspector');
    expect(inspector.getAttribute('data-native-id')).toBe('evidence');
    expect(inspector.textContent).toContain('SUPPORTS');
    expect(inspector.textContent).toContain(projection.edges[0].properties.fact);
    expect(screen.queryByTestId('knowgraph-node-inspector')).toBeNull();
    for (const label of ['Identity', 'Controls', 'Graph stats', 'Technical details', 'Reheat']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByPlaceholderText('Find entity…')).toBeNull();
  });

  it('follows native episode references to citations without treating unrelated sources as evidence', () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'company', label: 'Rocket Lab', mentionCount: 1, properties: { summary: 'Launch provider.' } },
        { id: 'mission', label: 'CAPSTONE', mentionCount: 1 },
        { id: 'article', label: 'NASA launch report', type: 'Episodic', mentionCount: 1, properties: { content: JSON.stringify({ source_url: 'https://www.nasa.gov/mission', publisher: 'NASA', summary: 'The launch report.' }) } },
        { id: 'unrelated', label: 'Unrelated source', type: 'Episodic', mentionCount: 1, properties: { source_url: 'https://example.org/unrelated' } },
      ],
      edges: [{ id: 'launch', source: 'company', target: 'mission', predicate: 'PROVIDED_LAUNCH_FOR', mentionCount: 1, properties: { episodes: ['article'], fact: 'Rocket Lab launched CAPSTONE.' } }],
    };
    render(<NativeKnowGraphSurface projection={projection} error={null} onExpand={vi.fn()} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByRole('link', { name: 'NASA' }).getAttribute('href')).toBe('https://www.nasa.gov/mission');
    expect(screen.queryByRole('link', { name: 'example.org' })).toBeNull();
    act(() => screen.getByRole('button', { name: 'Rocket Lab provided launch for CAPSTONE' }).click());
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('Rocket Lab launched CAPSTONE.');
    expect(screen.getByRole('link', { name: 'NASA' })).toBeTruthy();
    act(() => graph.nodeClick(graph.data.nodes[2]));
    expect(screen.getByTestId('knowgraph-node-inspector').textContent).toContain('The launch report.');
  });
});
