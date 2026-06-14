import type { SurfacedCodingRunResult } from '../console/codingRunResultSurface';

const CACHE_PREFIX = 'liquidaity.plan-execution.';

export type PlanTaskResult = {
  task: string;
  status: 'completed' | 'failed' | 'blocked';
  files_changed: string[];
  proof: string[];
  result: string;
  blocker_or_issue: string | null;
  next_needed: string;
  validated_coder_report: boolean;
  transcript_derived: boolean;
};

export type PlanExecutionState = {
  plan_surface_id: string;
  user_goal: string;
  spec_prompt: string;
  coding_run_id: string;
  console_session_id: string | null;
  target_root: string;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  result_status_url: string;
  task_result: PlanTaskResult | null;
  proof_files: string[];
  blocker: string | null;
  next_needed: string;
  next_spec_candidate: string;
  thinkgraph_status: string;
  exit_code: number | null;
};

export function createPlanExecutionState(input: {
  projectId: string;
  userGoal: string;
  specPrompt: string;
  targetRoot: string;
  codingRunId: string;
  consoleSessionId?: string | null;
  resultStatusUrl: string;
}): PlanExecutionState {
  return {
    plan_surface_id: `plan-surface:${input.projectId}`,
    user_goal: input.userGoal,
    spec_prompt: input.specPrompt,
    coding_run_id: input.codingRunId,
    console_session_id: input.consoleSessionId || null,
    target_root: input.targetRoot,
    status: 'running',
    result_status_url: input.resultStatusUrl,
    task_result: null,
    proof_files: [],
    blocker: null,
    next_needed: 'Wait for the active coding run result.',
    next_spec_candidate: '',
    thinkgraph_status: 'pending',
    exit_code: null,
  };
}

export function completePlanExecutionState(
  current: PlanExecutionState,
  surfaced: SurfacedCodingRunResult,
): PlanExecutionState {
  const { run, session } = surfaced;
  const status = run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'blocked';
  const nextNeeded =
    run.coderReport?.nextRecommendedTask ||
    run.blocker ||
    (status === 'completed' ? 'Review the result and approve the next bounded SPEC.' : 'Resolve the reported blocker.');
  const proof = [
    ...run.proofCommands.map((command) => `command: ${command}`),
    ...run.proofFiles.map((file) => `file: ${file}`),
  ];
  return {
    ...current,
    user_goal: run.userGoal || current.user_goal,
    spec_prompt: run.generatedSpec || current.spec_prompt,
    target_root: run.targetRoot || current.target_root,
    console_session_id: run.sessionId,
    status,
    task_result: {
      task: current.user_goal,
      status,
      files_changed: run.coderReport?.filesChanged || [],
      proof,
      result: run.resultSummary || 'No result summary returned.',
      blocker_or_issue: run.blocker,
      next_needed: nextNeeded,
      validated_coder_report: run.validatedCoderReport,
      transcript_derived: !run.validatedCoderReport,
    },
    proof_files: run.proofFiles,
    blocker: run.blocker,
    next_needed: nextNeeded,
    next_spec_candidate: nextNeeded,
    thinkgraph_status: `${run.memoryRecordStatus}${run.memoryRecordDetail ? ` - ${run.memoryRecordDetail}` : ''}`,
    exit_code: session?.exitCode ?? null,
  };
}

export function readCachedPlanExecutionState(projectId: string): PlanExecutionState | null {
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${projectId}`);
    return raw ? (JSON.parse(raw) as PlanExecutionState) : null;
  } catch {
    return null;
  }
}

export function cachePlanExecutionState(state: PlanExecutionState): void {
  window.localStorage.setItem(`${CACHE_PREFIX}${state.plan_surface_id.replace('plan-surface:', '')}`, JSON.stringify(state));
}

export function blockPlanExecutionState(
  current: PlanExecutionState,
  blocker: string,
): PlanExecutionState {
  const nextNeeded = blocker || 'Resolve coding-run result collection blocker.';
  return {
    ...current,
    status: 'blocked',
    blocker,
    next_needed: nextNeeded,
    next_spec_candidate: nextNeeded,
    task_result: {
      task: current.spec_prompt,
      status: 'blocked',
      files_changed: [],
      proof: [],
      result: 'Coding-run result collection blocked.',
      blocker_or_issue: blocker,
      next_needed: nextNeeded,
      validated_coder_report: false,
      transcript_derived: false,
    },
  };
}

export function formatPlanExecutionChatMirror(state: PlanExecutionState): string {
  const taskResult = state.task_result;
  if (!taskResult) {
    return `Plan Surface started coding run ${state.coding_run_id}. Result status: ${state.result_status_url}`;
  }
  const lines = [
    `Plan Surface task result: ${taskResult.status}`,
    `Coding run: ${state.coding_run_id}`,
    `Code Console session: ${state.console_session_id || 'unavailable'}`,
    `Exit code: ${state.exit_code ?? 'unavailable'}`,
    `Result source: ${taskResult.transcript_derived ? 'transcript-derived result' : 'validated CoderReport'}`,
    `Validated CoderReport: ${String(taskResult.validated_coder_report)}`,
    `Summary: ${taskResult.result}`,
    `Proof files: ${state.proof_files.length > 0 ? state.proof_files.join(', ') : 'none reported'}`,
    `ThinkGraph: ${state.thinkgraph_status}`,
    `Next needed: ${taskResult.next_needed}`,
  ];
  if (taskResult.blocker_or_issue) lines.push(`Blocker: ${taskResult.blocker_or_issue}`);
  return lines.join('\n');
}
