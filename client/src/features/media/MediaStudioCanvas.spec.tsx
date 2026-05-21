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

describe('MediaStudioCanvas storyboard flow', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the default Reference to Shot to Prompt to Output storyboard', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');

    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.getByTestId('mock-react-flow')).toBeTruthy();
    expect(screen.getAllByTestId('storyboard-node-referenceNode')).toHaveLength(1);
    expect(screen.getAllByTestId('storyboard-node-shotNode')).toHaveLength(1);
    expect(screen.getAllByTestId('storyboard-node-promptNode')).toHaveLength(1);
    expect(screen.getAllByTestId('storyboard-node-outputNode')).toHaveLength(1);
    expect(screen.getByTestId('video-storyboard-inspector')).toBeTruthy();
    expect(screen.getByText(/Local component state only/i)).toBeTruthy();
    expect(
      (screen.getByText(/Generate disabled - no route wired/i) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/Video Output -> Peepshow Extract -> Frame References/i)).toBeTruthy();
  });

  it('edits selected node fields in local component state', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');

    render(<MediaStudioCanvas projectId="project-1" />);

    fireEvent.change(screen.getByLabelText('title'), {
      target: { value: 'Moodboard reference' },
    });

    expect(screen.getByDisplayValue('Moodboard reference')).toBeTruthy();

    fireEvent.click(screen.getByTestId('storyboard-node-promptNode'));
    fireEvent.change(screen.getByLabelText('prompt'), {
      target: { value: 'A clean product reveal shot.' },
    });

    expect(screen.getByDisplayValue('A clean product reveal shot.')).toBeTruthy();
  });

  it('adds each requested node type from the toolbar', async () => {
    const { default: MediaStudioCanvas } = await import('./MediaStudioCanvas');

    render(<MediaStudioCanvas projectId={null} />);

    fireEvent.click(screen.getByText('Add Reference'));
    fireEvent.click(screen.getByText('Add Shot'));
    fireEvent.click(screen.getByText('Add Prompt'));
    fireEvent.click(screen.getByText('Add Output'));

    expect(screen.getAllByTestId('storyboard-node-referenceNode')).toHaveLength(2);
    expect(screen.getAllByTestId('storyboard-node-shotNode')).toHaveLength(2);
    expect(screen.getAllByTestId('storyboard-node-promptNode')).toHaveLength(2);
    expect(screen.getAllByTestId('storyboard-node-outputNode')).toHaveLength(2);
  });
});
