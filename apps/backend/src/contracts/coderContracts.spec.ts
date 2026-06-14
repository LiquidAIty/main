import { describe, expect, it } from 'vitest';
import {
  compareCoderReportToPacket,
  parseCodingRunLifecycle,
  parseCoderPacket,
  parseCoderReport,
} from './coderContracts';

const packet = {
  id: 'packet-1',
  projectId: 'project-1',
  repoPath: 'C:\\Projects\\main',
  objective: 'Wire the adapter.',
  planExcerpt: 'Build the first real loop.',
  contextSummary: 'LocalCoder is vendored.',
  codeAnchors: ['apps/backend/src/coder'],
  cbmQueries: ['search_graph LocalCoder'],
  guardrails: ['No fake success.'],
  allowedFiles: ['apps/backend/src/coder/**'],
  forbiddenWork: ['Do not create specs/.'],
  proofRequired: ['Run backend compile.'],
  reportFormat: 'CoderReport JSON',
  stopConditions: ['Stop after one job.'],
};

describe('coder contracts', () => {
  it('validates a complete CoderPacket', () => {
    expect(parseCoderPacket(packet)).toEqual(packet);
  });

  it('rejects an incomplete CoderPacket', () => {
    expect(() => parseCoderPacket({ id: 'packet-1' })).toThrow();
  });

  it('validates the small coding-run lifecycle contract', () => {
    expect(parseCodingRunLifecycle({
      id: 'run-1',
      projectId: 'project-1',
      targetRoot: 'C:\\Projects\\main',
      userGoal: 'Inspect code.',
      generatedSpec: 'Read-only inspection.',
      editMode: 'read_only',
      sessionId: null,
      provider: null,
      model: null,
      status: 'awaiting_approval',
      resultSummary: '',
      proofCommands: [],
      proofFiles: [],
      validatedCoderReport: false,
      coderReport: null,
      blocker: null,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
      completedAt: null,
      memoryRecordStatus: 'pending',
      memoryRecordDetail: '',
    }).status).toBe('awaiting_approval');
  });

  it('validates and compares a CoderReport', () => {
    const report = parseCoderReport({
      coderPacketId: 'packet-1',
      status: 'succeeded',
      summary: 'Complete.',
      specComparison: [
        {
          requirement: 'Wire the adapter.',
          status: 'satisfied',
          evidence: 'Adapter exists.',
        },
      ],
      filesChanged: ['apps/backend/src/coder/localcoder/adapter.ts'],
      proofCommands: ['npx tsc -p apps/backend/tsconfig.app.json --noEmit'],
      proofResults: [
        {
          command: 'npx tsc -p apps/backend/tsconfig.app.json --noEmit',
          status: 'passed',
          output: 'passed',
        },
      ],
      failedCommands: [],
      blockers: [],
      assumptions: [],
      outOfScopeFindings: [],
      nextRecommendedTask: 'Wire PlanFlow.',
      rawOutput: '{}',
    });
    expect(compareCoderReportToPacket(parseCoderPacket(packet), report)).toEqual({
      matchesPacket: true,
      comparedRequirements: 1,
      unresolvedRequirements: [],
      completedRequirements: ['Wire the adapter.'],
      incompleteRequirements: [],
      blockedRequirements: [],
      changedRequirements: [],
      outOfScopeFindings: [],
      nextNarrowerFocus: 'Wire PlanFlow.',
    });
  });
});
