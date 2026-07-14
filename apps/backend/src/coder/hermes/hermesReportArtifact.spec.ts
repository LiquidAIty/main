import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  parseHermesInvestigationContext,
  beginHermesInvestigation,
  endHermesInvestigation,
  writeActiveHermesReport,
  readLatestHermesReport,
  writeHermesReportArtifact,
} from './hermesReportArtifact';

describe('writeHermesReportArtifact', () => {
  it('writes one durable Hermes report beneath the existing returns authority', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-report-'));
    try {
      const completion = writeHermesReportArtifact(
        {
          projectId: 'project-1',
          conversationId: 'main',
          focusNodeIds: ['run:42'],
          requestedOutcome: 'Inspect the current project.',
        },
        {
          parentRunId: 'req_1234abcd',
          reportMarkdown: '# Investigation\n\nThe source record is complete.',
          summary: 'Inspected the selected run.',
          thinkGraphNodeIds: ['run:42'],
          knowGraphRefs: [],
          codeGraphRefs: ['apps/backend/src/routes/coder.routes.ts'],
        },
        workspaceRoot,
      );

      expect(completion).toEqual({
        reportId: 'hermes:req_1234abcd',
        status: 'created',
        summary: 'Inspected the selected run.',
        updatedAt: expect.any(String),
      });
      const report = readFileSync(
        path.join(workspaceRoot, 'returns', 'req_1234abcd', 'card_hermes_steward', 'hermes-report.md'),
        'utf8',
      );
      expect(report).toContain('liquidaity-hermes-report:');
      expect(report).toContain('"projectId":"project-1"');
      expect(report).toContain('# Investigation');
      expect(readLatestHermesReport('project-1', 'main', workspaceRoot)).toMatchObject({
        reportId: 'hermes:req_1234abcd',
        focusNodeIds: ['run:42'],
        reportMarkdown: '# Investigation\n\nThe source record is complete.',
      });
      expect(readdirSync(path.join(workspaceRoot, 'returns', 'req_1234abcd', 'card_hermes_steward')))
        .toEqual(['hermes-report.md']);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects a path-like parent run id instead of writing outside returns', () => {
    expect(() => writeHermesReportArtifact(
      { projectId: 'project-1', conversationId: 'main', focusNodeIds: [], requestedOutcome: 'Inspect.' },
      { parentRunId: '../escape', reportMarkdown: '# Report', summary: 'Summary' },
      'C:/tmp/hermes-report-test',
    )).toThrow('hermes_report_parent_run_id_invalid');
  });

  it('mints Hermes project context without graph selection and preserves optional focus hints', () => {
    expect(parseHermesInvestigationContext(undefined, 'project-1', 'main')).toEqual({
      projectId: 'project-1', conversationId: 'main', focusNodeIds: [], requestedOutcome: null,
    });
    expect(parseHermesInvestigationContext(
      { focusNodeIds: ['question:identity'], requestedOutcome: 'Compare alternatives.' },
      'project-1',
      'main',
    )).toMatchObject({ focusNodeIds: ['question:identity'], requestedOutcome: 'Compare alternatives.' });
  });

  it('accepts the focused-branch input only when Main supplies it', () => {
    const focused = parseHermesInvestigationContext(
      {
        focusNodeIds: ['goal:g1'],
        requestedOutcome: 'Research the runtime',
        goalId: 'goal:g1',
        goalText: 'Understand the coder runtime',
        thinkGraphBranch: ['goal:g1', 'decision:d1'],
        codeGraphRefs: ['coderRouter.ts::runCoderSubagent'],
        knowGraphRefs: ['kg:1'],
      },
      'project-1',
      'main',
    );
    expect(focused).toMatchObject({
      goalId: 'goal:g1',
      goalText: 'Understand the coder runtime',
      thinkGraphBranch: ['goal:g1', 'decision:d1'],
      codeGraphRefs: ['coderRouter.ts::runCoderSubagent'],
      knowGraphRefs: ['kg:1'],
    });
    // An unfocused turn keeps the original shape — no focused-branch keys leak in.
    const plain = parseHermesInvestigationContext({ focusNodeIds: [] }, 'project-1', 'main');
    expect(plain).not.toHaveProperty('goalId');
    expect(plain).not.toHaveProperty('codeGraphRefs');
  });

  it('drives the begin/write/end lifecycle so a focused report binds to the run, and fails closed otherwise', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-life-'));
    vi.stubEnv('LIQUIDAITY_GRPC_CWD', workspaceRoot);
    const context = parseHermesInvestigationContext(
      { goalId: 'goal:g1', codeGraphRefs: ['coderRouter.ts::runCoderSubagent'] },
      'project-1',
      'main',
    );
    try {
      // No active investigation → an active write fails honestly.
      expect(() => writeActiveHermesReport({ parentRunId: 'req_life0001', reportMarkdown: '# X', summary: 'x' }))
        .toThrow('hermes_investigation_context_not_active');
      beginHermesInvestigation('req_life0001', context);
      const completion = writeActiveHermesReport({
        parentRunId: 'req_life0001',
        reportMarkdown: '# Found',
        summary: 'Found it',
        codeGraphRefs: ['coderRouter.ts::runCoderSubagent'],
      });
      expect(completion.status).toBe('created');
      endHermesInvestigation('req_life0001');
      // After end, writes fail closed again (no stale investigation lingers).
      expect(() => writeActiveHermesReport({ parentRunId: 'req_life0001', reportMarkdown: '# Y', summary: 'y' }))
        .toThrow('hermes_investigation_context_not_active');
    } finally {
      vi.unstubAllEnvs();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('revises the existing report in its original returns artifact across native turns', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-report-'));
    const firstContext = parseHermesInvestigationContext(undefined, 'project-1', 'main');
    try {
      const initial = writeHermesReportArtifact(firstContext, {
        parentRunId: 'req_11111111', reportMarkdown: '# First', summary: 'First finding.', thinkGraphNodeIds: ['goal:one'],
      }, workspaceRoot);
      const existing = readLatestHermesReport('project-1', 'main', workspaceRoot)!;
      const update = writeHermesReportArtifact(firstContext, {
        parentRunId: 'req_22222222', reportMarkdown: '# Revised', summary: 'Revised finding.', thinkGraphNodeIds: ['goal:one', 'question:two'],
      }, workspaceRoot, existing);
      expect(initial.status).toBe('created');
      expect(update).toMatchObject({ reportId: initial.reportId, status: 'updated', summary: 'Revised finding.' });
      expect(readLatestHermesReport('project-1', 'main', workspaceRoot)).toMatchObject({
        reportId: initial.reportId, artifactRunId: 'req_11111111', parentRunId: 'req_22222222', revision: 2,
        reportMarkdown: '# Revised', linkedThinkGraphNodeIds: ['goal:one', 'question:two'],
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
