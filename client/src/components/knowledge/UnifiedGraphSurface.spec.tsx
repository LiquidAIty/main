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
      {data.nodes[0] ? <button type="button" onClick={() => onNodeClick(data.nodes[0])}>Select first graph record</button> : null}
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
  ],
  edges: [{ id: 'edge:1', source: 'goal:1', target: 'decision:1', predicate: 'RESULTED_IN', mentionCount: 1 }],
  counts: { nodes: 2, edges: 1 },
};

describe('UnifiedGraphSurface', () => {
  it('lets the user select, pin, and depth-filter real projected records', async () => {
    render(
      <UnifiedGraphSurface
        projectId="project-1"
        codeGraphProject=""
        thinkProjection={projection}
        focusedThinkIds={[]}
        activeHermesReport={{
          reportId: 'report-1',
          status: 'updated',
          summary: 'Graph design report',
          reportMarkdown: 'The selected goal is linked to this report.',
          parentRunId: 'run-0',
          artifactRunId: 'run-1',
          focusNodeIds: ['goal:1'],
          requestedOutcome: null,
          createdAt: '2026-07-15T00:00:00Z',
          updatedAt: '2026-07-15T01:00:00Z',
          revision: 2,
          linkedThinkGraphNodeIds: ['goal:1'],
          linkedKnowGraphRefs: [],
          linkedCodeGraphRefs: [],
        }}
      />,
    );

    expect(screen.getByTestId('scene-node-count').textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Select first graph record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include in Main context' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));

    const mainOnly = screen.getByRole('checkbox', { name: /Main context only/ });
    expect((mainOnly as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(mainOnly);
    expect(screen.getByTestId('scene-node-count').textContent).toBe('2');

    fireEvent.change(screen.getByRole('slider', { name: 'Context depth' }), { target: { value: '0' } });
    await waitFor(() => expect(screen.getByTestId('scene-node-count').textContent).toBe('1'));
    fireEvent.click(screen.getByRole('tab', { name: 'Node' }));
    expect(screen.getByText('User included this record in Main context')).toBeTruthy();
    expect(screen.getByText(/characters · ~/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Report' }));
    expect(screen.getByText('The selected goal is linked to this report.')).toBeTruthy();
    expect(screen.getByText('Linked')).toBeTruthy();
  });
});
