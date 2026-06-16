import { describe, expect, it } from 'vitest';

import type { DeckRun } from '../../../types/agentgraph';
import {
  buildPlanFlowMissionGraph,
  projectRealMagenticPlans,
  PLAN_CANVAS_TASK_LEDGER_NODE_ID,
} from './planFlowProjection';

const REAL_ARTIFACT = {
  source: 'autogen_0_7_5_magentic_one',
  phase: 'task_ledger',
  factsResponse: '1. GIVEN OR VERIFIED FACTS\n- repo exists (NONCE_ABC)',
  planResponse: '- inspect the repo read-only',
  taskLedgerResponse: 'Full Task Ledger text referencing NONCE_ABC',
  teamDescription: 'Research_Agent: research',
  modelCallProof: [
    { label: 'facts', provider: 'openrouter', model: 'openai/gpt-5.1-chat', clientClass: 'OpenAIChatCompletionClient', startedAt: 1, finishedAt: 2, latencyMs: 1000, responseType: 'CreateResult', excerpt: '1. GIVEN' },
    { label: 'plan', provider: 'openrouter', model: 'openai/gpt-5.1-chat', clientClass: 'OpenAIChatCompletionClient', startedAt: 2, finishedAt: 3, latencyMs: 1000, responseType: 'CreateResult', excerpt: '- inspect' },
  ],
};

function runWithArtifact(artifact: Record<string, unknown> | null, messages?: any[]): DeckRun {
  return {
    id: 'run-1',
    steps: [
      {
        id: 'step-1',
        title: 'Magentic-One',
        magenticTrace: {
          plan: {
            ...(artifact ? { taskLedgerArtifact: artifact } : {}),
            ...(messages ? { autogenMessages: messages } : {}),
          },
        },
      },
    ],
  } as DeckRun;
}

const FORBIDDEN_STRINGS = [
  'Task Ledger created',
  'PlanCanvas is waiting',
  'Agents included',
  'Steps planned',
  'No execution started',
  'Task Ledger Planning',
  'Preparing the Task Ledger',
  'disabled until Magentic-One returns',
];

describe('Plan canvas — single real Task Ledger artifact viewer only', () => {
  it('returns an empty graph (no filler, no Run Task) when AutoGen returned no artifact', () => {
    for (const graph of [
      buildPlanFlowMissionGraph(null),
      buildPlanFlowMissionGraph({ id: 'r', steps: [] } as unknown as DeckRun),
      buildPlanFlowMissionGraph(runWithArtifact(null)),
    ]) {
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    }
  });

  it('renders exactly one Task Ledger artifact node from the real AutoGen output', () => {
    const graph = buildPlanFlowMissionGraph(runWithArtifact(REAL_ARTIFACT));
    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0];
    expect(node.id).toBe(PLAN_CANVAS_TASK_LEDGER_NODE_ID);
    expect(node.data.kind).toBe('TaskLedger');
    // Verbatim AutoGen content + honest source metadata; the unique nonce survives.
    expect(node.data.summary).toContain('Source: autogen_0_7_5_magentic_one');
    expect(node.data.summary).toContain('Facts model call: completed');
    expect(node.data.summary).toContain('Plan model call: completed');
    expect(node.data.summary).toContain('NONCE_ABC');
    expect(node.data.payloadJson).toContain('modelCallProof');
    expect(node.data.editable).toBe(false);
  });

  it('emits no Run Task gate node (Run Task / Progress Ledger are out of scope)', () => {
    const graph = buildPlanFlowMissionGraph(runWithArtifact(REAL_ARTIFACT));
    expect(graph.nodes.some((n) => n.data.kind === 'RunTask')).toBe(false);
    expect(graph.nodes.some((n) => (n.data as any).isRunTaskNode)).toBe(false);
  });

  it('never emits app-authored fake status/filler strings and never synthesizes plan steps', () => {
    const serialized = JSON.stringify(buildPlanFlowMissionGraph(runWithArtifact(REAL_ARTIFACT)));
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain('plan_steps');
    expect(serialized).not.toContain('connected_agents');
    expect(serialized).not.toContain('assigned_agent');
  });
});

describe('projectRealMagenticPlans — verbatim artifact + messages', () => {
  it('returns an empty projection before AutoGen returns anything', () => {
    expect(projectRealMagenticPlans(null).nodes).toHaveLength(0);
    expect(projectRealMagenticPlans(runWithArtifact(null)).nodes).toHaveLength(0);
  });

  it('emits the artifact node and verbatim message nodes; no Progress Ledger node', () => {
    const projection = projectRealMagenticPlans(
      runWithArtifact(REAL_ARTIFACT, [
        { source: 'MagenticOneOrchestrator', type: 'TextMessage', content: 'ledger NONCE_ABC' },
      ]),
    );
    expect(projection.nodes.some((n) => n.type === 'TaskLedger')).toBe(true);
    expect(projection.nodes.some((n) => n.type === 'AutoGenMessage')).toBe(true);
    expect(projection.nodes.some((n) => n.type === 'ProgressLedger')).toBe(false);
  });
});
