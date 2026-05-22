// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@xyflow/react', async () => {
  const ReactModule = await import('react');
  return {
    Background: () => <div data-testid="mock-react-flow-background" />,
    Controls: () => <div data-testid="mock-react-flow-controls" />,
    MiniMap: () => <div data-testid="mock-react-flow-minimap" />,
    ReactFlow: ({ children, nodes, onNodeClick }: any) => (
      <div data-testid="mock-react-flow">
        {nodes.map((node: any) => (
          <button
            key={node.id}
            type="button"
            data-testid={`storyboard-node-${node.type}`}
            onClick={() => onNodeClick?.({}, node)}
          >
            {node.type}
          </button>
        ))}
        {children}
      </div>
    ),
    addEdge: (connection: any, edges: any[]) => [
      ...edges,
      { id: `${connection.source}-${connection.target}`, ...connection },
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

describe('MediaStudioCanvas AI-video storyboard graph', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders default graph with 5 required node types', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.getByTestId('mock-react-flow')).toBeTruthy();
    expect(screen.getAllByTestId('storyboard-node-shotNode')).toHaveLength(1);
    expect(screen.getAllByTestId('storyboard-node-startFrameNode')).toHaveLength(1);
    expect(screen.getAllByTestId('storyboard-node-endFrameNode')).toHaveLength(1);
    expect(screen.getAllByTestId('storyboard-node-motionPromptNode')).toHaveLength(1);
    expect(screen.getAllByTestId('storyboard-node-clipOutputNode')).toHaveLength(1);
  });

  it('shows image prompt fields for start and end frame nodes', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    fireEvent.click(screen.getByTestId('storyboard-node-startFrameNode'));
    expect(screen.getByLabelText('imagePrompt')).toBeTruthy();
    expect(screen.getByText('Copy Image Prompt')).toBeTruthy();

    fireEvent.click(screen.getByTestId('storyboard-node-endFrameNode'));
    expect(screen.getByLabelText('imagePrompt')).toBeTruthy();
    expect(screen.getByText('Copy Image Prompt')).toBeTruthy();
  });

  it('shows motion prompt editor and copy button', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    fireEvent.click(screen.getByTestId('storyboard-node-motionPromptNode'));
    expect(screen.getByLabelText('motionPrompt')).toBeTruthy();
    expect(screen.getByLabelText('videoTool')).toBeTruthy();
    expect(screen.getByText('Copy Video Prompt')).toBeTruthy();
  });

  it('stores clip output video URL in local state', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    fireEvent.click(screen.getByTestId('storyboard-node-clipOutputNode'));
    fireEvent.change(screen.getByLabelText('videoUrl'), {
      target: { value: 'https://example.com/result.mp4' },
    });

    expect(screen.getByDisplayValue('https://example.com/result.mp4')).toBeTruthy();
  });

  it('does not generate fake output', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');
    render(<MediaStudioCanvas projectId={null} />);

    expect(
      (screen.getByText('Generate disabled - no route wired') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText('Generated clip')).toBeNull();
    expect(screen.queryByText(/provider response/i)).toBeNull();
  });
});
