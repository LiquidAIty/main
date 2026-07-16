// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGraphData } from './useGraphData';

const graph = (id: number) => ({ nodes: [{ id, name: `node-${id}`, label: 'Function', x: 0, y: 0, z: 0, size: 1, color: '#37ADAA' }], edges: [], total_nodes: 1 });

describe('useGraphData', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the newest refresh when an older response finishes last', async () => {
    const pending: Array<(value: { ok: boolean; json: () => Promise<unknown> }) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => pending.push(resolve))));
    const { result } = renderHook(() => useGraphData());

    act(() => result.current.fetchOverview('older'));
    act(() => result.current.fetchOverview('newer'));
    expect(pending).toHaveLength(2);

    await act(async () => pending[1]({ ok: true, json: async () => graph(2) }));
    await waitFor(() => expect(result.current.data?.nodes[0]?.id).toBe(2));
    await act(async () => pending[0]({ ok: true, json: async () => graph(1) }));
    expect(result.current.data?.nodes[0]?.id).toBe(2);
  });
});
