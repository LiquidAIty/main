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

describe('thinkGraph honest source label (no blanket host-provided)', () => {
  it('reports thinkgraph-db when real records are present', () => {
    expect(resolveThinkGraphSourceLabel(ACCEPTED, false)).toBe('thinkgraph-db');
  });

  it('reports honest no-records reason when DB ok but empty and no host fallback', () => {
    expect(
      resolveThinkGraphSourceLabel({ ok: true, source: 'thinkgraph-db', nodes: [], edges: [], reason: 'no_thinkgraph_records_for_project' }, false),
    ).toBe('thinkgraph-db:no_thinkgraph_records_for_project');
  });

  it('keeps host-provided label when legacy view has nodes but no accepted records', () => {
    expect(resolveThinkGraphSourceLabel({ ok: true, source: 'thinkgraph-db', nodes: [], edges: [] }, true)).toBe('host-provided');
  });

  it('reports unavailable with blocker on DB failure (distinct from empty)', () => {
    const label = resolveThinkGraphSourceLabel(
      { ok: false, source: 'unavailable', nodes: [], edges: [], reason: 'thinkgraph_unavailable', blocker: 'ECONNREFUSED 5432' },
      false,
    );
    expect(label.startsWith('unavailable:')).toBe(true);
    expect(label).toContain('ECONNREFUSED');
  });

  it('falls back to host-provided / thinkgraph-db when no view fetched yet', () => {
    expect(resolveThinkGraphSourceLabel(null, true)).toBe('host-provided');
    expect(resolveThinkGraphSourceLabel(null, false)).toBe('thinkgraph-db');
  });
});
