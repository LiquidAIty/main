import { describe, expect, it } from 'vitest';

import type { DeckRun } from '../../../types/agentgraph';
import {
  buildPlanFlowMissionGraph,
  buildPlanFlowGoGateState,
  buildPlanStepCardView,
  projectRealMagenticPlans,
} from './planFlowProjection';

// Realistic real-AutoGen Task Ledger artifact: a 5-step planResponse, plus the
// facts / full-ledger / proof fields that must NEVER leak onto PlanFlow nodes.
const REAL_ARTIFACT = {
  source: 'autogen_0_7_5_magentic_one',
  phase: 'task_ledger',
  factsResponse: '1. GIVEN OR VERIFIED FACTS\n- repo exists (NONCE_ABC)',
  planResponse: [
    '1. Audit signal sources',
    '2. Check data path',
    '3. Review UI wiring',
    '4. Write repair SPEC',
    '5. Verify proof',
  ].join('\n'),
  taskLedgerResponse: 'Full Task Ledger text referencing NONCE_ABC',
  teamDescription: 'Research_Agent: research',
  modelCallProof: [
    { label: 'facts', provider: 'openrouter', model: 'openai/gpt-5.1-chat', excerpt: '1. GIVEN' },
    { label: 'plan', provider: 'openrouter', model: 'openai/gpt-5.1-chat', excerpt: '- inspect' },
  ],
};

function runWithArtifact(artifact: Record<string, unknown> | null, extraPlan?: Record<string, unknown>): DeckRun {
  return {
    id: 'run-1',
    steps: [
      {
        id: 'step-1',
        title: 'Magentic-One',
        magenticTrace: {
          plan: {
            ...(artifact ? { taskLedgerArtifact: artifact } : {}),
            ...(extraPlan || {}),
          },
        },
      },
    ],
  } as DeckRun;
}

// PlanFlow nodes are editable step/task objects. They must never carry the Task
// Ledger metadata card / road-sign labels, raw facts/plan/ledger text, or chat
// transcript primitives (finalResponseText / autogenMessages).
const FORBIDDEN_STRINGS = [
  'facts response',
  'plan response:',
  'full ledger',
  'raw internal text',
  'Full Task Ledger',
  'GIVEN OR VERIFIED FACTS',
  'NONCE_ABC',
  'finalResponseText',
  'autogenMessages',
];

describe('buildPlanFlowMissionGraph — editable Step nodes from the real Task Ledger', () => {
  it('returns an empty graph when AutoGen returned no Task Ledger artifact', () => {
    for (const graph of [
      buildPlanFlowMissionGraph(null),
      buildPlanFlowMissionGraph({ id: 'r', steps: [] } as unknown as DeckRun),
      buildPlanFlowMissionGraph(runWithArtifact(null)),
    ]) {
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    }
  });

  it('creates one editable Step node per plan step (5 steps -> 5 nodes)', () => {
    const graph = buildPlanFlowMissionGraph(runWithArtifact(REAL_ARTIFACT));
    expect(graph.nodes).toHaveLength(5);

    graph.nodes.forEach((node, idx) => {
      expect(node.data.kind).toBe('Step');
      expect(node.data.editable).toBe(true);
      expect(node.data.label).toContain(`Step ${idx + 1}`);
      // Detail is short (inspector owns the long text; the canvas stays small).
      expect(String(node.data.description || '').length).toBeLessThanOrEqual(160);
    });

    const labels = graph.nodes.map((n) => n.data.label);
    expect(labels[0]).toContain('Step 1');
    expect(labels[4]).toContain('Step 5');
  });

  it('never leaks Task Ledger metadata, raw artifact text, or chat primitives', () => {
    const serialized = JSON.stringify(
      buildPlanFlowMissionGraph(
        runWithArtifact(REAL_ARTIFACT, {
          autogenMessages: [{ source: 'MagenticOneOrchestrator', content: 'ledger NONCE_ABC' }],
          finalResponseText: 'chat answer NONCE_ABC',
        }),
      ),
    );
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(serialized).not.toContain(forbidden);
    }
    // No single TaskLedger metadata monument and no Run Task gate node.
    expect(serialized).not.toContain('TaskLedger');
    expect(serialized).not.toContain('RunTask');
  });
});

describe('projectRealMagenticPlans — Task projection nodes from the artifact only', () => {
  it('returns an empty projection before AutoGen returns a Task Ledger artifact', () => {
    expect(projectRealMagenticPlans(null).nodes).toHaveLength(0);
    expect(projectRealMagenticPlans(runWithArtifact(null)).nodes).toHaveLength(0);
  });

  it('creates 5 Task projection nodes and ignores chat / finalResponseText', () => {
    const projection = projectRealMagenticPlans(
      runWithArtifact(REAL_ARTIFACT, {
        autogenMessages: [{ source: 'MagenticOneOrchestrator', content: 'ledger NONCE_ABC' }],
        finalResponseText: 'chat answer NONCE_ABC',
      }),
    );
    expect(projection.nodes).toHaveLength(5);
    expect(projection.nodes.every((n) => n.type === 'Task')).toBe(true);
    expect(projection.nodes.some((n) => n.type === 'AutoGenMessage')).toBe(false);
    expect(projection.nodes.some((n) => n.type === 'ProgressLedger')).toBe(false);

    const serialized = JSON.stringify(projection);
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('buildPlanFlowGoGateState — approval gate only, never executes', () => {
  it('asks for a selection when no Step node is selected', () => {
    for (const empty of [null, undefined, {}, { id: '' }, { id: '   ' }]) {
      const state = buildPlanFlowGoGateState(empty as any);
      expect(state.status).toBe('no_selection');
      expect(state.selectedNodeId).toBeNull();
      expect(state.message).toBe('Select a step first.');
      expect(state.executed).toBe(false);
      expect(state.taskComplete).toBe(false);
    }
  });

  it('stages the selected step at the approval gate and stops before execution', () => {
    const state = buildPlanFlowGoGateState({
      id: 'plan-canvas:step:2',
      label: 'Step 2: Check data path',
    });
    expect(state.status).toBe('ready');
    expect(state.selectedNodeId).toBe('plan-canvas:step:2');
    expect(state.selectedTitle).toBe('Step 2: Check data path');
    // Gate stops before the Progress Ledger inner loop.
    expect(state.message).toBe(
      'Run Task unavailable: approved task-node execution is not wired yet.',
    );
    expect(state.executed).toBe(false);
    expect(state.taskComplete).toBe(false);
  });

  it('never carries autogenMessages / finalResponseText / chat as an execution source', () => {
    const serialized = JSON.stringify(
      buildPlanFlowGoGateState({ id: 'plan-canvas:step:1', label: 'Step 1' }),
    );
    expect(serialized).not.toContain('autogenMessages');
    expect(serialized).not.toContain('finalResponseText');
    // No completion / success flags.
    expect(serialized).not.toContain('"executed":true');
    expect(serialized).not.toContain('"taskComplete":true');
    expect(serialized).not.toContain('complete');
  });
});

describe('buildPlanStepCardView — minimal user-facing card, no internal language', () => {
  it('shows only title + short detail + status (never Source: / magentic_one)', () => {
    const view = buildPlanStepCardView({
      label: 'Step 2: Check data path',
      summary: 'trace where signals originate',
      status: 'complete',
      // The card view must drop these from the visible card:
      source: 'magentic_one',
      provenance: 'taskLedgerArtifact.planResponse',
    } as any);
    expect(view.title).toBe('Step 2: Check data path');
    expect(view.detail).toBe('Trace where signals originate');
    expect(view.status).toBe('complete');
    expect(view).not.toHaveProperty('source');
    expect(view).not.toHaveProperty('provenance');
    expect(JSON.stringify(view)).not.toContain('magentic_one');
    expect(JSON.stringify(view)).not.toContain('Source:');
  });

  it('strips internal runtime / agent names from visible card text', () => {
    const samples = [
      {
        label: 'Step 1: Have PlanAgent outline planned actions',
        summary:
          'Have PlanAgent outline what planned AI actions could mean (task sequencing, tool use).',
      },
      {
        label: 'Step 3: If needed, have ThinkGraphAgent map the structure',
        summary:
          'If needed, have ThinkGraphAgent map the conceptual structure to capture meaning.',
      },
      {
        label: 'Step 4: Use KnowGraphAgent only if grounding is required',
        summary:
          'Use KnowGraphAgent only if the concept requires grounding. Source: magentic_one.',
      },
    ];
    const forbidden = [
      'Source:',
      'magentic_one',
      'Magentic-One',
      'AutoGen',
      'PlanAgent',
      'ThinkGraphAgent',
      'KnowGraphAgent',
      'TaskLedger',
      'Task Ledger',
    ];
    for (const sample of samples) {
      const view = buildPlanStepCardView(sample as any);
      const visible = `${view.title}\n${view.detail}`;
      for (const term of forbidden) {
        expect(visible).not.toContain(term);
      }
      // Step numbering survives sanitization.
      expect(view.title).toMatch(/^Step \d+/);
      expect(view.detail.length).toBeGreaterThan(0);
    }
  });

  it('clamps long title and detail so the small card stays readable', () => {
    const view = buildPlanStepCardView({
      label: 'x'.repeat(300),
      summary: 'y'.repeat(400),
    } as any);
    expect(view.title.length).toBeLessThanOrEqual(70);
    expect(view.detail.length).toBeLessThanOrEqual(120);
    expect(view.title.endsWith('…')).toBe(true);
    expect(view.detail.endsWith('…')).toBe(true);
  });

  it('falls back to a safe title and empty detail when fields are missing', () => {
    const view = buildPlanStepCardView({} as any);
    expect(view.title).toBe('Plan Node');
    expect(view.detail).toBe('');
    expect(view.status).toBe('');
  });
});
