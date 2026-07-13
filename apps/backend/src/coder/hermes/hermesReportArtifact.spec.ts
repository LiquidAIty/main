import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { writeHermesReportArtifact } from './hermesReportArtifact';

describe('writeHermesReportArtifact', () => {
  it('writes one durable Hermes report beneath the existing returns authority', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-report-'));
    try {
      const completion = writeHermesReportArtifact(
        {
          projectId: 'project-1',
          conversationId: 'main',
          anchorNodeIds: ['run:42'],
          requestedOutcome: 'Inspect the selected run.',
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
        status: 'completed',
        linkedThinkGraphNodeIds: ['run:42'],
        linkedKnowGraphRefs: [],
        linkedCodeGraphRefs: ['apps/backend/src/routes/coder.routes.ts'],
        summary: 'Inspected the selected run.',
      });
      const report = readFileSync(
        path.join(workspaceRoot, 'returns', 'req_1234abcd', 'card_hermes_steward', 'hermes-report.md'),
        'utf8',
      );
      expect(report).toContain('liquidaity-hermes-report:');
      expect(report).toContain('"projectId":"project-1"');
      expect(report).toContain('# Investigation');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects a path-like parent run id instead of writing outside returns', () => {
    expect(() => writeHermesReportArtifact(
      { projectId: 'project-1', conversationId: 'main', anchorNodeIds: [], requestedOutcome: 'Inspect.' },
      { parentRunId: '../escape', reportMarkdown: '# Report', summary: 'Summary' },
      'C:/tmp/hermes-report-test',
    )).toThrow('hermes_report_parent_run_id_invalid');
  });
});
