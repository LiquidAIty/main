// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
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

  it('passes the bounded native projection to the embedded CBM GraphTab', () => {
    render(<NativeCodeGraphSurface project="C-Projects-main" projection={empty('codegraph')} onExpand={vi.fn()} />);
    expect(screen.getByTestId('cbm-graph-tab').textContent).toBe('C-Projects-main:0');
  });

  it('starts KnowGraph empty without loading the complete Neo4j graph', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<NativeKnowGraphSurface projection={empty('knowgraph')} error={null} onExpand={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('native-knowgraph-surface')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open KnowGraph Inspector' })).toBeTruthy();
    expect(screen.getByText('No KnowGraph data viewed in this attention scope yet.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
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
      schemaVersion: 'thinkgraph.attention.projection.v1',
      authority: 'thinkgraph',
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
    expect(screen.getByTestId('thinkgraph-node-inspector').textContent).toContain('mem-one');
    expect(screen.getByText('card_main_chat')).toBeTruthy();
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
});
