// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../vendor/codebase-memory-ui/src/components/GraphTab', () => ({
  GraphTab: ({ project }: { project: string | null }) => <div data-testid="cbm-graph-tab">{project}</div>,
}));

vi.mock('force-graph', () => ({ default: function ForceGraphMock() { return {
  backgroundColor() { return this; }, cooldownTime() { return this; }, warmupTicks() { return this; },
  nodeRelSize() { return this; }, autoPauseRedraw() { return this; }, onNodeClick() { return this; },
  onNodeHover() { return this; }, nodeCanvasObject() { return this; }, nodePointerAreaPaint() { return this; },
  linkColor() { return this; }, linkWidth() { return this; }, linkDirectionalArrowLength() { return this; },
  linkDirectionalArrowRelPos() { return this; }, linkCanvasObjectMode() { return this; }, linkCanvasObject() { return this; },
  onRenderFramePost() { return this; }, d3Force() { return { strength: () => undefined, distance: () => undefined }; },
  graphData(value?: unknown) { return value === undefined ? { nodes: [] } : this; }, d3ReheatSimulation() { return this; },
  width() { return this; }, height() { return this; }, zoomToFit() { return this; },
}; } }));

class ResizeObserverStub { observe() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import {
  NativeCodeGraphSurface,
  NativeKnowGraphSurface,
} from './NativeAuthorityGraphSurface';
import KnowledgeGraphFramework from './KnowledgeGraphFramework';

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
});
