// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@xyflow/react', async () => {
  const ReactModule = await import('react');
  return {
    Background: () => <div data-testid="mock-react-flow-background" />,
    BackgroundVariant: { Lines: 'lines' },
    ConnectionMode: { Loose: 'loose', Strict: 'strict' },
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    Handle: () => <span data-testid="mock-handle" />,
    ReactFlow: ({
      children,
      nodes,
      edges,
      nodeTypes,
      onNodeClick,
      onPaneClick,
      onConnect,
    }: any) => (
      <div data-testid="mock-react-flow">
        <button
          type="button"
          data-testid="storyboard-pane"
          onClick={() => onPaneClick?.()}
        >
          pane
        </button>
        <button
          type="button"
          data-testid="storyboard-connect"
          onClick={() => onConnect?.({ source: 'scene-2', target: 'output-1' })}
        >
          connect
        </button>
        <div data-testid="storyboard-edge-count">{edges.length}</div>
        <pre data-testid="storyboard-edges-json">{JSON.stringify(edges)}</pre>
        {nodes.map((node: any) => {
          const NodeComponent = nodeTypes?.[node.type];
          return (
            <button
              key={node.id}
              type="button"
              data-testid={`storyboard-node-${node.type}-${node.id}`}
              onClick={() => onNodeClick?.({}, node)}
            >
              {NodeComponent ? (
                <NodeComponent
                  id={node.id}
                  type={node.type}
                  data={node.data}
                  selected={false}
                  dragging={false}
                  zIndex={0}
                  isConnectable
                />
              ) : (
                node.type
              )}
            </button>
          );
        })}
        {children}
      </div>
    ),
    addEdge: (connection: any, currentEdges: any[]) => [
      ...currentEdges,
      { id: `${connection.source}-${connection.target}-${currentEdges.length}`, ...connection },
    ],
    useEdgesState: (initialEdges: any[]) => {
      const [edges, setEdges] = ReactModule.useState(initialEdges);
      return [edges, setEdges, vi.fn()];
    },
    useNodesState: (initialNodes: any[]) => {
      const [nodes, setNodes] = ReactModule.useState(initialNodes);
      return [nodes, setNodes, vi.fn()];
    },
  };
});

describe('MediaStudioCanvas uses native storyboard canvas patterns', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses Source, Scene, Image Pair, and Clip visible labels', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.getByText(/Source:/)).toBeTruthy();
    expect(screen.getByText(/Scene 1:/)).toBeTruthy();
    expect(screen.getByText(/Image Pair:/)).toBeTruthy();
    expect(screen.getByText(/^Clip$/)).toBeTruthy();
  });

  it('does not render removed jargon or roadsign labels', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.queryByText(/^Context$/)).toBeNull();
    expect(screen.queryByText(/^Frame Pack$/)).toBeNull();
    expect(screen.queryByText(/^Shot Kit$/)).toBeNull();
    expect(screen.queryByText(/^Output$/)).toBeNull();
    expect(screen.queryByText(/beat/i)).toBeNull();
    expect(screen.queryByText(/^Inspector$/)).toBeNull();
    expect(screen.queryByText(/^Node Actions$/)).toBeNull();
    expect(screen.queryByText(/^Local graph state only$/)).toBeNull();
    expect(screen.queryByText(/^Chat Scene Context$/)).toBeNull();
  });

  it('keeps canvas visible when a node is selected and opens drawer details', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    const drawer = screen.getByTestId('video-storyboard-inspector');
    expect(drawer.getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('mock-react-flow')).toBeTruthy();

    fireEvent.click(screen.getByTestId('storyboard-node-sceneNode-scene-1'));

    expect(drawer.getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('mock-react-flow')).toBeTruthy();
    expect(screen.getByTestId('selected-object-title').textContent).toContain('Scene 1');
  });

  it('detail surface is drawer-style and does not replace canvas', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    fireEvent.click(screen.getByTestId('storyboard-node-sceneNode-scene-1'));
    const drawer = screen.getByTestId('video-storyboard-inspector');
    const style = drawer.getAttribute('style') || '';
    expect(style).toContain('position: absolute');
    expect(style).toContain('width: 420px');
    expect(screen.getByTestId('mock-react-flow')).toBeTruthy();
  });

  it('preserves Source -> Scene -> Image Pair -> Clip behavior and semantic edges', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    const edgeJson = screen.getByTestId('storyboard-edges-json').textContent || '';
    expect(edgeJson).toContain('"semantic":"context_for"');
    expect(edgeJson).toContain('"semantic":"next"');
    expect(edgeJson).toContain('"semantic":"frame_pack_for"');
    expect(edgeJson).toContain('"semantic":"output_of"');
  });

  it('approved Scene can create Image Pair', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    fireEvent.click(screen.getByTestId('storyboard-node-sceneNode-scene-2'));
    fireEvent.click(screen.getByText('Approve scene'));
    fireEvent.click(screen.getByText('Create Image Pair'));

    expect(screen.getByTestId('storyboard-action-status').textContent).toContain('Image Pair created');
    expect(screen.getAllByText(/Image Pair:/).length).toBeGreaterThan(1);
  });

  it('keeps clip URL and status editable', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    fireEvent.click(screen.getByTestId('storyboard-node-outputNode-output-1'));
    fireEvent.change(screen.getByLabelText('videoUrl'), {
      target: { value: 'https://example.com/clip.mp4' },
    });
    fireEvent.change(screen.getByLabelText('status'), {
      target: { value: 'ready' },
    });

    expect(screen.getByDisplayValue('https://example.com/clip.mp4')).toBeTruthy();
    expect(screen.getByDisplayValue('ready')).toBeTruthy();
  });

  it('supports normal onConnect edge creation', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.getByTestId('storyboard-edge-count').textContent).toBe('4');
    fireEvent.click(screen.getByTestId('storyboard-connect'));
    expect(screen.getByTestId('storyboard-edge-count').textContent).toBe('5');
  });

  it('does not render fake media output', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.queryByText(/generated clip/i)).toBeNull();
    expect(screen.queryByText(/provider response/i)).toBeNull();
    expect(screen.queryByText(/fake/i)).toBeNull();
  });
});

describe('buildVideoObjectChatContext', () => {
  it('collects scene-linked source/image-pair/output data', async () => {
    const { buildVideoObjectChatContext } = await import('./MediaStudioCanvas');

    const nodes: any[] = [
      {
        id: 'context-1',
        type: 'contextNode',
        position: { x: 0, y: 0 },
        data: { title: 'Brief', sourceType: 'typed', content: 'intro' },
      },
      {
        id: 'scene-1',
        type: 'sceneNode',
        position: { x: 0, y: 0 },
        data: { title: 'S1', description: 'first', order: 1, approvalState: 'approved' },
      },
      {
        id: 'scene-2',
        type: 'sceneNode',
        position: { x: 0, y: 0 },
        data: { title: 'S2', description: 'second', order: 2, approvalState: 'draft' },
      },
      {
        id: 'frame-pack-1',
        type: 'framePackNode',
        position: { x: 0, y: 0 },
        data: {
          sceneId: 'scene-1',
          startImagePrompt: 'a',
          endImagePrompt: 'b',
          motionPrompt: 'c',
          negativePrompt: 'd',
          styleRules: 'e',
          continuityRules: 'f',
          startImageUrl: '',
          endImageUrl: '',
          approvalState: 'draft',
        },
      },
      {
        id: 'output-1',
        type: 'outputNode',
        position: { x: 0, y: 0 },
        data: { videoUrl: '', status: 'waiting', notes: '' },
      },
    ];
    const edges: any[] = [
      { id: 'context-1-scene-1', source: 'context-1', target: 'scene-1' },
      { id: 'scene-1-scene-2', source: 'scene-1', target: 'scene-2' },
      { id: 'scene-1-frame-pack-1', source: 'scene-1', target: 'frame-pack-1' },
      { id: 'frame-pack-1-output-1', source: 'frame-pack-1', target: 'output-1' },
    ];

    const result = buildVideoObjectChatContext('scene-1', nodes, edges);
    expect(result.selectedScene?.id).toBe('scene-1');
    expect(result.linkedContext).toHaveLength(1);
    expect(result.nextScene?.id).toBe('scene-2');
    expect(result.framePack?.id).toBe('frame-pack-1');
    expect(result.output?.id).toBe('output-1');
  });
});
