// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../vendor/codebase-memory-ui/src/components/GraphTab', () => ({
  GraphTab: ({ project }: { project: string | null }) => <div data-testid="cbm-graph-tab">{project}</div>,
}));

const forceGraphState = vi.hoisted(() => ({ onNodeClick: null as null | ((node: unknown) => void) }));

vi.mock('force-graph', () => ({ default: function ForceGraphMock() { return {
  backgroundColor() { return this; }, cooldownTime() { return this; }, warmupTicks() { return this; },
  nodeRelSize() { return this; }, autoPauseRedraw() { return this; }, onNodeClick(handler: (node: unknown) => void) { forceGraphState.onNodeClick = handler; return this; },
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
  NativeThinkGraphSurface,
} from './NativeAuthorityGraphSurface';
import KnowledgeGraphFramework from './KnowledgeGraphFramework';

describe('native authority graph surfaces', () => {
  it('mounts the real CBM GraphTab with the resolved repository identity', () => {
    render(<NativeCodeGraphSurface project="C-Projects-main" />);
    expect(screen.getByTestId('cbm-graph-tab').textContent).toBe('C-Projects-main');
  });

  it('renders Engraphis honest empty state without sample data', () => {
    render(<NativeThinkGraphSurface projection={{ schemaVersion: 'v1', projectId: 'p', nodes: [], edges: [] }} status="ready" error={null} />);
    expect(screen.getByText('No entities in this project yet.')).toBeTruthy();
    expect(screen.getByTestId('graph-navigation-controls')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open ThinkGraph Inspector' })).toBeTruthy();
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
  });

  it('keeps canonical identity, authority, graph references, and provenance in the inspector', () => {
    render(<NativeThinkGraphSurface projection={{
      schemaVersion: 'thinkgraph.projection.v1',
      authority: 'thinkgraph',
      projectId: 'p',
      nodes: [
        {
          id: 'physical:decision:1',
          canonicalId: 'decision:organizing-principle',
          label: 'Organizing principle',
          type: 'Decision',
          authority: 'thinkgraph',
          currentState: 'provisional',
          trustState: 'reviewed',
          codeGraphRef: 'C-Projects-main.apps.python-models.app.mcp_host',
          provenance: { source: 'main', correlationId: 'run:1' },
          properties: { summary: 'Organize by authority, then bounded view.' },
          mentionCount: 1,
        },
        { id: 'question:1', label: 'Unresolved question', type: 'Question', mentionCount: 1 },
      ],
      edges: [{ id: 'e1', source: 'physical:decision:1', target: 'question:1', predicate: 'HAS_OPEN_QUESTION', mentionCount: 1 }],
    }} status="ready" error={null} />);

    act(() => forceGraphState.onNodeClick?.({
      id: 'physical:decision:1',
      canonicalId: 'decision:organizing-principle',
      label: 'Organizing principle',
      fullLabel: 'Organizing principle',
      etype: 'Decision',
      authority: 'thinkgraph',
      currentState: 'provisional',
      trustState: 'reviewed',
      codeGraphRef: 'C-Projects-main.apps.python-models.app.mcp_host',
      provenance: { source: 'main', correlationId: 'run:1' },
      properties: { summary: 'Organize by authority, then bounded view.' },
      degree: 1,
      val: 2,
    }));

    expect(screen.getByTestId('thinkgraph-node-inspector').textContent).toContain('decision:organizing-principle');
    expect(screen.getByTestId('thinkgraph-node-inspector').textContent).toContain('CodeGraph: C-Projects-main');
    expect(screen.getByText('Provenance')).toBeTruthy();
    expect(screen.getByText(/correlationId/)).toBeTruthy();
  });

  it('shows the exact CodeGraph project-resolution failure instead of mounting an arbitrary index', () => {
    const { container } = render(
      <KnowledgeGraphFramework
        projectId="p"
        codeGraphProjectName={null}
        codeGraphProjectError="CBM project identity is ambiguous: C-Projects-main-a, C-Projects-main-b"
        conversationId="main"
        kind="codegraph"
        thinkGraphProjection={{ status: 'idle', projection: null, error: null }}
        onKindChange={vi.fn()}
        onProjectionChange={vi.fn()}
        onAskMain={vi.fn()}
        onSelectedObjectChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'C-Projects-main-a, C-Projects-main-b',
    );
    expect(container.querySelector('[data-testid="cbm-graph-tab"]')).toBeNull();
  });
});
