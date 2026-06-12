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
      summary: 'Projected PLAN.md and specs',
      status: 'complete',
      planFlowNodeIds: ['planflow:route:plan-md', 'planflow:spec:runtime'],
    });

    expect(runCypher).toHaveBeenCalledTimes(2);
    expect(runCypher.mock.calls[0]?.[2]).toMatchObject({
      projectId: 'project-1',
      eventType: 'planflow_loaded_from_markdown',
      planFlowNodeIds: ['planflow:route:plan-md', 'planflow:spec:runtime'],
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
        planflow_node_ids: ['planflow:spec:runtime'],
        deck_id: 'deck',
        deck_title: 'Deck',
        status: 'success',
        final_output: 'Real final output',
      }),
    ]);

    const packet = await readThinkGraphContextPacket('project-1');

    expect(packet.planflow_nodes).toEqual(['planflow:spec:runtime']);
    expect(packet.recent_events).toHaveLength(1);
    expect(packet.last_runs).toHaveLength(1);
    expect(packet.recent_events[0]).not.toHaveProperty('planner_source');
  });
});
