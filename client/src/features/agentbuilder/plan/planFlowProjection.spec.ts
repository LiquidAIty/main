import { describe, expect, it } from 'vitest';
import { buildPlanFlowMissionGraph } from './planFlowProjection';

describe('planFlowProjection', () => {
  it('renders real taskLedgerArtifact.planResponse lines without deterministic rewriting', () => {
    const graph = buildPlanFlowMissionGraph({
      id: 'run-1',
      taskLedgerArtifact: {
        planResponse: [
          'Have PlanAgent outline the approach.',
          'Use ThinkGraphAgent to map dependencies.',
          'Use KnowGraphAgent to ground external facts.',
        ].join('\n'),
      },
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].data.title).toBe('Have PlanAgent outline the approach.');
    expect(graph.nodes[1].data.title).toBe('Use ThinkGraphAgent to map dependencies.');
    expect(graph.nodes[2].data.title).toBe('Use KnowGraphAgent to ground external facts.');
  });

  it('does not create PlanFlow nodes from finalResponseText, autogenMessages, or chat text', () => {
    const graph = buildPlanFlowMissionGraph({
      id: 'run-2',
      result: {
        finalResponseText: 'This must not become a task.',
        autogenMessages: [{ content: 'This must not become a task either.' }],
      },
    });

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
