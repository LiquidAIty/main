import { describe, expect, it } from 'vitest';

import type { DeckRun } from '../../../types/agentgraph';
import {
  __test,
  buildPlanFlowMissionGraph,
  projectRealMagenticPlans,
  PLAN_CANVAS_RUN_TASK_NODE_ID,
  PLAN_CANVAS_TASK_LEDGER_NODE_ID,
} from './planFlowProjection';

function runWithPlan(plan: Record<string, unknown>): DeckRun {
  return {
    id: 'run-1',
    steps: [{ id: 'step-1', title: 'Magentic-One', magenticTrace: { plan } }],
  } as DeckRun;
}

describe('Plan canvas projection — deterministic [Task Ledger Planning] -> [Run Task]', () => {
  it('always renders only the Task Ledger Planning and Run Task structure', () => {
    for (const graph of [
      buildPlanFlowMissionGraph(null),
      buildPlanFlowMissionGraph({ id: 'r', steps: [] } as unknown as DeckRun),
      buildPlanFlowMissionGraph(runWithPlan({ task_ledger: { user_goal: 'g', plan: 'p' } })),
    ]) {
      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.map((node) => node.id).sort()).toEqual(
        [PLAN_CANVAS_RUN_TASK_NODE_ID, PLAN_CANVAS_TASK_LEDGER_NODE_ID].sort(),
      );
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        source: PLAN_CANVAS_TASK_LEDGER_NODE_ID,
        target: PLAN_CANVAS_RUN_TASK_NODE_ID,
      });
    }
  });

  it('never projects progress/result/agent-runtime lanes onto the Plan canvas', () => {
    const graph = buildPlanFlowMissionGraph(
      runWithPlan({
        task_ledger: { user_goal: 'audit', plan: '1. read' },
        progress_ledger: {
          progress_summary: 'started',
          next_action: 'run audit',
          task_result: 'done',
          next_spec_candidate: 'next',
        },
      }),
    );
    const kinds = graph.nodes.map((node) => node.data.kind);
    expect(kinds).toEqual(['TaskLedger', 'RunTask']);
    for (const forbidden of [
      'ProgressLedger',
      'TaskResult',
      'SelectedAction',
      'NextSpecCandidate',
      'CurrentSpec',
      'RuntimeRun',
      'MagOneTraceEvent',
    ]) {
      expect(kinds).not.toContain(forbidden);
    }
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

  it('keeps Run Task disabled and Task Ledger waiting before a real Task Ledger exists', () => {
    const graph = buildPlanFlowMissionGraph(null);
    const taskLedger = graph.nodes.find((n) => n.id === PLAN_CANVAS_TASK_LEDGER_NODE_ID);
    const runTask = graph.nodes.find((n) => n.id === PLAN_CANVAS_RUN_TASK_NODE_ID);
    expect(taskLedger?.data.label).toBe('Task Ledger Planning');
    expect(taskLedger?.data.summary).toContain('Preparing the Task Ledger');
    expect(taskLedger?.data.payloadJson).toBeUndefined();
    expect(runTask?.data.label).toBe('Run Task');
    expect(runTask?.data.isRunTaskNode).toBe(true);
    expect(runTask?.data.runnable).toBe(false);
  });

  it('enables Run Task and fills Task Ledger Planning from the real Magentic-One Task Ledger', () => {
    const graph = buildPlanFlowMissionGraph(
      runWithPlan({
        task_ledger: { user_goal: 'Audit code', plan: '1. Inspect evidence\n2. Run proof' },
      }),
    );
    const taskLedger = graph.nodes.find((n) => n.id === PLAN_CANVAS_TASK_LEDGER_NODE_ID);
    const runTask = graph.nodes.find((n) => n.id === PLAN_CANVAS_RUN_TASK_NODE_ID);
    expect(taskLedger?.data.summary).toContain('Goal: Audit code');
    expect(taskLedger?.data.summary).toContain('1. Inspect evidence');
    expect(taskLedger?.data.payloadJson).toContain('"user_goal"');
    expect(taskLedger?.data.editable).toBe(false);
    expect(runTask?.data.runnable).toBe(true);
    expect(runTask?.data.status).toBe('ready');
  });

  it('treats a bare proposed_action as runnable even without a task_ledger', () => {
    const graph = buildPlanFlowMissionGraph(
      runWithPlan({ proposed_action: { next_actor: 'LocalCoder' } }),
    );
    const runTask = graph.nodes.find((n) => n.id === PLAN_CANVAS_RUN_TASK_NODE_ID);
    expect(runTask?.data.runnable).toBe(true);
  });

  it('uses the latest runnable plan in the deck run', () => {
    const run = {
      id: 'run-2',
      steps: [
        { id: 's1', title: 'Mag One', magenticTrace: { plan: { task_ledger: { user_goal: 'old' } } } },
        { id: 's2', title: 'Mag One', magenticTrace: { plan: { task_ledger: { user_goal: 'new', plan: 'do it' } } } },
      ],
    } as unknown as DeckRun;
    const taskLedger = buildPlanFlowMissionGraph(run).nodes.find(
      (n) => n.id === PLAN_CANVAS_TASK_LEDGER_NODE_ID,
    );
    expect(taskLedger?.data.summary).toContain('Goal: new');
  });

  it('does not fabricate plan content when task_ledger.plan is missing', () => {
    const taskLedger = buildPlanFlowMissionGraph(
      runWithPlan({ task_ledger: { user_goal: 'g' } }),
    ).nodes.find((n) => n.id === PLAN_CANVAS_TASK_LEDGER_NODE_ID);
    expect(taskLedger?.data.summary).toContain('Plan: (none returned)');
    expect(__test.readTaskLedgerPlan({ user_goal: 'g' })).toBe('');
  });
});

describe('projectRealMagenticPlans — rich Progress-canvas projection (not the Plan canvas)', () => {
  it('returns an empty projection before Mag One returns anything', () => {
    const projection = projectRealMagenticPlans(null);
    expect(projection.nodes).toHaveLength(0);
    expect(projection.edges).toHaveLength(0);
  });

  it('renders a TaskLedger node from real task_ledger and surfaces task_ledger.plan', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({
        task_ledger: { user_goal: 'Audit code', plan: '1. Inspect evidence\n2. Run proof' },
      }),
    );
    const taskLedger = projection.nodes.find((node) => node.type === 'TaskLedger');
    expect(taskLedger).toBeTruthy();
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

  it('renders a ProgressLedger node from real progress_ledger', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({
        progress_ledger: { progress_summary: 'started', next_action: 'run audit' },
      }),
    );
    const progress = projection.nodes.find((node) => node.type === 'ProgressLedger');
    expect(progress?.title).toBe('ProgressLedger');
    expect(progress?.summary).toContain('run audit');
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
});
