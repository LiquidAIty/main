/**
 * Skill step 12 — feed the real execution TaskResult back into a Magentic-One
 * reasoning turn together with the previous Task Ledger and Progress Ledger.
 *
 * These helpers keep the frontend a caller/renderer, not the planner:
 * `buildResultFeedbackRequest` assembles the request strictly from real objects
 * (no raw user input, no coder packet), and `interpretResultFeedbackResponse`
 * reads Magentic-One's own interpretation without inventing completion state.
 */

export type ResultFeedbackApprovedSpec = {
  task_ledger?: unknown;
  proposed_action?: unknown;
  progress_ledger?: unknown;
  context_packet?: unknown;
};

export type ResultFeedbackRequest = {
  projectId: string;
  targetRoot: string | null;
  taskLedger: unknown;
  progressLedger: unknown;
  runTaskPayload: ResultFeedbackApprovedSpec;
  taskResult: unknown;
  cards: unknown[];
  edges: unknown[];
};

export const RESULT_FEEDBACK_ENDPOINT = '/api/coder/openclaude/console/result_feedback';

/**
 * Builds the result-feedback request body from the approved Task Ledger / Run
 * Task payload and the real TaskResult only. There is intentionally no
 * `userInput` / `userText` / chat-summary field — raw user input is never a
 * fallback source for the feedback turn.
 */
export function buildResultFeedbackRequest(input: {
  projectId: string;
  targetRoot: string | null;
  approvedMissionSpec: ResultFeedbackApprovedSpec;
  taskResult: unknown;
  cards: unknown[];
  edges: unknown[];
}): ResultFeedbackRequest {
  return {
    projectId: input.projectId,
    targetRoot: input.targetRoot,
    taskLedger: input.approvedMissionSpec.task_ledger ?? null,
    progressLedger: input.approvedMissionSpec.progress_ledger ?? null,
    runTaskPayload: input.approvedMissionSpec,
    taskResult: input.taskResult,
    cards: input.cards,
    edges: input.edges,
  };
}

export type ResultFeedbackInterpretation = {
  /** Magentic-One's own plain-language interpretation, or null if none returned. */
  interpretation: string | null;
  /** A revised / next Task Ledger plan, set ONLY when real Mag One output has one. */
  nextPlan: Record<string, unknown> | null;
  error: string | null;
};

function isPlanRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads Magentic-One's result interpretation. TypeScript never fabricates a
 * completion verdict or a plan: the interpretation is used only when Mag One
 * returns real text, and a revised/next Task Ledger updates state only when the
 * returned plan actually contains a `task_ledger`. When Mag One reports complete
 * (no new ledger), `nextPlan` stays null so no fake next work is created.
 */
export function interpretResultFeedbackResponse(response: any): ResultFeedbackInterpretation {
  if (!response || response.ok !== true) {
    return {
      interpretation: null,
      nextPlan: null,
      error: response?.error ? String(response.error) : 'result_feedback_unavailable',
    };
  }
  const interpretation =
    typeof response.interpretation === 'string' && response.interpretation.trim()
      ? response.interpretation
      : null;
  const plan = response.plan;
  const nextPlan = isPlanRecord(plan) && plan.task_ledger ? (plan as Record<string, unknown>) : null;
  return { interpretation, nextPlan, error: null };
}
