import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveCoderWorkspaceRoot } from '../../coder/workspaceRoot';
import { isValidJobId } from '../coderJobs';
import type { EpisodeNodeKind, EpisodeNodeInput } from '../thinkgraph/episodeContract';

/**
 * Editable prompt lifecycle for an orchestration run:
 *   prepared project context → Markdown draft → revisions → approval →
 *   handoff/<jobId>/prompt.md.
 *
 * Main Chat owns the approved prompt. The prompt BODY stays in the Markdown
 * artifact (this store never becomes a second document store); only lineage,
 * version, status, graph references, approval, execution run, outcome, and
 * evaluation metadata are tracked here — and surfaced into ThinkGraph via the
 * generic episode contract (promptRecordToEpisodeNodes). Draft generators (Coder
 * or Main) may seed a draft, but their output is only ever a draft: no
 * prompt reaches the artifact until Main approves it.
 */
export type PromptStatus = 'draft' | 'approved' | 'executed';
export type PromptSource = 'main_chat' | 'coder';

export type PromptRecord = {
  promptId: string;
  jobId: string;
  projectId: string;
  conversationId: string;
  goalId: string | null;
  version: number;
  status: PromptStatus;
  source: PromptSource;
  markdown: string;
  codeGraphRefs: string[];
  knowGraphRefs: string[];
  thinkGraphRefs: string[];
  /** handoff/<jobId>/prompt.md once the approved prompt is published, else null. */
  artifactPath: string | null;
  approvedAt: string | null;
  executionRunId: string | null;
  outcome: string | null;
  evaluation: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePromptDraftInput = {
  jobId: string;
  projectId: string;
  conversationId: string;
  markdown: string;
  source?: PromptSource;
  goalId?: string | null;
  codeGraphRefs?: string[];
  knowGraphRefs?: string[];
  thinkGraphRefs?: string[];
};

/** Injectable so the write is testable without touching the real workspace. */
export type PromptArtifactWriter = (jobId: string, markdown: string) => string;

const MAX_RECORDS = 500;
const records = new Map<string, PromptRecord>();

function refs(value: string[] | undefined): string[] {
  return Array.isArray(value) ? [...new Set(value.map((v) => String(v)))].filter(Boolean) : [];
}

function requireDraft(jobId: string): PromptRecord {
  const record = records.get(jobId);
  if (!record) throw new Error(`prompt_draft_not_found: ${jobId}`);
  return record;
}

/** Create v1 draft, or revise an existing draft (a revision un-approves it). */
export function createPromptDraft(input: CreatePromptDraftInput, now = new Date().toISOString()): PromptRecord {
  const jobId = String(input.jobId || '').trim();
  if (!isValidJobId(jobId)) throw new Error(`prompt_job_id_invalid: ${jobId}`);
  if (!String(input.projectId || '').trim()) throw new Error('prompt_project_id_required');
  if (!String(input.markdown || '').trim()) throw new Error('prompt_markdown_required');
  const existing = records.get(jobId);
  const record: PromptRecord = existing
    ? {
        ...existing,
        version: existing.version + 1,
        status: 'draft', // any revision returns to draft — approval is re-earned
        markdown: input.markdown,
        source: input.source ?? existing.source,
        goalId: input.goalId ?? existing.goalId,
        codeGraphRefs: input.codeGraphRefs ? refs(input.codeGraphRefs) : existing.codeGraphRefs,
        knowGraphRefs: input.knowGraphRefs ? refs(input.knowGraphRefs) : existing.knowGraphRefs,
        thinkGraphRefs: input.thinkGraphRefs ? refs(input.thinkGraphRefs) : existing.thinkGraphRefs,
        approvedAt: null,
        updatedAt: now,
      }
    : {
        promptId: `prompt_${randomUUID().slice(0, 12)}`,
        jobId,
        projectId: String(input.projectId).trim(),
        conversationId: String(input.conversationId || 'main').trim(),
        goalId: input.goalId ?? null,
        version: 1,
        status: 'draft',
        source: input.source ?? 'main_chat',
        markdown: input.markdown,
        codeGraphRefs: refs(input.codeGraphRefs),
        knowGraphRefs: refs(input.knowGraphRefs),
        thinkGraphRefs: refs(input.thinkGraphRefs),
        artifactPath: null,
        approvedAt: null,
        executionRunId: null,
        outcome: null,
        evaluation: null,
        createdAt: now,
        updatedAt: now,
      };
  records.delete(jobId);
  records.set(jobId, record);
  while (records.size > MAX_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) break;
    records.delete(oldest);
  }
  return record;
}

/** Main approves the current draft. Only a draft can be approved. */
export function approvePromptDraft(jobId: string, now = new Date().toISOString()): PromptRecord {
  const record = requireDraft(jobId);
  if (record.status !== 'draft') throw new Error(`prompt_not_draft: ${jobId} is ${record.status}`);
  record.status = 'approved';
  record.approvedAt = now;
  record.updatedAt = now;
  return record;
}

function defaultArtifactWriter(jobId: string, markdown: string): string {
  const root = resolveCoderWorkspaceRoot();
  const dir = path.join(root, 'handoff', jobId);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'prompt.md');
  const temp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    writeFileSync(temp, markdown, { encoding: 'utf8' });
    renameSync(temp, target);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
  return `handoff/${jobId}/prompt.md`;
}

/**
 * Publish the APPROVED prompt to handoff/<jobId>/prompt.md. Fails closed if the
 * prompt is not approved — an unapproved prompt never reaches the artifact.
 */
export function publishApprovedPrompt(jobId: string, writer: PromptArtifactWriter = defaultArtifactWriter): PromptRecord {
  const record = requireDraft(jobId);
  if (record.status !== 'approved') throw new Error(`prompt_not_approved: ${jobId} is ${record.status}`);
  record.artifactPath = writer(jobId, record.markdown);
  record.updatedAt = new Date().toISOString();
  return record;
}

/** Bind the approved+published prompt to the orchestration run that executed it. */
export function markPromptExecuted(jobId: string, executionRunId: string, now = new Date().toISOString()): PromptRecord {
  const record = requireDraft(jobId);
  if (record.status !== 'approved') throw new Error(`prompt_not_approved: ${jobId} is ${record.status}`);
  if (!record.artifactPath) throw new Error(`prompt_not_published: ${jobId}`);
  record.status = 'executed';
  record.executionRunId = String(executionRunId || '').trim() || null;
  record.updatedAt = now;
  return record;
}

export function recordPromptOutcome(jobId: string, outcome: string, evaluation?: string): PromptRecord {
  const record = requireDraft(jobId);
  record.outcome = String(outcome || '').trim() || null;
  if (evaluation !== undefined) record.evaluation = String(evaluation || '').trim() || null;
  record.updatedAt = new Date().toISOString();
  return record;
}

export function getPromptDraft(jobId: string): PromptRecord | null {
  return records.get(jobId) ?? null;
}

/** Map a prompt record into episode nodes (PreparedPrompt/PromptRevision/
 * ApprovedPrompt) for the generic episode contract — no separate ThinkGraph
 * writer, no duplicated lineage store. */
export function promptRecordToEpisodeNodes(record: PromptRecord): Partial<Record<EpisodeNodeKind, EpisodeNodeInput>> {
  const base: Record<string, string | number> = { prompt_id: record.promptId, version: record.version, status: record.status };
  if (record.goalId) base.goal_id = record.goalId;
  if (record.artifactPath) base.artifact_path = record.artifactPath;
  if (record.approvedAt) base.approved_at = record.approvedAt;
  if (record.executionRunId) base.execution_run_id = record.executionRunId;
  if (record.outcome) base.outcome = record.outcome;
  if (record.evaluation) base.evaluation = record.evaluation;
  const nodes: Partial<Record<EpisodeNodeKind, EpisodeNodeInput>> = {
    PreparedPrompt: { summary: `prompt v${record.version} (${record.status})`, properties: base },
  };
  if (record.version > 1) {
    nodes.PromptRevision = { summary: `revised to v${record.version}`, properties: { version: record.version } };
  }
  if (record.status === 'approved' || record.status === 'executed') {
    const approvedProps: Record<string, string | number> = { version: record.version };
    if (record.artifactPath) approvedProps.artifact_path = record.artifactPath;
    nodes.ApprovedPrompt = { summary: `approved v${record.version}`, properties: approvedProps };
  }
  return nodes;
}

export function resetPromptLifecycleForTest(): void {
  records.clear();
}
