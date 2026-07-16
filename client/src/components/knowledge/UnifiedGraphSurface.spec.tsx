import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UnifiedGraphSurface from './UnifiedGraphSurface';

vi.mock('../codegraph/CodeGraphScene', () => ({
  CodeGraphScene: ({ data, visualProfile }: { data: { nodes: Array<{ authority?: string; size: number }>; edges: Array<{ cross_authority?: boolean }> }; visualProfile?: string }) => <div
    data-testid="scene"
    data-profile={visualProfile}
    data-think-size={Math.max(0, ...data.nodes.filter((node) => node.authority === 'thinkgraph').map((node) => node.size))}
    data-know-size={Math.max(0, ...data.nodes.filter((node) => node.authority === 'knowgraph').map((node) => node.size))}
    data-cross-edges={data.edges.filter((edge) => edge.cross_authority).length}
  >{data.nodes.length} nodes / {data.edges.length} edges</div>,
}));

const payload = {
  schemaVersion: 'unified.context.v1', projectionId: 'unified:full', warnings: [],
  counts: { selected: { thinkgraph: 2, knowgraph: 2, codegraph: 3 }, nodes: 7, edges: 3, crossAuthorityEdges: 0 },
  nodes: [
    { id: 1, x: 0, y: 0, z: 0, label: 'Function', name: 'code', size: 4, color: '#fff', authority: 'codegraph', source_id: 'code:1' },
    { id: 2, x: 0, y: 0, z: 0, label: 'Function', name: 'code2', size: 4, color: '#fff', authority: 'codegraph', source_id: 'code:2' },
    { id: 3, x: 0, y: 0, z: 0, label: 'File', name: 'code3', size: 4, color: '#fff', authority: 'codegraph', source_id: 'code:3' },
    { id: 4, x: 0, y: 0, z: 0, label: 'Finding', name: 'think', size: 4, color: '#fff', authority: 'thinkgraph', source_id: 'think:1' },
    { id: 5, x: 0, y: 0, z: 0, label: 'Decision', name: 'think2', size: 4, color: '#fff', authority: 'thinkgraph', source_id: 'think:2' },
    { id: 6, x: 0, y: 0, z: 0, label: 'Concept', name: 'know', size: 4, color: '#fff', authority: 'knowgraph', source_id: 'know:1' },
    { id: 7, x: 0, y: 0, z: 0, label: 'Document', name: 'know2', size: 4, color: '#fff', authority: 'knowgraph', source_id: 'know:2' },
  ],
  edges: [
    { id: 'c', source: 1, target: 2, type: 'CALLS', cross_authority: false },
    { id: 't', source: 4, target: 5, type: 'RELATES', cross_authority: false },
    { id: 'k', source: 6, target: 7, type: 'SUPPORTS', cross_authority: false },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UnifiedGraphSurface', () => {
  it('renders the complete combined projection and returns only its identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    const onProjectionChange = vi.fn();
    render(<UnifiedGraphSurface projectId="project" conversationId="main" onProjectionChange={onProjectionChange} />);
    expect((await screen.findByTestId('scene')).textContent).toContain('7 nodes / 3 edges');
    expect(screen.getByTestId('scene').getAttribute('data-profile')).toBe('unified');
    expect(Number(screen.getByTestId('scene').getAttribute('data-think-size'))).toBeGreaterThan(16);
    expect(Number(screen.getByTestId('scene').getAttribute('data-know-size'))).toBeGreaterThan(16);
    expect(screen.getByTestId('scene').getAttribute('data-cross-edges')).toBe('0');
    expect(screen.getByText(/Code 3 · Think 2 · Know 2/)).toBeTruthy();
    expect(screen.queryByLabelText('Unified legend')).toBeNull();
    await waitFor(() => expect(onProjectionChange).toHaveBeenCalledWith(expect.objectContaining({ projectionId: 'unified:full' })));
  });

  it('layer controls are display-only and do not refetch or change projection identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);
    render(<UnifiedGraphSurface projectId="project" conversationId="main" />);
    expect((await screen.findByTestId('scene')).textContent).toContain('7 nodes / 3 edges');
    fireEvent.click(screen.getByRole('button', { name: 'Open Unified Inspector' }));
    fireEvent.click(screen.getByLabelText(/ThinkGraph/));
    expect(screen.getByTestId('scene').textContent).toContain('5 nodes / 2 edges');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Solo' })).toHaveLength(3);
  });

  it('fails honestly when the Unified project is unresolved', () => {
    render(<UnifiedGraphSurface projectId="" conversationId="main" />);
    expect(screen.getByText('Unified requires a project.')).toBeTruthy();
  });
});
