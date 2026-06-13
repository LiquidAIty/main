import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../graphService', () => ({
  runCypherOnGraph: vi.fn(),
}));

import { runCypherOnGraph } from '../graphService';
import {
  readThinkGraphContextPacket,
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
