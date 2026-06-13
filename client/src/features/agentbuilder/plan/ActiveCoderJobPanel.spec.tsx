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
});
