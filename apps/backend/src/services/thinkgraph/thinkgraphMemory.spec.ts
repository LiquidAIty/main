import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../graphService', () => ({
  runCypherOnGraph: vi.fn(),
}));

import { runCypherOnGraph } from '../graphService';
import {
  readRecentThinkGraphSemanticRecords,
  readThinkGraphContextPacket,
  readThinkGraphSemanticRecord,
  recordThinkGraphEvent,
} from './thinkgraphMemory';

const runCypher = vi.mocked(runCypherOnGraph);

describe('ThinkGraph real event memory', () => {
  beforeEach(() => {
    runCypher.mockReset();
  });

  it('writes a real PlanFlow event and links its provenance-backed node ids', async () => {
    runCypher.mockResolvedValue([]);

    await recordThinkGraphEvent({
      projectId: 'project-1',
      eventType: 'planflow_loaded_from_markdown',
      title: 'PlanFlow loaded',
      summary: 'Projected PLAN.md and active job state',
      status: 'complete',
      planFlowNodeIds: ['planflow:route:plan-md', 'planflow:active-job:runtime'],
      contextEvidenceSummary: ['CBM status: fresh'],
      cbmStatus: 'fresh',
      codeAnchors: ['apps/backend/src/routes/coder.routes.ts'],
      cbmBlocker: '',
      sourceDiagnosticsSummary: ['codegraph_cbm: ok; elapsedMs=20; evidenceCount=3'],
      plannerProvider: 'openai',
      plannerModel: 'gpt-5.1-chat-latest',
      plannerConfigSource: 'SOL_PRIMARY',
    });

    expect(runCypher).toHaveBeenCalledTimes(2);
    expect(runCypher.mock.calls[0]?.[2]).toMatchObject({
      projectId: 'project-1',
      eventType: 'planflow_loaded_from_markdown',
      planFlowNodeIds: ['planflow:route:plan-md', 'planflow:active-job:runtime'],
      contextEvidenceSummary: ['CBM status: fresh'],
      cbmStatus: 'fresh',
      codeAnchors: ['apps/backend/src/routes/coder.routes.ts'],
      sourceDiagnosticsSummary: ['codegraph_cbm: ok; elapsedMs=20; evidenceCount=3'],
      plannerProvider: 'openai',
      plannerModel: 'gpt-5.1-chat-latest',
      plannerConfigSource: 'SOL_PRIMARY',
    });
    expect(String(runCypher.mock.calls[1]?.[1])).toContain('LINKS_PLANFLOW_NODE');
  });

  it('reads recent events, linked PlanFlow ids, and real run events without fake planner data', async () => {
    runCypher.mockResolvedValue([
      JSON.stringify({
        id: 'event-1',
        ts: '2026-06-12T00:00:00.000Z',
        event_type: 'run_completed',
        title: 'run completed: deck',
        summary: 'Real final output',
        planflow_node_ids: ['planflow:active-job:runtime'],
        deck_id: 'deck',
        deck_title: 'Deck',
        status: 'success',
        final_output: 'Real final output',
      }),
    ]);

    const packet = await readThinkGraphContextPacket('project-1');

    expect(packet.planflow_nodes).toEqual(['planflow:active-job:runtime']);
    expect(packet.recent_events).toHaveLength(1);
    expect(packet.last_runs).toHaveLength(1);
    expect(packet.recent_events[0]).not.toHaveProperty('planner_source');
  });

  it('reads summarized CoderPacket and CoderReport reconciliation fields', async () => {
    runCypher.mockResolvedValue([
      JSON.stringify({
        id: 'event-coder-report',
        ts: '2026-06-13T00:00:00.000Z',
        event_type: 'coder_report_recorded',
        title: 'CoderReport partial',
        summary: 'One requirement remains.',
        status: 'blocked',
        coder_packet_id: 'packet-1',
        coder_packet_objective: 'Wire PlanFlow.',
        coder_report_status: 'partial',
        completed_requirements: ['PlanFlow UI'],
        incomplete_requirements: ['CodeGraph reader'],
        blocked_requirements: ['Fresh CBM context'],
        changed_requirements: [],
        out_of_scope_findings: ['Unrelated issue'],
        proof_summary: ['passed: focused tests'],
        context_evidence_summary: ['CBM status: stale'],
        cbm_status: 'stale',
        code_anchors: ['apps/backend/src/services/graphContext/graphContextBuilder.ts'],
        cbm_blocker: 'cbm_freshness_unverified: tracked changes',
        source_diagnostics_summary: ['codegraph_cbm: blocked; elapsedMs=20; evidenceCount=0'],
        planner_provider: 'openai',
        planner_model: 'gpt-5.1-chat-latest',
        planner_config_source: 'SOL_PRIMARY',
        next_task: 'Wire CodeGraph reader.',
      }),
    ]);

    const packet = await readThinkGraphContextPacket('project-1');

    expect(packet.recent_events[0]).toMatchObject({
      coder_packet_id: 'packet-1',
      coder_report_status: 'partial',
      completed_requirements: ['PlanFlow UI'],
      blocked_requirements: ['Fresh CBM context'],
      proof_summary: ['passed: focused tests'],
      context_evidence_summary: ['CBM status: stale'],
      cbm_status: 'stale',
      code_anchors: ['apps/backend/src/services/graphContext/graphContextBuilder.ts'],
      cbm_blocker: 'cbm_freshness_unverified: tracked changes',
      source_diagnostics_summary: ['codegraph_cbm: blocked; elapsedMs=20; evidenceCount=0'],
      planner_provider: 'openai',
      planner_model: 'gpt-5.1-chat-latest',
      planner_config_source: 'SOL_PRIMARY',
    });
  });
});

// NOTE: these are MOCKED-DB unit tests of the read-back contract — NOT a live DB
// persistence proof (that is the roundtrip probe against real thinkgraph_liq).
describe('ThinkGraph semantic-record read-back (mocked DB)', () => {
  beforeEach(() => {
    runCypher.mockReset();
  });

  const storedRow = JSON.stringify({
    id: 'tgsem:slm-roundtrip-test:abc',
    project_id: 'slm-roundtrip-test',
    source_ref: 'rt-1',
    created_by: 'slmGraphWorker',
    target_graph: 'thinkgraph',
    entities_json: JSON.stringify([{ id: 'e1', label: 'Local Gemma', type: 'Model' }]),
    relations_json: JSON.stringify([{ from: 'e1', to: 'owl-extraction', type: 'performs' }]),
    categories: ['local_model_worker'],
    source_refs_json: JSON.stringify([{ ref: 'rt-1' }]),
    confidence: 0.85,
    uncertainty: ['0.15'],
    ts: '2026-06-19T00:00:00.000Z',
  });

  it('queries thinkgraph_liq by project_id + source_ref and returns the stored record', async () => {
    runCypher.mockResolvedValue([storedRow]);
    const res = await readThinkGraphSemanticRecord({ projectId: 'slm-roundtrip-test', sourceRef: 'rt-1' });

    // queried the same graph + label + identity the write path uses
    expect(runCypher.mock.calls[0]?.[0]).toBe('thinkgraph_liq');
    expect(String(runCypher.mock.calls[0]?.[1])).toContain('SlmGraphRecord');
    expect(runCypher.mock.calls[0]?.[2]).toEqual({ projectId: 'slm-roundtrip-test', sourceRef: 'rt-1' });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.entities[0].label).toBe('Local Gemma');
    expect(res.record.entities[0].type).toBe('Model');
    expect(res.record.relations[0].from).toBe('e1');
    expect(res.record.relations[0].to).toBe('owl-extraction');
    expect(res.record.relations[0].type).toBe('performs');
    expect(res.record.categories).toContain('local_model_worker');
    expect(res.record.sourceRef).toBe('rt-1');
  });

  it('returns honest not_found when no row matches', async () => {
    runCypher.mockResolvedValue([]);
    const res = await readThinkGraphSemanticRecord({ projectId: 'p', sourceRef: 'missing' });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns honest age_query_failed when the AGE query throws', async () => {
    runCypher.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const res = await readThinkGraphSemanticRecord({ projectId: 'p', sourceRef: 'rt-1' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('age_query_failed');
    expect(res.error).toContain('ECONNREFUSED');
  });

  it('does not query when identity is incomplete (honest not_found)', async () => {
    const res = await readThinkGraphSemanticRecord({ projectId: '', sourceRef: 'rt-1' });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    expect(runCypher).not.toHaveBeenCalled();
  });
});

// Un-islanding: accepted :SlmGraphRecord graphPayloads must be readable as PROJECT context
// (recent list), not only by exact sourceRef, so grounding can surface them.
describe('ThinkGraph accepted-record list read-back (mocked DB)', () => {
  beforeEach(() => {
    runCypher.mockReset();
  });

  const acceptedRow = JSON.stringify({
    id: 'tgsem:magone-graphpayload-test:abc',
    project_id: 'magone-graphpayload-test',
    source_ref: 'magone-rdw-spacex-1',
    created_by: 'slmGraphWorker',
    target_graph: 'thinkgraph',
    entities_json: JSON.stringify([
      { id: 'e_rdw', label: 'Redwire Corporation', type: 'company', confidence: 0.99 },
      { id: 'e_spacex', label: 'SpaceX', type: 'company', confidence: 0.99 },
    ]),
    relations_json: JSON.stringify([{ from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies' }]),
    categories: ['market_research'],
    source_refs_json: JSON.stringify([{ ref: 'user_request_stream', type: 'user' }]),
    confidence: 0.99,
    uncertainty: ['Live RDW price unknown until lookup'],
    next_search_seed_candidates: ['live_market_data_for_RDW', 'private_market_sources_for_SpaceX'],
    ts: '2026-06-19T17:59:26.921Z',
  });

  it('surfaces recent accepted :SlmGraphRecord records by project_id, with seeds preserved', async () => {
    runCypher.mockResolvedValue([acceptedRow]);
    const res = await readRecentThinkGraphSemanticRecords({ projectId: 'magone-graphpayload-test', limit: 5 });

    expect(runCypher.mock.calls[0]?.[0]).toBe('thinkgraph_liq');
    expect(String(runCypher.mock.calls[0]?.[1])).toContain('SlmGraphRecord');
    expect(runCypher.mock.calls[0]?.[2]).toEqual({ projectId: 'magone-graphpayload-test' });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.records).toHaveLength(1);
    const r = res.records[0];
    expect(r.entities.map((e) => e.label)).toEqual(['Redwire Corporation', 'SpaceX']);
    expect(r.relations[0].type).toBe('identifies');
    expect(r.sourceRef).toBe('magone-rdw-spacex-1');
    expect(r.uncertainty).toContain('Live RDW price unknown until lookup');
    expect(r.nextSearchSeedCandidates).toContain('live_market_data_for_RDW');
  });

  it('returns honest empty (ok, no query) when projectId is missing', async () => {
    const res = await readRecentThinkGraphSemanticRecords({ projectId: '' });
    expect(res).toEqual({ ok: true, records: [] });
    expect(runCypher).not.toHaveBeenCalled();
  });

  it('returns honest age_query_failed when the AGE query throws', async () => {
    runCypher.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const res = await readRecentThinkGraphSemanticRecords({ projectId: 'p' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('age_query_failed');
    expect(res.error).toContain('ECONNREFUSED');
  });
});
