// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const observed = vi.hoisted(() => ({ renderers: [] as any[], layouts: [] as any[] }));
vi.mock('sigma', () => ({ default: class {
  handlers: Record<string, Function> = {};
  constructor() { observed.renderers.push(this); }
  on(name: string, handler: Function) { this.handlers[name] = handler; }
  getCamera() { return { setState() {}, getState: () => ({ ratio: 1 }) }; }
  setSetting() {} refresh() {} kill() {}
} }));
vi.mock('graphology-layout-forceatlas2/worker', () => ({ default: class {
  start = vi.fn(); stop = vi.fn(); kill = vi.fn();
  constructor() { observed.layouts.push(this); }
} }));
import ConstellationSigmaSurface from './ConstellationSigmaSurface';
import type { GraphProjectionV1 } from './NativeAuthorityGraphSurface';

afterEach(() => { cleanup(); observed.renderers.length = 0; observed.layouts.length = 0; });
const projection: GraphProjectionV1 = {
  schemaVersion: 'thinkgraph.constellation.v1', authority: 'constellation-engine', projectId: 'p',
  nodes: [{ id: 'q', label: 'Which evidence?', mentionCount: 1, properties: { summary: 'A real stored summary.', fullContent: 'The actual discussion and its uncertainty.', nodeType: 'Question', questionStatus: 'contested', authoredBy: 'assistant', answerRefs: [{ authority: 'knowgraph', nativeId: 'episode', projectId: 'p' }] } },
    { id: 'h', label: 'Initial hypothesis', mentionCount: 1 }],
  edges: [{ id: '7', source: 'q', target: 'h', predicate: 'questions', mentionCount: 1, properties: { edgeClass: 'explicit', strength: 0.8, rationale: 'The evidence is unresolved.' } }],
};

describe('ThinkGraph interaction', () => {
  it('loads the selected native record and shows its actual content and relationship', async () => {
    const expand = vi.fn(async () => {});
    const { rerender } = render(<ConstellationSigmaSurface projection={projection} status="ready" error={null} onExpand={expand} />);
    act(() => observed.renderers.at(-1).handlers.clickNode({ node: 'q' }));
    await waitFor(() => expect(expand).toHaveBeenCalledWith(projection.nodes[0]));
    expect(screen.getByText('A real stored summary.')).toBeTruthy();
    expect(screen.getByText('The actual discussion and its uncertainty.')).toBeTruthy();
    expect(screen.getByText('contested')).toBeTruthy();
    expect(screen.getByText('knowgraph: episode')).toBeTruthy();
    const count = observed.layouts.length;
    rerender(<ConstellationSigmaSurface projection={{ ...projection, revision: 'content-only' }} status="ready" error={null} onExpand={expand} />);
    expect(observed.layouts).toHaveLength(count);
    act(() => observed.renderers.at(-1).handlers.clickEdge({ edge: '7' }));
    expect(screen.getByTestId('thinkgraph-edge-inspector').textContent).toContain('The evidence is unresolved.');
    expect(screen.getByTestId('thinkgraph-edge-inspector').textContent).toContain('explicit');
  });

  it('restarts layout on strict effect replay and stops the old worker', () => {
    const result = render(<StrictMode><ConstellationSigmaSurface projection={projection} status="ready" error={null} /></StrictMode>);
    expect(observed.layouts.length).toBe(2);
    expect(observed.layouts[0].kill).toHaveBeenCalled();
    expect(observed.layouts[1].start).toHaveBeenCalledOnce();
    result.unmount();
    expect(observed.layouts[1].kill).toHaveBeenCalled();
  });
});
