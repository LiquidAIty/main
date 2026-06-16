import { describe, expect, it } from 'vitest';

import type { DeckRun } from '../../../types/agentgraph';
import {
  buildPlanFlowMissionGraph,
  PLAN_CANVAS_TASK_LEDGER_NODE_ID,
} from './planFlowProjection';
import {
  buildResultFeedbackRequest,
  interpretResultFeedbackResponse,
  RESULT_FEEDBACK_ENDPOINT,
} from './planResultFeedback';

const APPROVED_SPEC = {
  task_ledger: { user_goal: 'Audit code', plan: '1. read' },
  progress_ledger: { progress_summary: 'dispatched', next_actor: 'LocalCoder' },
  proposed_action: { next_action: 'run_read_only_coder_task' },
  context_packet: { summary: 'real context' },
};

const TASK_RESULT = {
  task: 'Audit code',
  status: 'completed' as const,
  files_changed: ['client/src/x.ts'],
  proof: ['command: npx tsc'],
  result: 'audit complete',
  blocker_or_issue: null,
  next_needed: 'review findings',
  validated_coder_report: true,
  transcript_derived: false,
};

describe('result feedback request — skill step 12 payload', () => {
  it('includes the previous Task Ledger', () => {
    const req = buildResultFeedbackRequest({
      projectId: 'p1',
      targetRoot: 'C:/repo',
      approvedMissionSpec: APPROVED_SPEC,
      taskResult: TASK_RESULT,
      cards: [{ runtimeType: 'magentic_one' }],
      edges: [],
    });
    expect(req.taskLedger).toEqual(APPROVED_SPEC.task_ledger);
    expect(req.runTaskPayload).toEqual(APPROVED_SPEC);
  });

  it('includes the previous Progress Ledger when present', () => {
    const req = buildResultFeedbackRequest({
      projectId: 'p1',
      targetRoot: null,
      approvedMissionSpec: APPROVED_SPEC,
      taskResult: TASK_RESULT,
      cards: [],
      edges: [],
    });
    expect(req.progressLedger).toEqual(APPROVED_SPEC.progress_ledger);
  });

  it('omits Progress Ledger as null when not present (no fabrication)', () => {
    const req = buildResultFeedbackRequest({
      projectId: 'p1',
      targetRoot: null,
      approvedMissionSpec: { task_ledger: APPROVED_SPEC.task_ledger },
      taskResult: TASK_RESULT,
      cards: [],
      edges: [],
    });
    expect(req.progressLedger).toBeNull();
  });

  it('includes the real TaskResult', () => {
    const req = buildResultFeedbackRequest({
      projectId: 'p1',
      targetRoot: null,
      approvedMissionSpec: APPROVED_SPEC,
      taskResult: TASK_RESULT,
      cards: [],
      edges: [],
    });
    expect(req.taskResult).toEqual(TASK_RESULT);
  });

  it('never carries a raw user input fallback field', () => {
    const req = buildResultFeedbackRequest({
      projectId: 'p1',
      targetRoot: null,
      approvedMissionSpec: APPROVED_SPEC,
      taskResult: TASK_RESULT,
      cards: [],
      edges: [],
    });
    const keys = Object.keys(req);
    for (const forbidden of ['userInput', 'userText', 'rawInput', 'chatInput', 'chatSummary', 'compactSpec', 'codingWorkflowPacket']) {
      expect(keys).not.toContain(forbidden);
    }
    // The serialized request must not smuggle a chat-summary text primitive.
    expect(JSON.stringify(req)).not.toMatch(/userInput|userText/);
  });

  it('targets the dedicated Magentic-One feedback endpoint', () => {
    expect(RESULT_FEEDBACK_ENDPOINT).toBe('/api/coder/openclaude/console/result_feedback');
  });
});

describe('result feedback interpretation — Mag One decides, TS does not invent', () => {
  it('uses Magentic-One interpretation text when available', () => {
    const out = interpretResultFeedbackResponse({ ok: true, interpretation: 'The audit is complete.' });
    expect(out.interpretation).toBe('The audit is complete.');
    expect(out.error).toBeNull();
  });

  it('does not invent an interpretation when Mag One returns none', () => {
    const out = interpretResultFeedbackResponse({ ok: true, interpretation: '   ' });
    expect(out.interpretation).toBeNull();
    expect(out.nextPlan).toBeNull();
  });

  it('surfaces an honest error (no fabricated completion) when the turn fails', () => {
    const out = interpretResultFeedbackResponse({ ok: false, error: 'PYTHON_AUTOGEN_RAILS_UNAVAILABLE' });
    expect(out.interpretation).toBeNull();
    expect(out.nextPlan).toBeNull();
    expect(out.error).toBe('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  });

  it('updates Plan canvas state only when a revised / next Task Ledger is returned', () => {
    const revised = { task_ledger: { user_goal: 'Fix flagged items', plan: '1. patch' } };
    const out = interpretResultFeedbackResponse({ ok: true, interpretation: 'Next: fix items.', plan: revised });
    expect(out.nextPlan).toEqual(revised);
  });

  it('does not create a next Task Ledger when Magentic-One says complete (no plan/no task_ledger)', () => {
    expect(interpretResultFeedbackResponse({ ok: true, interpretation: 'Complete.' }).nextPlan).toBeNull();
    expect(
      interpretResultFeedbackResponse({ ok: true, interpretation: 'Complete.', plan: { progress_ledger: { is_complete: true } } }).nextPlan,
    ).toBeNull();
  });
});

describe('Plan canvas renders only the real Task Ledger artifact', () => {
  it('renders one artifact viewer (no Run Task gate) from a real Task Ledger artifact', () => {
    const sourceRun = {
      id: 'result-feedback',
      steps: [
        {
          id: 's',
          title: 'Magentic-One',
          magenticTrace: {
            plan: {
              taskLedgerArtifact: {
                source: 'autogen_0_7_5_magentic_one',
                phase: 'task_ledger',
                factsResponse: '1. GIVEN FACTS\n- flagged items exist',
                planResponse: '- address flagged items',
                taskLedgerResponse: 'Full ledger: Fix flagged items',
                teamDescription: 'Research_Agent: research',
                modelCallProof: [],
              },
            },
          },
        },
      ],
    } as unknown as DeckRun;
    const graph = buildPlanFlowMissionGraph(sourceRun);
    expect(graph.nodes.map((n) => n.id)).toEqual([PLAN_CANVAS_TASK_LEDGER_NODE_ID]);
    expect(graph.nodes.map((n) => n.data.kind)).toEqual(['TaskLedger']);
    expect(graph.nodes[0].data.summary).toContain('Fix flagged items');
    expect(graph.nodes.some((n) => n.data.kind === 'RunTask')).toBe(false);
  });
});
