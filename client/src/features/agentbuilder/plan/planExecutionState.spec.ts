import { describe, expect, it } from 'vitest';
import {
  completePlanExecutionState,
  createPlanExecutionState,
  formatPlanExecutionStatusMessage,
} from './planExecutionState';
import type { CodingRunLifecycle, ConsoleSessionInfo } from '../console/openClaudeConsoleClient';

function lifecycle(overrides: Partial<CodingRunLifecycle> = {}): CodingRunLifecycle {
  return {
    id: 'coding_run_1',
    projectId: 'project-1',
    targetRoot: 'C:\\Projects\\main',
    userGoal: 'Inspect the repo.',
    generatedSpec: 'COMPACT CODER TASK',
    sessionId: 'occ_1',
    status: 'completed',
    resultSummary: 'Read-only inspection complete.',
    proofCommands: ['rg Coder Console'],
    proofFiles: ['apps/backend/src/routes/coder.routes.ts'],
    validatedCoderReport: false,
    coderReport: null,
    blocker: null,
    memoryRecordStatus: 'recorded',
    memoryRecordDetail: 'ThinkGraph run outcome recorded.',
    ...overrides,
  };
}

describe('Plan execution state', () => {
  it('anchors the SPEC and coding run reference to Plan Surface', () => {
    const state = createPlanExecutionState({
      projectId: 'project-1',
      userGoal: 'Inspect the repo.',
      specPrompt: 'Inspect the repo.',
      targetRoot: 'C:\\Projects\\main',
      codingRunId: 'coding_run_1',
      consoleSessionId: 'occ_1',
      resultStatusUrl: '/api/coder/openclaude/console/runs/coding_run_1',
    });
    expect(state.plan_surface_id).toBe('plan-surface:project-1');
    expect(state.coding_run_id).toBe('coding_run_1');
    expect(state.spec_prompt).toBe('Inspect the repo.');
    expect(state.target_root).toBe('C:\\Projects\\main');
  });

  it('converts completion into a transcript-derived TaskResult and status message', () => {
    const started = createPlanExecutionState({
      projectId: 'project-1',
      userGoal: 'Inspect the repo.',
      specPrompt: 'Inspect the repo.',
      targetRoot: 'C:\\Projects\\main',
      codingRunId: 'coding_run_1',
      resultStatusUrl: '/api/coder/openclaude/console/runs/coding_run_1',
    });
    const completed = completePlanExecutionState(started, {
      run: lifecycle(),
      session: { exitCode: 0 } as ConsoleSessionInfo,
    });
    expect(completed.task_result).toMatchObject({
      task: 'Inspect the repo.',
      status: 'completed',
      blocker_or_issue: null,
      validated_coder_report: false,
      transcript_derived: true,
    });
    expect(completed.task_result?.proof).toContain('file: apps/backend/src/routes/coder.routes.ts');
    expect(formatPlanExecutionStatusMessage(completed)).toContain('Plan Surface task result: completed');
    expect(formatPlanExecutionStatusMessage(completed)).toContain('ThinkGraph: recorded');
  });

  it('keeps failed memory and run blockers visible in TaskResult', () => {
    const started = createPlanExecutionState({
      projectId: 'project-1',
      userGoal: 'Inspect the repo.',
      specPrompt: 'Inspect the repo.',
      targetRoot: 'C:\\Projects\\main',
      codingRunId: 'coding_run_1',
      resultStatusUrl: '/api/coder/openclaude/console/runs/coding_run_1',
    });
    const blocked = completePlanExecutionState(started, {
      run: lifecycle({
        status: 'blocked',
        blocker: 'Target root missing.',
        memoryRecordStatus: 'failed',
        memoryRecordDetail: 'ThinkGraph unavailable.',
      }),
      session: null,
    });
    expect(blocked.task_result?.blocker_or_issue).toBe('Target root missing.');
    expect(blocked.task_result?.next_needed).toBe('Target root missing.');
    expect(formatPlanExecutionStatusMessage(blocked)).toContain('ThinkGraph: failed - ThinkGraph unavailable.');
  });
});
