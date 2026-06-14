// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ActiveCoderJobPanel from './ActiveCoderJobPanel';

const packet = {
  id: 'packet-1',
  projectId: 'project-1',
  repoPath: 'C:\\Projects\\main',
  objective: 'Wire one active job.',
  planExcerpt: 'Connect PlanFlow Go.',
  contextSummary: 'Backend route exists.',
  codeAnchors: ['client/src/pages/agentbuilder.tsx'],
  cbmQueries: ['search_graph PlanFlow'],
  guardrails: ['No fake success.'],
  allowedFiles: ['client/src/features/agentbuilder/plan/*'],
  forbiddenWork: ['Do not auto-run the next job.'],
  proofRequired: ['Run focused client checks.'],
  reportFormat: 'Make a bounded task list and return a task-by-task CoderReport.',
  stopConditions: ['Stop after one report.'],
  writeMode: 'edit' as const,
};

afterEach(cleanup);

describe('ActiveCoderJobPanel', () => {
  it('receives and displays one prepared active CoderPacket without a paste surface', () => {
    render(
      <ActiveCoderJobPanel
        projectId="project-1"
        preparedPacket={packet}
        preparationStatus="ready"
        preparationMessage="Prepared from real context."
        planSummary="LiquidAIty Living Plan"
      />,
    );

    expect(screen.getByText('Wire one active job.')).toBeTruthy();
    expect(screen.getByText('Go')).toBeTruthy();
    expect(screen.getByLabelText('Active CoderPacket JSON')).toBeTruthy();
    expect(screen.queryByLabelText('CoderPacket JSON')).toBeNull();
    expect(screen.getByText(/PLAN.md: LiquidAIty Living Plan/)).toBeTruthy();
  });

  it('renders canonical Plan execution state and TaskResult', () => {
    render(
      <ActiveCoderJobPanel
        projectId="project-1"
        executionState={{
          plan_surface_id: 'plan-surface:project-1',
          user_goal: 'Inspect the repo.',
          spec_prompt: 'Inspect the repo.',
          coding_run_id: 'coding_run_1',
          console_session_id: 'occ_1',
          target_root: 'C:\\Projects\\main',
          status: 'completed',
          result_status_url: '/api/coder/openclaude/console/runs/coding_run_1',
          proof_files: ['apps/backend/src/routes/coder.routes.ts'],
          blocker: null,
          next_needed: 'Review result.',
          next_spec_candidate: 'Review result.',
          thinkgraph_status: 'recorded',
          exit_code: 0,
          task_result: {
            task: 'Inspect the repo.',
            status: 'completed',
            files_changed: [],
            proof: ['file: apps/backend/src/routes/coder.routes.ts'],
            result: 'Inspection complete.',
            blocker_or_issue: null,
            next_needed: 'Review result.',
            validated_coder_report: false,
            transcript_derived: true,
          },
        }}
      />,
    );
    expect(screen.getByTestId('plan-execution-state').textContent).toContain('coding_run_1');
    expect(screen.getByTestId('plan-task-result').textContent).toContain('Inspection complete.');
  });
});
