// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../vendor/codebase-memory-ui/src/components/GraphTab', () => ({
  GraphTab: ({ project }: { project: string | null }) => <div data-testid="cbm-graph-tab">{project}</div>,
}));

const forceGraphMocks = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('force-graph', () => ({ default: function ForceGraphMock() {
  const instance: any = {
    data: { nodes: [], links: [] },
    backgroundColor() { return this; }, cooldownTime() { return this; }, warmupTicks() { return this; },
    nodeRelSize() { return this; }, autoPauseRedraw() { return this; }, onNodeClick() { return this; },
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
  it('mounts the real CBM GraphTab with the resolved repository identity', () => {
    render(<NativeCodeGraphSurface project="C-Projects-main" />);
    expect(screen.getByTestId('cbm-graph-tab').textContent).toBe('C-Projects-main');
  });

  it('loads the native Graphiti projection for KnowGraph without the removed analysis API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], relationships: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NativeKnowGraphSurface projectId="project-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowgraph/graph?projectId=project-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await waitFor(() => expect(screen.getByTestId('native-knowgraph-surface')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open KnowGraph Inspector' })).toBeTruthy();

    window.dispatchEvent(new Event('knowledge:refresh'));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('knowgraph:refresh'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('shows the exact CodeGraph project-resolution failure instead of mounting an arbitrary index', () => {
    const { container } = render(
      <KnowledgeGraphFramework
        projectId="p"
        codeGraphProjectName={null}
        codeGraphProjectError="CBM project identity is ambiguous: C-Projects-main-a, C-Projects-main-b"
        kind="codegraph"
        thinkGraphProjection={null}
        thinkGraphStatus="idle"
        thinkGraphError={null}
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
      schemaVersion: 'thinkgraph.merged.presentation.v1',
      authority: 'thinkgraph',
      projectId: 'project-1',
      nodes: [{
        id: 'tg-live:one',
        label: 'build',
        mentionCount: 1,
        currentState: 'active',
        properties: { transient: true, persisted: false, source: 'user' },
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
              id: 'tg-live:two',
              label: 'tests',
              properties: { transient: true, persisted: false, source: 'assistant' },
            },
          ],
          edges: [{
            id: 'tg-live:edge',
            source: 'tg-live:one',
            target: 'tg-live:two',
            predicate: 'answer-near',
            mentionCount: 1,
            properties: { persisted: false, observational: true },
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
