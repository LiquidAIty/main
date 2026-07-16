// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UnifiedGraphSurface from './UnifiedGraphSurface';

vi.mock('../codegraph/CodeGraphScene', () => ({
  CodeGraphScene: ({ data, highlightedIds, onNodeClick }: { data: { nodes: Array<{ id: number; name: string }> }; highlightedIds: Set<number> | null; onNodeClick: (node: unknown) => void }) => (
    <div><span data-testid="scene-node-count">{data.nodes.length}</span><span data-testid="highlighted-ids">{[...(highlightedIds || [])].join(',')}</span>{data.nodes.map((node, index) => <button key={node.id} onClick={() => onNodeClick(data.nodes[index])}>Select {node.name}</button>)}</div>
  ),
}));

const graphView = {
  schemaVersion: 'graph-view.v1', viewId: 'view-1', authority: 'thinkgraph', status: 'attached', projectId: 'project-1', conversationId: 'conversation-1',
  producingRole: 'user', receivingRole: 'main_chat', rootCanonicalNodeIds: ['goal:1'], includedCanonicalNodeIds: ['goal:1'], records: [], includedRelationships: [],
  query: 'architecture', filter: { nodeTypes: [], trustStates: [] }, hopDepth: 1, provenanceRefs: [], omittedNeighborCount: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

const payload = {
  schemaVersion: 'unified.context.v1', projectId: 'project-1', conversationId: 'conversation-1', receivingRole: 'main_chat', activeGraphViewId: 'view-1',
  projectionId: 'unified:abc', configurationHash: 'config-abc', contentHash: 'content-abc',
  graphViews: [graphView], availableGraphViews: [graphView], lifecycle: { available: ['view-1'], selected: ['view-1'], attached: ['view-1'], delivered: [], consumed: [], returned: [], superseded: [] },
  nodes: [
    { id: 1, x: 1, y: 2, z: 120, label: 'Goal', name: 'Architecture goal', size: 8, color: '#4AE2DF', authority: 'thinkgraph', source_id: 'goal:1', cluster: 'decision', selection_state: 'selected' },
    { id: 2, x: 1, y: 2, z: 0, label: 'Document', name: 'Book', size: 8, color: '#B8C8D2', authority: 'knowgraph', source_id: 'book:1', cluster: 'evidence', selection_state: 'available' },
    { id: 3, x: 1, y: 2, z: -120, label: 'Function', name: 'build_context', size: 8, color: '#5EA8FF', authority: 'codegraph', source_id: 'code:1', cluster: 'code', selection_state: 'available' },
  ],
  edges: [{ id: 'e1', source: 1, target: 2, type: 'REFERENCES', cross_authority: true }],
  regions: [{ id: 'thinkgraph', label: 'ThinkGraph', color: '#4AE2DF', z: 120 }, { id: 'knowgraph', label: 'KnowGraph', color: '#B8C8D2', z: 0 }, { id: 'codegraph', label: 'CodeGraph', color: '#5EA8FF', z: -120 }],
  counts: { available: { thinkgraph: 2, knowgraph: 4, codegraph: 5 }, selected: { thinkgraph: 1, knowgraph: 1, codegraph: 1 }, nodes: 3, edges: 1, crossAuthorityEdges: 1 }, warnings: [],
};

describe('UnifiedGraphSurface', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the Python projection and hands back projection identity only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
    const onChange = vi.fn();
    const onOpenAuthority = vi.fn();
    render(<UnifiedGraphSurface projectId="project-1" conversationId="conversation-1" onProjectionChange={onChange} onOpenAuthority={onOpenAuthority} />);
    await waitFor(() => expect(screen.getByTestId('scene-node-count').textContent).toBe('3'));
    // Identity only — never Graph View content through the browser.
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      projectionId: 'unified:abc',
      role: 'main_chat',
      activeGraphViewId: null,
      expansionDepth: 0,
      knowgraphScope: null,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Visual filters' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Visual authority' }), { target: { value: 'knowgraph' } });
    expect(screen.getByTestId('scene-node-count').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Select Book' }));
    expect(screen.getByText('book:1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open authoritative knowgraph view' }));
    expect(onOpenAuthority).toHaveBeenCalledWith('knowgraph');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/unified/context?'), expect.anything());
  });

  it('ignores an older response after the receiving role changes', async () => {
    const pending: Array<(value: { ok: boolean; json: () => Promise<unknown> }) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => pending.push(resolve))));
    const onChange = vi.fn();
    render(<UnifiedGraphSurface projectId="project-1" conversationId="conversation-1" onProjectionChange={onChange} />);
    await waitFor(() => expect(pending).toHaveLength(1));

    fireEvent.change(screen.getByRole('combobox', { name: 'Receiving role' }), { target: { value: 'coder' } });
    await waitFor(() => expect(pending).toHaveLength(2));
    const coderView = { ...graphView, viewId: 'coder-view', receivingRole: 'coder' };
    const coderPayload = { ...payload, receivingRole: 'coder', projectionId: 'unified:coder', graphViews: [coderView] };
    pending[1]({ ok: true, json: async () => coderPayload });
    await waitFor(() => expect(screen.getAllByText('unified:coder').length).toBeGreaterThan(0));

    pending[0]({ ok: true, json: async () => payload });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getAllByText('unified:coder').length).toBeGreaterThan(0);
    expect(screen.queryByText('unified:abc')).toBeNull();
    // Identity of the WINNING (newer-config) projection — never the stale one.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      projectionId: 'unified:coder',
      role: 'coder',
    }));
  });

  it('uses semantic fields and explains only the persisted selected neighborhood', async () => {
    const semanticPayload = {
      ...payload,
      nodes: [
        { ...payload.nodes[0], name: 'Goal', properties: { display_label: 'Are we following knowledge graph best practices?', description: 'Evaluate the repository against sourced graph guidance.' } },
        { ...payload.nodes[1], label: 'Chunk', name: 'building-knowledge-graphs-full-book', properties: { description: 'Contextualized data creates usable knowledge from source material.' } },
        payload.nodes[2],
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => semanticPayload })));
    render(<UnifiedGraphSurface projectId="project-1" conversationId="conversation-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Select Are we following knowledge graph best/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Select Contextualized data creates usable knowledge/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Select Are we following knowledge graph best/ }));
    expect(screen.getByTestId('scene-node-count').textContent).toBe('3');
    expect(screen.getByTestId('highlighted-ids').textContent).toBe('1,2');
    expect(screen.getByText('Evaluate the repository against sourced graph guidance.')).toBeTruthy();
    expect(screen.getAllByText(/Contextualized data creates usable knowledge/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Reset focus' }));
    expect(screen.getByTestId('highlighted-ids').textContent).toBe('');
  });
});
