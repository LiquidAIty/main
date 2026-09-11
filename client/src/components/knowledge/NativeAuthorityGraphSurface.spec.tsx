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
    for (const value of ['original', 'communities', 'radial', 'compact']) {
      fireEvent.change(screen.getByRole('combobox', { name: 'Layout' }), { target: { value } });
      expect(graph.setPreset).toHaveBeenLastCalledWith(value);
      expect(graph.data.nodes).toEqual([]);
    }
    expect(screen.queryByRole('button', { name: /Freeze|Resume|Reheat|Focus/ })).toBeNull();
    expect(graph.freeze).not.toHaveBeenCalled();
    expect(graph.reheat).not.toHaveBeenCalled();
  });

  it('passes the complete Engraphis scene unchanged, including layout metadata', () => {
    const scene = { nodes: [], edges: [], communities: [], meta: { layout_seed: 7 } };
    render(<NativeGraphProjectionSurface authority="knowgraph"
      projection={{ ...empty('thinkgraph'), scene }} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.setData.mock.calls[0][0]).toBe(scene);
    expect(graph.data.nodes).toEqual([]);
    expect(graph.data.links).toEqual([]);
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

  it('passes recorded predicates as Engraphis link labels without changing endpoints or evidence', () => {
    const projection = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'subject', label: 'Subject' }, { id: 'idea', label: 'Idea' }],
      edges: [{ id: 'edge', source: 'subject', target: 'idea', predicate: 'considers',
        provenance: { memoryId: 'stored-memory' }, properties: { summary: 'Recorded relationship.' } }],
    };
    const before = JSON.stringify(projection);
    render(<NativeGraphProjectionSurface authority="knowgraph" projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.links).toHaveLength(1);
    expect(graph.data.links[0]).toMatchObject({ ...projection.edges[0], relation: 'considers' });
    expect(graph.data.nodes.map((node: any) => [node.id, node.label])).toEqual([['subject', 'Subject'], ['idea', 'Idea']]);
    expect(JSON.stringify(projection)).toBe(before);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Subject considers Idea' }));
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('Recorded relationship.');
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
    expect(screen.queryByRole('button', { name: 'Freeze', exact: true })).toBeNull();
  });

  it('opens only the selected ThinkGraph entry and keeps graph settings separate', () => {
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry', properties: { summary: 'Saved note.' } }] };
    render(<NativeGraphProjectionSurface authority="thinkgraph" projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByRole('region', { name: 'Existing entry details' }).textContent).toContain('Saved note.');
    expect(screen.queryByRole('button', { name: 'Expand', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use in chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('region', { name: 'Existing entry details' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Text size' })).toBeTruthy();
  });

  it('removes only the selected stored note and reports a failed removal without hiding data', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Removal unavailable'));
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry',
      properties: { evidence: [{ id: 'memory-id', summary: 'Saved note.' }] } }] };
    render(<NativeGraphProjectionSurface authority="thinkgraph" projection={projection}
      status="ready" error={null} onRemoveEvidence={remove} />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    fireEvent.click(screen.getByText('Supporting note'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Removal unavailable'));
    expect(remove).toHaveBeenCalledExactlyOnceWith('memory-id');
    expect(screen.getByText('Saved note.')).toBeTruthy();
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
    fireEvent.click(screen.getByText('NASA launch report'));
    expect(screen.getByRole('link', { name: 'NASA' }).getAttribute('href')).toBe('https://www.nasa.gov/mission');
    expect(screen.queryByRole('link', { name: 'example.org' })).toBeNull();
    act(() => screen.getByRole('button', { name: 'Rocket Lab PROVIDED_LAUNCH_FOR CAPSTONE' }).click());
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('Rocket Lab launched CAPSTONE.');
    expect(screen.getByRole('link', { name: 'NASA' })).toBeTruthy();
    act(() => graph.nodeClick(graph.data.nodes[2]));
    expect(screen.getByTestId('knowgraph-node-inspector').textContent).toContain('The launch report.');
  });

  it.each(['thinkgraph', 'knowgraph'] as const)('preserves %s inspector width, provenance, keyboard access and graph settings', authority => {
    const panelStyles = vi.spyOn(graphVisualTokens, 'graphInspectorPanelStyle');
    const key = `liquidaity.drawer.${authority}.width`;
    window.localStorage.setItem(key, '390');
    const projection = { ...empty(authority), nodes: [{ id: 'native-1', label: 'Recorded subject',
      runId: 'run-1', conversationId: 'chat-1', createdAt: '2026-09-01',
      properties: { statement: 'The complete original statement.', certainty: 0.4, supersedes: 'native-0' },
      provenance: { author: 'Research Agent', correction: 'Source corrected its estimate.' } }] };
    const { container } = render(<NativeGraphProjectionSurface authority={authority} projection={projection} status="ready" error={null} />);
    const graph = forceGraphMocks.instances.at(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Node size' }), { target: { value: '5' } });
    act(() => graph.nodeClick(graph.data.nodes[0]));
    const panel = screen.getByRole('complementary', { name: 'Recorded subject' });
    expect(panel.style.width).toBe('390px');
    expect(screen.getByRole('heading', { name: 'Recorded subject' })).toBe(document.activeElement);
    expect(panel.textContent).toContain('The complete original statement.');
    expect(panel.textContent).toContain('native-1');
    expect(panel.textContent).toContain('run-1');
    expect(panel.textContent).toContain('chat-1');
    expect(panel.textContent).toContain('2026-09-01');
    expect(panel.textContent).toContain('Research Agent');
    expect(panel.textContent).toContain('native-0');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize drawer' }), { key: 'ArrowLeft' });
    expect(panel.style.width).toBe('400px');
    expect(window.localStorage.getItem(key)).toBe('400');
    fireEvent.click(screen.getByRole('button', { name: 'Detach panel' }));
    expect(screen.getByRole('button', { name: 'Dock panel' })).toBeTruthy();
    vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {},
    });
    const previousTop = Number.parseFloat(panel.style.top);
    fireEvent.keyDown(screen.getByLabelText('Move panel with arrow keys'), { key: 'ArrowDown' });
    expect(Number.parseFloat(panel.style.top)).toBe(previousTop + 10);
    fireEvent.click(screen.getByRole('button', { name: 'Dock panel' }));
    // This jsdom version ignores assigning CSS left:auto over a pixel value.
    // Check the real material helper's input; browser layout is separate proof.
    expect(panelStyles).toHaveBeenLastCalledWith(expect.objectContaining({ left: 'auto', right: 12 }));
    expect(panel.style.right).toBe('12px');
    expect(screen.getByRole('button', { name: 'Detach panel' })).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.getByRole('combobox', { name: 'Layout' })).toBe(document.activeElement);
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('complementary', { name: 'Graph settings' }).style.width).toBe('400px');
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
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('complementary', { name: 'Graph settings' }).style.width).toBe('400px');
  });
});
