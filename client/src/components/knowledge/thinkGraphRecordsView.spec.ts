import { describe, expect, it } from 'vitest';

import {
  mapAcceptedThinkGraphRecordsToViewData,
  resolveThinkGraphSourceLabel,
  type ThinkGraphRecordsView,
} from './thinkGraphRecordsView';

const ACCEPTED: ThinkGraphRecordsView = {
  ok: true,
  source: 'thinkgraph-db',
  nodes: [
    { id: 'e_rdw', label: 'Redwire Corporation', type: 'company', sourceRef: 'magone-rdw-spacex-1', confidence: 0.99 },
    { id: 'e_spacex', label: 'SpaceX', type: 'company', sourceRef: 'magone-rdw-spacex-1', confidence: 0.99 },
  ],
  edges: [{ id: 'edge1', source: 'e_rdw_ticker', target: 'e_rdw', label: 'identifies', type: 'identifies' }],
};

describe('thinkGraph accepted-records -> view data', () => {
  it('projects accepted :SlmGraphRecord nodes/edges into GraphViewData', () => {
    const view = mapAcceptedThinkGraphRecordsToViewData(ACCEPTED);
    expect(view).not.toBeNull();
    expect(view!.kind).toBe('thinkgraph');
    expect(view!.nodes.map((n) => n.label)).toContain('Redwire Corporation');
    expect(view!.nodes.map((n) => n.label)).toContain('SpaceX');
    expect(view!.edges[0]).toMatchObject({ source: 'e_rdw_ticker', target: 'e_rdw', type: 'identifies' });
  });

  it('returns null (fall back to legacy view) when there are no accepted records', () => {
    expect(mapAcceptedThinkGraphRecordsToViewData({ ok: true, source: 'thinkgraph-db', nodes: [], edges: [], reason: 'no_thinkgraph_records_for_project' })).toBeNull();
    expect(mapAcceptedThinkGraphRecordsToViewData(null)).toBeNull();
  });
});

describe('thinkGraph honest SHORT source label (no long reasons on canvas)', () => {
  it('reports thinkgraph-db when real records are present', () => {
    expect(resolveThinkGraphSourceLabel(ACCEPTED, false)).toBe('thinkgraph-db');
  });

  it('reports a SHORT thinkgraph-db when DB ok but empty (no_records detail stays off-canvas)', () => {
    expect(
      resolveThinkGraphSourceLabel({ ok: true, source: 'thinkgraph-db', nodes: [], edges: [], reason: 'no_thinkgraph_records_for_project' }, false),
    ).toBe('thinkgraph-db');
  });

  it('keeps host-provided label when legacy view has nodes but no accepted records', () => {
    expect(resolveThinkGraphSourceLabel({ ok: true, source: 'thinkgraph-db', nodes: [], edges: [] }, true)).toBe('host-provided');
  });

  it('reports a SHORT "unavailable" on DB failure (no long blocker on canvas)', () => {
    const label = resolveThinkGraphSourceLabel(
      { ok: false, source: 'unavailable', nodes: [], edges: [], reason: 'thinkgraph_unavailable', blocker: 'ECONNREFUSED 5432' },
      false,
    );
    expect(label).toBe('unavailable');
    expect(label).not.toContain('ECONNREFUSED');
    expect(label).not.toContain(':');
  });

  it('falls back to host-provided / thinkgraph-db when no view fetched yet', () => {
    expect(resolveThinkGraphSourceLabel(null, true)).toBe('host-provided');
    expect(resolveThinkGraphSourceLabel(null, false)).toBe('thinkgraph-db');
  });
});
