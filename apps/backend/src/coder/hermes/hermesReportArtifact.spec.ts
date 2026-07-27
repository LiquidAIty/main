import { beforeEach, describe, expect, it, vi } from 'vitest';

const rails = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('../../services/autogen/autogenOrchestratorClient', () => ({
  requestPythonRailsJson: rails.request,
}));

import {
  parseHermesInvestigationContext,
  readHermesReport,
  writeHermesReport,
} from './hermesReportArtifact';

describe('Hermes AgentGraph report transport', () => {
  beforeEach(() => {
    rails.request.mockReset();
  });

  it('preserves optional native investigation focus without inventing it', () => {
    expect(parseHermesInvestigationContext(undefined, 'project-1', 'main')).toEqual({
      projectId: 'project-1',
      conversationId: 'main',
      focusNodeIds: [],
      requestedOutcome: null,
    });
    expect(parseHermesInvestigationContext(
      {
        focusNodeIds: ['goal:g1'],
        requestedOutcome: 'Research the runtime.',
        goalId: 'goal:g1',
        codeGraphRefs: ['code:run'],
      },
      'project-1',
      'main',
    )).toMatchObject({
      goalId: 'goal:g1',
      requestedOutcome: 'Research the runtime.',
      codeGraphRefs: ['code:run'],
    });
  });

  it('transports one exact parent-run result to Python without a folder path', async () => {
    rails.request.mockResolvedValue({
      ok: true,
      reportId: 'agentresult:hermes:req_1234abcd',
      assignmentId: 'assignment:hermes:req_1234abcd',
    });

    await writeHermesReport({
      parentRunId: 'req_1234abcd',
      reportMarkdown: '# Exact report',
      summary: 'Exact summary',
      thinkGraphNodeIds: ['think:one'],
      codeGraphRefs: ['code:one'],
    });

    expect(rails.request).toHaveBeenCalledWith('/agentgraph/hermes/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentRunId: 'req_1234abcd',
        receiverCardId: 'card_hermes_steward',
        reportMarkdown: '# Exact report',
        summary: 'Exact summary',
        thinkGraphNodeIds: ['think:one'],
        knowGraphRefs: [],
        codeGraphRefs: ['code:one'],
      }),
    });
    expect(rails.request.mock.calls[0][1].body).not.toContain('returns/');
  });

  it('reads only the report linked to the exact parent run', async () => {
    const report = {
      reportId: 'agentresult:hermes:req_1234abcd',
      assignmentId: 'assignment:hermes:req_1234abcd',
      instructionId: 'instruction:one',
      projectId: 'project-1',
      conversationId: 'main',
      parentRunId: 'req_1234abcd',
      nativeSessionId: 'mag1:project-1:main',
      status: 'completed' as const,
      summary: 'Exact summary',
      reportMarkdown: '# Exact report',
      contextReferences: [],
      artifacts: [],
    };
    rails.request.mockResolvedValue({ ok: true, report });

    await expect(readHermesReport('req_1234abcd')).resolves.toEqual(report);
    expect(String(rails.request.mock.calls[0][0])).toContain('req_1234abcd');
  });

  it('fails before transport for a forged parent identity', async () => {
    await expect(writeHermesReport({
      parentRunId: '../escape',
      reportMarkdown: '# Report',
      summary: 'Summary',
    })).rejects.toThrow('hermes_report_parent_run_id_invalid');
    expect(rails.request).not.toHaveBeenCalled();
  });
});
