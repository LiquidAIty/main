// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
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

import { NativeCodeGraphSurface, NativeThinkGraphSurface } from './NativeAuthorityGraphSurface';

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
});
