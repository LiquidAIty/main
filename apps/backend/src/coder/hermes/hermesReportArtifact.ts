import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

export type HermesReportArtifact = HermesReportCompletion & {
  projectId: string;
  conversationId: string;
  parentRunId: string;
  anchorNodeIds: string[];
  requestedOutcome: string;
  createdAt: string;
  reportMarkdown: string;
};

const HERMES_CARD_ID = 'card_hermes_steward';
const PARENT_RUN_ID = /^req_[a-z0-9-]+$/i;
type ActiveHermesInvestigation = { context: HermesInvestigationContext; reportId: string | null };
const activeInvestigations = new Map<string, ActiveHermesInvestigation>();

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

function stableAnchorIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('investigation_anchor_node_ids_array_required');
  if (value.length === 0) throw new Error('investigation_anchor_node_ids_required');
  if (value.length > 64) throw new Error('investigation_anchor_node_ids_too_many');
  return [...new Set(value.map((entry) => requiredText(entry, 'investigation_anchor_node_id', 512)))];
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

/** A substantive Hermes investigation must be explicitly rooted in real
 * ThinkGraph ids. Undefined means this is an ordinary Main-only chat turn. */
export function parseHermesInvestigationContext(
  value: unknown,
  projectId: string,
  conversationId: string,
): HermesInvestigationContext | null {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('investigation_context_object_required');
  }
  const candidate = value as Record<string, unknown>;
  return {
    projectId,
    conversationId,
    anchorNodeIds: stableAnchorIds(candidate.anchorNodeIds),
    requestedOutcome: requiredText(candidate.requestedOutcome, 'investigation_requested_outcome', 2_000),
  };
}

export function beginHermesInvestigation(parentRunId: string, context: HermesInvestigationContext): void {
  if (!PARENT_RUN_ID.test(parentRunId)) throw new Error('hermes_report_parent_run_id_invalid');
  activeInvestigations.set(parentRunId, { context, reportId: null });
}

export function endHermesInvestigation(parentRunId: string): void {
  activeInvestigations.delete(parentRunId);
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

/** Writes only against an in-flight, server-minted native Hermes investigation. */
export function writeActiveHermesReport(input: HermesReportWriteInput): HermesReportCompletion {
  const parentRunId = requiredText(input.parentRunId, 'parentRunId', 128);
  const active = activeInvestigations.get(parentRunId);
  if (!active) throw new Error('hermes_investigation_context_not_active');
  if (active.reportId) throw new Error('hermes_report_already_written');
  const completion = writeHermesReportArtifact(active.context, input);
  active.reportId = completion.reportId;
  return completion;
}

function parseStoredReport(raw: string): HermesReportArtifact | null {
  const match = /^<!-- liquidaity-hermes-report:(.+?) -->\r?\n\r?\n?/.exec(raw);
  if (!match) return null;
  try {
    const metadata = JSON.parse(match[1]) as Record<string, unknown>;
    const reportId = requiredText(metadata.reportId, 'reportId', 256);
    const projectId = requiredText(metadata.projectId, 'projectId', 256);
    const conversationId = requiredText(metadata.conversationId, 'conversationId', 256);
    const parentRunId = requiredText(metadata.parentRunId, 'parentRunId', 128);
    if (!PARENT_RUN_ID.test(parentRunId)) return null;
    const createdAt = requiredText(metadata.createdAt, 'createdAt', 128);
    if (metadata.status !== 'completed') return null;
    return {
      reportId,
      status: 'completed',
      linkedThinkGraphNodeIds: stableRefs(metadata.linkedThinkGraphNodeIds, 'linkedThinkGraphNodeIds'),
      linkedKnowGraphRefs: stableRefs(metadata.linkedKnowGraphRefs, 'linkedKnowGraphRefs'),
      linkedCodeGraphRefs: stableRefs(metadata.linkedCodeGraphRefs, 'linkedCodeGraphRefs'),
      summary: requiredText(metadata.summary, 'summary', 2_000),
      projectId,
      conversationId,
      parentRunId,
      anchorNodeIds: stableAnchorIds(metadata.anchorNodeIds),
      requestedOutcome: requiredText(metadata.requestedOutcome, 'requestedOutcome', 2_000),
      createdAt,
      reportMarkdown: raw.slice(match[0].length).trim(),
    };
  } catch {
    return null;
  }
}

/** The report shares returns/<req-id>/ with no Mag One discovery conflict:
 * worker discovery enumerates handoff/<jobId>/, while this reads only the fixed
 * Hermes filename under server-minted req_* folders. */
export function readLatestHermesReport(
  projectId: string,
  conversationId: string,
  workspaceRoot = resolveCoderWorkspaceRoot(),
): HermesReportArtifact | null {
  const returnsRoot = path.join(workspaceRoot, 'returns');
  if (!existsSync(returnsRoot)) return null;
  const reports: HermesReportArtifact[] = [];
  for (const entry of readdirSync(returnsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !PARENT_RUN_ID.test(entry.name)) continue;
    const reportPath = path.join(returnsRoot, entry.name, HERMES_CARD_ID, 'hermes-report.md');
    if (!existsSync(reportPath)) continue;
    try {
      if (!statSync(reportPath).isFile()) continue;
      const report = parseStoredReport(readFileSync(reportPath, 'utf8'));
      if (report && report.projectId === projectId && report.conversationId === conversationId) reports.push(report);
    } catch {
      // A malformed or unreadable report is not an active report. Never invent one.
    }
  }
  reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return reports[0] ?? null;
}
