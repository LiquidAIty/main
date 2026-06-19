import { describe, expect, it } from 'vitest';

import {
  buildThinkGraphGraphViewResponse,
  projectThinkGraphRecordsToGraphView,
} from './thinkGraphRecordToGraphView';
import type { StoredThinkGraphSemanticRecord } from '../services/thinkgraph/thinkgraphMemory';

// Accepted RDW/SpaceX record as it reads back from thinkgraph_liq (the proven write path).
const ACCEPTED: StoredThinkGraphSemanticRecord = {
  id: 'tgsem:p:1',
  projectId: '20ac92d-01fd-4cf6-97cc-0672421e751a',
  sourceRef: 'magone-rdw-spacex-1',
  createdBy: 'slmGraphWorker',
  entities: [
    { id: 'e_rdw', label: 'Redwire Corporation', type: 'company' },
    { id: 'e_rdw_ticker', label: 'RDW', type: 'ticker' },
    { id: 'e_spacex', label: 'SpaceX', type: 'company' },
  ],
  relations: [
    { from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies' },
    { from: 'e_t1', to: 'e_rdw', type: 'depends_on' },
  ],
  categories: ['market_research'],
  sourceRefs: [{ ref: 'user_request_stream' }],
  confidence: 0.99,
  uncertainty: ['Live RDW price unknown until lookup'],
  nextSearchSeedCandidates: ['live_market_data_for_RDW'],
  createdAt: '2026-06-19T17:59:26.921Z',
};

describe('project accepted ThinkGraph records -> graph view (un-islanding)', () => {
  it('projects entities to nodes and relations to edges, carrying sourceRef', () => {
    const view = projectThinkGraphRecordsToGraphView([ACCEPTED]);
    const labels = view.nodes.map((n) => n.label);
    expect(labels).toContain('Redwire Corporation');
    expect(labels).toContain('SpaceX');
    expect(view.nodes.find((n) => n.label === 'Redwire Corporation')?.sourceRef).toBe('magone-rdw-spacex-1');
    expect(view.edges.some((e) => e.source === 'e_rdw_ticker' && e.target === 'e_rdw' && e.type === 'identifies')).toBe(true);
    // every node/edge carries the canonical fields the tab needs
    expect(view.nodes.every((n) => n.id && n.label)).toBe(true);
    expect(view.edges.every((e) => e.id && e.source && e.target && e.label)).toBe(true);
  });

  it('returns honest empty for no records', () => {
    expect(projectThinkGraphRecordsToGraphView([])).toEqual({ nodes: [], edges: [] });
  });
});

describe('thinkgraph graph-view response (honest empty vs unavailable)', () => {
  it('real records -> source thinkgraph-db with nodes/edges', () => {
    const res = buildThinkGraphGraphViewResponse(ACCEPTED.projectId, { ok: true, records: [ACCEPTED] });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('thinkgraph-db');
    expect(res.projectId).toBe('20ac92d-01fd-4cf6-97cc-0672421e751a');
    expect(res.counts.nodes).toBeGreaterThan(0);
    expect(res.counts.records).toBe(1);
    expect(res.reason).toBeUndefined();
  });

  it('no records -> honest no_thinkgraph_records_for_project (not a failure)', () => {
    const res = buildThinkGraphGraphViewResponse('p', { ok: true, records: [] });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('thinkgraph-db');
    expect(res.nodes).toHaveLength(0);
    expect(res.reason).toBe('no_thinkgraph_records_for_project');
  });

  it('DB failure -> honest unavailable with exact blocker, NOT collapsed to empty', () => {
    const res = buildThinkGraphGraphViewResponse('p', {
      ok: false,
      reason: 'age_query_failed',
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    expect(res.ok).toBe(false);
    expect(res.source).toBe('unavailable');
    expect(res.reason).toBe('thinkgraph_unavailable');
    expect(res.blocker).toContain('ECONNREFUSED');
  });

  it('introduces no draft-generator naming', () => {
    expect(JSON.stringify(buildThinkGraphGraphViewResponse('p', { ok: true, records: [ACCEPTED] })).toLowerCase()).not.toContain('draft');
  });
});
