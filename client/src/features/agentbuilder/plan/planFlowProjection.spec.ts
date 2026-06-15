import { describe, expect, it } from 'vitest';

import type { DeckRun } from '../../../types/agentgraph';
import {
  __test,
  buildPlanFlowMissionGraph,
  projectRealMagenticPlans,
} from './planFlowProjection';

function runWithPlan(plan: Record<string, unknown>): DeckRun {
  return {
    id: 'run-1',
    steps: [{ id: 'step-1', title: 'Magentic-One', magenticTrace: { plan } }],
  } as DeckRun;
}

describe('PlanFlow projection adapter — real Mag One ledger canvas', () => {
  it('returns an empty canvas before Mag One returns anything', () => {
    expect(buildPlanFlowMissionGraph(null)).toEqual({ nodes: [], edges: [] });
    expect(buildPlanFlowMissionGraph({ id: 'r', steps: [] } as unknown as DeckRun)).toEqual({
      nodes: [],
      edges: [],
    });
    const projection = projectRealMagenticPlans(null);
    expect(projection.nodes).toHaveLength(0);
    expect(projection.edges).toHaveLength(0);
  });

  it('never projects a PLAN.md / plan_md node onto the canvas', () => {
    const graph = buildPlanFlowMissionGraph(
      runWithPlan({ task_ledger: { user_goal: 'audit', plan: '1. read' } }),
    );
    expect(graph.nodes.every((node) => node.data.source === 'magentic_one')).toBe(true);
    expect(graph.nodes.some((node) => node.data.source === 'plan_md')).toBe(false);
    expect(
      graph.nodes.some((node) => String(node.data.label).includes('Living Plan')),
    ).toBe(false);
  });

  it('renders a TaskLedger node from real task_ledger and surfaces task_ledger.plan', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({
        task_ledger: { user_goal: 'Audit code', plan: '1. Inspect evidence\n2. Run proof' },
      }),
    );
    const taskLedger = projection.nodes.find((node) => node.type === 'TaskLedger');
    expect(taskLedger).toBeTruthy();
    expect(taskLedger?.title).toBe('TaskLedger');
    expect(taskLedger?.summary).toContain('1. Inspect evidence');
    expect(taskLedger?.payload).toMatchObject({ plan: '1. Inspect evidence\n2. Run proof' });
  });

  it('normalizes the legacy task_plan alias to canonical plan at the boundary only', () => {
    expect(__test.readTaskLedgerPlan({ plan: 'canonical' })).toBe('canonical');
    expect(__test.readTaskLedgerPlan({ task_plan: 'legacy' })).toBe('legacy');
    expect(__test.readTaskLedgerPlan({ plan: 'canonical', task_plan: 'legacy' })).toBe('canonical');

    const projection = projectRealMagenticPlans(
      runWithPlan({ task_ledger: { user_goal: 'g', task_plan: 'legacy line' } }),
    );
    const taskLedger = projection.nodes.find((node) => node.type === 'TaskLedger');
    expect(taskLedger?.summary).toContain('legacy line');
  });

  it('does not fabricate plan content when task_ledger.plan is missing', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({ task_ledger: { user_goal: 'g' } }),
    );
    const taskLedger = projection.nodes.find((node) => node.type === 'TaskLedger');
    expect(taskLedger).toBeTruthy();
    expect(taskLedger?.summary).toContain('Plan: (none returned)');
    expect(__test.readTaskLedgerPlan({ user_goal: 'g' })).toBe('');
  });

  it('renders a ProgressLedger node from real progress_ledger', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({
        progress_ledger: { progress_summary: 'started', next_action: 'run audit' },
      }),
    );
    const progress = projection.nodes.find((node) => node.type === 'ProgressLedger');
    expect(progress?.title).toBe('ProgressLedger');
    expect(progress?.summary).toContain('run audit');
    expect(progress?.payload).toMatchObject({ next_action: 'run audit' });
  });

  it('renders a SelectedAction node only when Mag One selected a next action', () => {
    const withAction = projectRealMagenticPlans(
      runWithPlan({ progress_ledger: { next_actor: 'LocalCoder', next_action: 'run_read_only_coder_task' } }),
    );
    expect(withAction.nodes.some((node) => node.type === 'SelectedAction')).toBe(true);

    const withoutAction = projectRealMagenticPlans(
      runWithPlan({ progress_ledger: { progress_summary: 'thinking' } }),
    );
    expect(withoutAction.nodes.some((node) => node.type === 'SelectedAction')).toBe(false);
  });

  it('renders TaskResult and NextSpecCandidate nodes only when real payload provides them', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({
        progress_ledger: {
          task_result: 'audit complete',
          next_needed: 'review findings',
          next_spec_candidate: 'fix flagged items',
        },
      }),
    );
    expect(projection.nodes.some((node) => node.type === 'TaskResult')).toBe(true);
    expect(projection.nodes.some((node) => node.type === 'NextSpecCandidate')).toBe(true);

    const noResult = projectRealMagenticPlans(
      runWithPlan({ progress_ledger: { progress_summary: 'in progress' } }),
    );
    expect(noResult.nodes.some((node) => node.type === 'TaskResult')).toBe(false);
    expect(noResult.nodes.some((node) => node.type === 'NextSpecCandidate')).toBe(false);
  });

  it('exposes full real payload JSON on mission nodes for the inspector', () => {
    const graph = buildPlanFlowMissionGraph(
      runWithPlan({ task_ledger: { user_goal: 'g', plan: 'p' } }),
    );
    const taskLedger = graph.nodes.find((node) => node.data.kind === 'TaskLedger');
    expect(taskLedger?.data.payloadJson).toContain('"user_goal"');
    expect(taskLedger?.data.editable).toBe(false);
  });
});
