import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCoderWorkspaceRoot } from '../workspaceRoot';

export type HermesInvestigationContext = {
  projectId: string;
  conversationId: string;
  /** Optional user-selected focus only. Hermes always reads the project graph itself. */
  focusNodeIds: string[];
  requestedOutcome: string | null;
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
  status: 'created' | 'updated';
  summary: string;
  updatedAt: string;
};

export type HermesReportArtifact = HermesReportCompletion & {
  projectId: string;
  conversationId: string;
  /** The current native turn that last revised the report. */
  parentRunId: string;
  /** The returns/ directory that owns this one durable report. */
  artifactRunId: string;
  focusNodeIds: string[];
  requestedOutcome: string | null;
  createdAt: string;
  revision: number;
  reportMarkdown: string;
  linkedThinkGraphNodeIds: string[];
  linkedKnowGraphRefs: string[];
  linkedCodeGraphRefs: string[];
};

const HERMES_CARD_ID = 'card_hermes_steward';
const PARENT_RUN_ID = /^req_[a-z0-9-]+$/i;
type ActiveHermesInvestigation = { context: HermesInvestigationContext; report: HermesReportArtifact | null };
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

function optionalRefs(value: unknown, field: string, limit = 64): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field}_array_required`);
  if (value.length > limit) throw new Error(`${field}_too_many`);
  return [...new Set(value.map((entry) => requiredText(entry, field, 512)))];
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
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

/** Server-minted project identity is always present for the native Hermes
 * doorway. A UI selection is an optional focus hint, never an invocation gate. */
export function parseHermesInvestigationContext(
  value: unknown,
  projectId: string,
  conversationId: string,
): HermesInvestigationContext {
  if (value === undefined) {
    return { projectId, conversationId, focusNodeIds: [], requestedOutcome: null };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('investigation_context_object_required');
  }
  const candidate = value as Record<string, unknown>;
  return {
    projectId,
    conversationId,
    focusNodeIds: optionalRefs(candidate.focusNodeIds, 'investigation_focus_node_ids'),
    requestedOutcome: optionalText(candidate.requestedOutcome, 'investigation_requested_outcome', 2_000),
  };
}

export function beginHermesInvestigation(parentRunId: string, context: HermesInvestigationContext): void {
  if (!PARENT_RUN_ID.test(parentRunId)) throw new Error('hermes_report_parent_run_id_invalid');
  activeInvestigations.set(parentRunId, { context, report: readLatestHermesReport(context.projectId, context.conversationId) });
}

export function endHermesInvestigation(parentRunId: string): void {
  activeInvestigations.delete(parentRunId);
}

/** Reads the current full report only for an in-flight native Hermes turn.
 * Main receives the separate bounded context projection instead. */
export function readActiveHermesReport(parentRunId: string): HermesReportArtifact | null {
  const normalized = requiredText(parentRunId, 'parentRunId', 128);
  const active = activeInvestigations.get(normalized);
  if (!active) throw new Error('hermes_investigation_context_not_active');
  return readLatestHermesReport(active.context.projectId, active.context.conversationId);
}

/** Reuses the existing returns/ artifact authority; the metadata header is for
 * the later Inspector pass and the untouched Markdown body is Hermes's report. */
export function writeHermesReportArtifact(
  context: HermesInvestigationContext,
  input: HermesReportWriteInput,
  workspaceRoot = resolveCoderWorkspaceRoot(),
  existingReport: HermesReportArtifact | null = null,
): HermesReportCompletion {
  const parentRunId = requiredText(input.parentRunId, 'parentRunId', 128);
  const reportMarkdown = requiredText(input.reportMarkdown, 'reportMarkdown', 120_000);
  const summary = requiredText(input.summary, 'summary', 2_000);
  const linkedThinkGraphNodeIds = stableRefs(input.thinkGraphNodeIds, 'thinkGraphNodeIds');
  const linkedKnowGraphRefs = stableRefs(input.knowGraphRefs, 'knowGraphRefs');
  const linkedCodeGraphRefs = stableRefs(input.codeGraphRefs, 'codeGraphRefs');
  const updatedAt = new Date().toISOString();
  const artifactRunId = existingReport?.artifactRunId ?? parentRunId;
  const completion: HermesReportCompletion = {
    reportId: existingReport?.reportId ?? `hermes:${artifactRunId}`,
    status: existingReport ? 'updated' : 'created',
    summary,
    updatedAt,
  };
  const metadata = {
    version: 2,
    ...completion,
    projectId: context.projectId,
    conversationId: context.conversationId,
    parentRunId,
    artifactRunId,
    focusNodeIds: context.focusNodeIds,
    requestedOutcome: context.requestedOutcome,
    createdAt: existingReport?.createdAt ?? updatedAt,
    revision: (existingReport?.revision ?? 0) + 1,
    linkedThinkGraphNodeIds,
    linkedKnowGraphRefs,
    linkedCodeGraphRefs,
  };
  const encodedMetadata = JSON.stringify(metadata).replace(/</g, '\\u003c');
  const targetDirectory = reportDirectory(workspaceRoot, artifactRunId);
  mkdirSync(targetDirectory, { recursive: true });
  const targetPath = path.join(targetDirectory, 'hermes-report.md');
  const temporaryPath = path.join(targetDirectory, `.hermes-report.${parentRunId}.tmp`);
  try {
    writeFileSync(
      temporaryPath,
      `<!-- liquidaity-hermes-report:${encodedMetadata} -->\n\n${reportMarkdown}\n`,
      'utf8',
    );
    renameSync(temporaryPath, targetPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
  return completion;
}

/** Writes only against an in-flight, server-minted native Hermes investigation. */
export function writeActiveHermesReport(input: HermesReportWriteInput): HermesReportCompletion {
  const parentRunId = requiredText(input.parentRunId, 'parentRunId', 128);
  const active = activeInvestigations.get(parentRunId);
  if (!active) throw new Error('hermes_investigation_context_not_active');
  // Resolve immediately before the synchronous atomic replacement. Concurrent
  // parent turns cannot revise from a stale begin-turn snapshot in this process.
  const latest = readLatestHermesReport(active.context.projectId, active.context.conversationId);
  const completion = writeHermesReportArtifact(active.context, input, resolveCoderWorkspaceRoot(), latest);
  active.report = readLatestHermesReport(active.context.projectId, active.context.conversationId);
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
    const updatedAt = requiredText(metadata.updatedAt ?? metadata.createdAt, 'updatedAt', 128);
    const status = metadata.status;
    if (status !== 'created' && status !== 'updated' && status !== 'completed') return null;
    return {
      reportId,
      status: status === 'completed' ? 'created' : status,
      linkedThinkGraphNodeIds: stableRefs(metadata.linkedThinkGraphNodeIds, 'linkedThinkGraphNodeIds'),
      linkedKnowGraphRefs: stableRefs(metadata.linkedKnowGraphRefs, 'linkedKnowGraphRefs'),
      linkedCodeGraphRefs: stableRefs(metadata.linkedCodeGraphRefs, 'linkedCodeGraphRefs'),
      summary: requiredText(metadata.summary, 'summary', 2_000),
      projectId,
      conversationId,
      parentRunId,
      artifactRunId: requiredText(metadata.artifactRunId ?? parentRunId, 'artifactRunId', 128),
      focusNodeIds: optionalRefs(metadata.focusNodeIds, 'focusNodeIds'),
      requestedOutcome: optionalText(metadata.requestedOutcome, 'requestedOutcome', 2_000),
      createdAt,
      updatedAt,
      revision: typeof metadata.revision === 'number' && Number.isInteger(metadata.revision) && metadata.revision > 0
        ? metadata.revision
        : 1,
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
  reports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return reports[0] ?? null;
}
