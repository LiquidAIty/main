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

// A real structured Task Ledger as the Python sidecar returns it.
const STRUCTURED_TASK_LEDGER = {
  user_goal: 'Audit code',
  known_facts: ['repo is a monorepo'],
  unknowns_to_lookup: ['test runner config'],
  facts_to_derive: ['module order'],
  assumptions_or_guesses: ['it builds with vite'],
  connected_agents: [
    { id: 'r1', name: 'Research_Agent', role: 'research', tools: ['search'], status: 'planned' },
  ],
  plan_steps: [
    { id: 'step_1', task: 'Inspect evidence', assigned_agent: 'Research_Agent', status: 'planned' },
    { id: 'step_2', task: 'Run proof', assigned_agent: 'Research_Agent', status: 'planned' },
  ],
};

describe('Plan canvas projection — deterministic [Task Ledger Planning] -> [Run Task]', () => {
  it('always renders only the Task Ledger Planning and Run Task structure', () => {
    for (const graph of [
      buildPlanFlowMissionGraph(null),
      buildPlanFlowMissionGraph({ id: 'r', steps: [] } as unknown as DeckRun),
      buildPlanFlowMissionGraph(runWithPlan({ task_ledger: STRUCTURED_TASK_LEDGER })),
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
        task_ledger: STRUCTURED_TASK_LEDGER,
        progress_ledger: {
          progress_state: 'running',
          selected_agent: 'Research_Agent',
          instruction: 'run audit',
          agent_result: 'done',
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
      runWithPlan({ task_ledger: STRUCTURED_TASK_LEDGER }),
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

  it('fills the Task Ledger from the real structured contract (goal, facts, agents, plan steps)', () => {
    const graph = buildPlanFlowMissionGraph(
      runWithPlan({ task_ledger: STRUCTURED_TASK_LEDGER }),
    );
    const taskLedger = graph.nodes.find((n) => n.id === PLAN_CANVAS_TASK_LEDGER_NODE_ID);
    const runTask = graph.nodes.find((n) => n.id === PLAN_CANVAS_RUN_TASK_NODE_ID);
    const summary = String(taskLedger?.data.summary);
    expect(summary).toContain('Goal: Audit code');
    expect(summary).toContain('Facts:');
    expect(summary).toContain('repo is a monorepo');
    expect(summary).toContain('Unknowns:');
    expect(summary).toContain('Assumptions / guesses:');
    expect(summary).toContain('Connected agents:');
    expect(summary).toContain('Research_Agent');
    expect(summary).toContain('tools: search');
    expect(summary).toContain('1. Inspect evidence — Research_Agent [planned]');
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
        { id: 's2', title: 'Mag One', magenticTrace: { plan: { task_ledger: { ...STRUCTURED_TASK_LEDGER, user_goal: 'new' } } } },
      ],
    } as unknown as DeckRun;
    const taskLedger = buildPlanFlowMissionGraph(run).nodes.find(
      (n) => n.id === PLAN_CANVAS_TASK_LEDGER_NODE_ID,
    );
    expect(taskLedger?.data.summary).toContain('Goal: new');
  });

  it('does not fabricate plan content when plan_steps are missing', () => {
    const taskLedger = buildPlanFlowMissionGraph(
      runWithPlan({ task_ledger: { user_goal: 'g' } }),
    ).nodes.find((n) => n.id === PLAN_CANVAS_TASK_LEDGER_NODE_ID);
    expect(taskLedger?.data.summary).toContain('Plan steps: (none returned)');
    expect(__test.formatPlanSteps({ user_goal: 'g' })).toBe('');
  });
});

describe('projectRealMagenticPlans — rich Progress-canvas projection (not the Plan canvas)', () => {
  it('returns an empty projection before Mag One returns anything', () => {
    const projection = projectRealMagenticPlans(null);
    expect(projection.nodes).toHaveLength(0);
    expect(projection.edges).toHaveLength(0);
  });

  it('renders a TaskLedger node from the real structured contract', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({ task_ledger: STRUCTURED_TASK_LEDGER }),
    );
    const taskLedger = projection.nodes.find((node) => node.type === 'TaskLedger');
    expect(taskLedger).toBeTruthy();
    expect(taskLedger?.summary).toContain('1. Inspect evidence — Research_Agent [planned]');
    expect(taskLedger?.payload).toMatchObject({ user_goal: 'Audit code' });
  });

  it('renders a ProgressLedger node from the real progress contract', () => {
    const projection = projectRealMagenticPlans(
      runWithPlan({
        progress_ledger: {
          current_step: '1',
          progress_state: 'running',
          selected_agent: 'Research_Agent',
          instruction: 'run audit read-only',
          events: [{ source: 'Research_Agent', type: 'TextMessage', content: 'scanning' }],
        },
      }),
    );
    const progress = projection.nodes.find((node) => node.type === 'ProgressLedger');
    expect(progress?.title).toBe('ProgressLedger');
    expect(progress?.summary).toContain('State: running');
    expect(progress?.summary).toContain('Selected agent: Research_Agent');
    expect(progress?.summary).toContain('Instruction: run audit read-only');
    const action = projection.nodes.find((node) => node.type === 'SelectedAction');
    expect(action?.summary).toContain('Agent: Research_Agent');
  });

  it('renders an agent-result TaskResult node only when a real result exists', () => {
    const withResult = projectRealMagenticPlans(
      runWithPlan({
        progress_ledger: {
          progress_state: 'completed',
          selected_agent: 'Research_Agent',
          agent_result: 'audit complete',
        },
      }),
    );
    expect(withResult.nodes.some((node) => node.type === 'TaskResult')).toBe(true);

    const noResult = projectRealMagenticPlans(
      runWithPlan({ progress_ledger: { progress_state: 'running' } }),
    );
    expect(noResult.nodes.some((node) => node.type === 'TaskResult')).toBe(false);
  });
});
