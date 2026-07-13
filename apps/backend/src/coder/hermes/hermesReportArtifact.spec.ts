import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  parseHermesInvestigationContext,
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
