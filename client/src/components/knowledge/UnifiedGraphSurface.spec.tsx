// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UnifiedGraphSurface from './UnifiedGraphSurface';

vi.mock('../codegraph/CodeGraphSurface', () => ({
  fetchLayout: vi.fn(async () => ({ nodes: [], edges: [], total_nodes: 0 })),
}));

vi.mock('../codegraph/CodeGraphScene', () => ({
  CodeGraphScene: ({ data, onNodeClick }: { data: { nodes: Array<{ name: string }> }; onNodeClick: (node: unknown) => void }) => (
    <div>
      <span data-testid="scene-node-count">{data.nodes.length}</span>
      {data.nodes.map((node, index) => <button key={node.name} type="button" onClick={() => onNodeClick(data.nodes[index])}>Select {node.name}</button>)}
    </div>
  ),
}));

const projection = {
  schemaVersion: 'projection.v1',
  authority: 'engraphis-v2',
  projectId: 'project-1',
  revision: '1',
  nodes: [
    { id: 'goal:1', canonicalId: 'goal:1', label: 'Build the graph', type: 'Goal', mentionCount: 1, currentState: 'current' },
    { id: 'decision:1', canonicalId: 'decision:1', label: 'Use Three.js', type: 'Decision', mentionCount: 1, goalId: 'goal:1', retrievalReason: 'active goal context' },
    { id: 'proof:1', canonicalId: 'proof:1', label: 'Browser proof', type: 'Evidence', mentionCount: 1, goalId: 'goal:1' },
  ],
  edges: [
    { id: 'edge:1', source: 'goal:1', target: 'decision:1', predicate: 'RESULTED_IN', mentionCount: 1 },
    { id: 'edge:2', source: 'decision:1', target: 'proof:1', predicate: 'REQUIRES', mentionCount: 1 },
  ],
  counts: { nodes: 3, edges: 2 },
};

describe('UnifiedGraphSurface', () => {
  it('uses the selected neighborhood as both the rendered projection and candidate Graph View', async () => {
    const onCandidateHandbacksChange = vi.fn();
    render(
      <UnifiedGraphSurface
        projectId="project-1"
        conversationId="conversation-1"
        codeGraphProject=""
        thinkProjection={projection}
        focusedThinkIds={[]}
        onCandidateHandbacksChange={onCandidateHandbacksChange}
      />,
    );

    expect(screen.getByTestId('scene-node-count').textContent).toBe('3');
    expect(screen.queryByRole('tab', { name: 'Controls' })).toBeNull();
    expect(screen.queryByText(/Runtime only/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select Build the graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to candidate context' }));
    expect(screen.getByTestId('scene-node-count').textContent).toBe('2');
    expect(screen.getByText('User included this record as candidate context')).toBeTruthy();
    expect(screen.getByText(/characters · ~/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Selection depth' }), { target: { value: '2' } });
    expect(screen.getByTestId('scene-node-count').textContent).toBe('3');
    fireEvent.change(screen.getByRole('combobox', { name: 'Receiving role' }), { target: { value: 'coder' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Graph view note' }), { target: { value: 'Inspect this branch.' } });
    await waitFor(() => expect(onCandidateHandbacksChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        schemaVersion: 'graph-view.v1',
        authority: 'thinkgraph',
        status: 'candidate',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        receivingRole: 'coder',
        rootCanonicalNodeIds: ['goal:1'],
        includedCanonicalNodeIds: ['goal:1', 'decision:1', 'proof:1'],
        hopDepth: 2,
        note: 'Inspect this branch.',
      }),
    ]));
  });
});
