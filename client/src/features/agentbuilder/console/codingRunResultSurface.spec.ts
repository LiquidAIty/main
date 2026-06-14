import { describe, expect, it, vi } from 'vitest';
import {
  extractCodingRunReference,
  pollCodingRunUntilTerminal,
} from './codingRunResultSurface';
import type { CodingRunLifecycle, ConsoleSessionInfo } from './openClaudeConsoleClient';

function run(overrides: Partial<CodingRunLifecycle> = {}): CodingRunLifecycle {
  return {
    id: 'coding_run_123',
    projectId: 'project-1',
    targetRoot: 'C:\\Projects\\main',
    userGoal: 'Inspect the repo.',
    generatedSpec: 'COMPACT CODER TASK',
    sessionId: 'occ_123',
    status: 'completed',
    resultSummary: 'Inspected the bridge.',
    proofCommands: [],
    proofFiles: ['apps/backend/src/routes/coder.routes.ts'],
    validatedCoderReport: false,
    coderReport: null,
    blocker: null,
    memoryRecordStatus: 'recorded',
    memoryRecordDetail: 'ThinkGraph run outcome recorded.',
    ...overrides,
  };
}

describe('coding run result surface', () => {
  it('extracts the coding run id and lifecycle status URL from a started response', () => {
    expect(
      extractCodingRunReference(
        'Session occ_123 started. Coding run: coding_run_123. Result status: /api/coder/openclaude/console/runs/coding_run_123.',
      ),
    ).toEqual({
      codingRunId: 'coding_run_123',
      consoleSessionId: 'occ_123',
      resultStatusUrl: '/api/coder/openclaude/console/runs/coding_run_123',
    });
  });

  it('polls the existing lifecycle URL until a terminal result and retrieves the session', async () => {
    const getCodingRun = vi
      .fn()
      .mockResolvedValueOnce({ codingRun: run({ status: 'running' }), consoleTranscriptPath: null })
      .mockResolvedValueOnce({ codingRun: run(), consoleTranscriptPath: null });
    const getSession = vi.fn(async () => ({
      session: { exitCode: 0 } as ConsoleSessionInfo,
    }));

    const result = await pollCodingRunUntilTerminal(
      {
        codingRunId: 'coding_run_123',
        consoleSessionId: 'occ_123',
        resultStatusUrl: '/api/coder/openclaude/console/runs/coding_run_123',
      },
      { getCodingRun, getSession, sleep: async () => undefined },
    );

    expect(getCodingRun).toHaveBeenCalledTimes(2);
    expect(getSession).toHaveBeenCalledWith('occ_123');
    expect(result.run.status).toBe('completed');
  });

});
