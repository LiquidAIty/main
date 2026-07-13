import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCoderWorkspaceRoot } from '../workspaceRoot';

export type HermesInvestigationContext = {
  projectId: string;
  conversationId: string;
  anchorNodeIds: string[];
  requestedOutcome: string;
};

export type HermesReportWriteInput = {
  parentRunId: string;
  reportMarkdown: string;
  summary: string;
  thinkGraphNodeIds?: unknown;
  knowGraphRefs?: unknown;
  codeGraphRefs?: unknown;
};

export type HermesReportCompletion = {
  reportId: string;
  status: 'completed';
  linkedThinkGraphNodeIds: string[];
  linkedKnowGraphRefs: string[];
  linkedCodeGraphRefs: string[];
  summary: string;
};

const HERMES_CARD_ID = 'card_hermes_steward';
const PARENT_RUN_ID = /^req_[a-z0-9-]+$/i;

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field}_string_required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field}_required`);
  if (normalized.length > maxLength) throw new Error(`${field}_too_long`);
  return normalized;
}

function stableRefs(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field}_array_required`);
  if (value.length > 128) throw new Error(`${field}_too_many`);
  return [...new Set(value.map((entry) => requiredText(entry, field, 512)))];
}

function reportDirectory(workspaceRoot: string, parentRunId: string): string {
  if (!PARENT_RUN_ID.test(parentRunId)) throw new Error('hermes_report_parent_run_id_invalid');
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, 'returns', parentRunId, HERMES_CARD_ID);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('hermes_report_path_outside_workspace');
  }
  return target;
}

/** Reuses the existing returns/ artifact authority; the metadata header is for
 * the later Inspector pass and the untouched Markdown body is Hermes's report. */
export function writeHermesReportArtifact(
  context: HermesInvestigationContext,
  input: HermesReportWriteInput,
  workspaceRoot = resolveCoderWorkspaceRoot(),
): HermesReportCompletion {
  const parentRunId = requiredText(input.parentRunId, 'parentRunId', 128);
  const reportMarkdown = requiredText(input.reportMarkdown, 'reportMarkdown', 120_000);
  const summary = requiredText(input.summary, 'summary', 2_000);
  const linkedThinkGraphNodeIds = stableRefs(input.thinkGraphNodeIds, 'thinkGraphNodeIds');
  const linkedKnowGraphRefs = stableRefs(input.knowGraphRefs, 'knowGraphRefs');
  const linkedCodeGraphRefs = stableRefs(input.codeGraphRefs, 'codeGraphRefs');
  const completion: HermesReportCompletion = {
    reportId: `hermes:${parentRunId}`,
    status: 'completed',
    linkedThinkGraphNodeIds,
    linkedKnowGraphRefs,
    linkedCodeGraphRefs,
    summary,
  };
  const metadata = {
    version: 1,
    ...completion,
    projectId: context.projectId,
    conversationId: context.conversationId,
    parentRunId,
    anchorNodeIds: context.anchorNodeIds,
    requestedOutcome: context.requestedOutcome,
    createdAt: new Date().toISOString(),
  };
  const encodedMetadata = JSON.stringify(metadata).replace(/</g, '\\u003c');
  const targetDirectory = reportDirectory(workspaceRoot, parentRunId);
  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(
    path.join(targetDirectory, 'hermes-report.md'),
    `<!-- liquidaity-hermes-report:${encodedMetadata} -->\n\n${reportMarkdown}\n`,
    'utf8',
  );
  return completion;
}
