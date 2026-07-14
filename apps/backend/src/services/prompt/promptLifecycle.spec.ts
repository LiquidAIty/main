import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPromptDraft,
  approvePromptDraft,
  publishApprovedPrompt,
  markPromptExecuted,
  recordPromptOutcome,
  getPromptDraft,
  promptRecordToEpisodeNodes,
  resetPromptLifecycleForTest,
} from './promptLifecycle';
import { buildEpisodePatch } from '../thinkgraph/episodeContract';
import { validateThinkGraphPatch, type ThinkGraphPatchAuthority } from '../thinkgraph/thinkGraphStore';

const AUTH: ThinkGraphPatchAuthority = { projectId: 'p1', cardId: 'card_main_chat', correlationId: 't1', conversationId: 'main' };

afterEach(() => {
  resetPromptLifecycleForTest();
  vi.unstubAllEnvs();
});

function seed(jobId = 'job_a') {
  return createPromptDraft({
    jobId,
    projectId: 'p1',
    conversationId: 'main',
    markdown: '# Plan\nDo the thing.',
    source: 'coder',
    goalId: 'goal:g1',
    codeGraphRefs: ['coderRouter.ts::runCoderSubagent'],
  });
}

describe('prompt lifecycle', () => {
  it('creates a v1 draft owned by the project/conversation', () => {
    const record = seed();
    expect(record).toMatchObject({ version: 1, status: 'draft', source: 'coder', goalId: 'goal:g1', jobId: 'job_a' });
    expect(record.promptId).toMatch(/^prompt_/);
    expect(record.artifactPath).toBeNull();
  });

  it('a revision bumps the version and RE-earns approval (un-approves)', () => {
    seed();
    approvePromptDraft('job_a');
    expect(getPromptDraft('job_a')?.status).toBe('approved');
    const revised = createPromptDraft({ jobId: 'job_a', projectId: 'p1', conversationId: 'main', markdown: '# Plan v2' });
    expect(revised).toMatchObject({ version: 2, status: 'draft', approvedAt: null });
  });

  it('only a draft can be approved', () => {
    seed();
    approvePromptDraft('job_a');
    expect(() => approvePromptDraft('job_a')).toThrow('prompt_not_draft');
  });

  it('an UNAPPROVED prompt never reaches the artifact', () => {
    seed();
    const writer = vi.fn();
    expect(() => publishApprovedPrompt('job_a', writer as never)).toThrow('prompt_not_approved');
    expect(writer).not.toHaveBeenCalled();
  });

  it('publishes the approved prompt to handoff/<jobId>/prompt.md and records the artifact path', () => {
    seed();
    approvePromptDraft('job_a');
    const captured: Array<[string, string]> = [];
    const record = publishApprovedPrompt('job_a', (jobId, md) => {
      captured.push([jobId, md]);
      return `handoff/${jobId}/prompt.md`;
    });
    expect(captured[0]).toEqual(['job_a', '# Plan\nDo the thing.']);
    expect(record.artifactPath).toBe('handoff/job_a/prompt.md');
  });

  it('binds an execution run only after approval + publish, and captures the outcome', () => {
    seed();
    expect(() => markPromptExecuted('job_a', 'run_1')).toThrow('prompt_not_approved');
    approvePromptDraft('job_a');
    expect(() => markPromptExecuted('job_a', 'run_1')).toThrow('prompt_not_published');
    publishApprovedPrompt('job_a', (j) => `handoff/${j}/prompt.md`);
    const executed = markPromptExecuted('job_a', 'run_1');
    expect(executed).toMatchObject({ status: 'executed', executionRunId: 'run_1' });
    const scored = recordPromptOutcome('job_a', 'completed', 'accepted');
    expect(scored).toMatchObject({ outcome: 'completed', evaluation: 'accepted' });
  });

  it('the default writer atomically writes prompt.md under the workspace root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'prompt-life-'));
    vi.stubEnv('LIQUIDAITY_GRPC_CWD', root);
    try {
      seed('job_write');
      approvePromptDraft('job_write');
      const record = publishApprovedPrompt('job_write');
      const file = path.join(root, 'coder-workspace', 'handoff', 'job_write', 'prompt.md');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('Do the thing.');
      expect(record.artifactPath).toBe('handoff/job_write/prompt.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed on unknown job / invalid id / missing project', () => {
    expect(() => approvePromptDraft('nope')).toThrow('prompt_draft_not_found');
    expect(() => createPromptDraft({ jobId: 'bad id!', projectId: 'p1', conversationId: 'main', markdown: 'x' })).toThrow('prompt_job_id_invalid');
    expect(() => createPromptDraft({ jobId: 'job_b', projectId: '', conversationId: 'main', markdown: 'x' })).toThrow('prompt_project_id_required');
  });
});

describe('promptRecordToEpisodeNodes', () => {
  it('maps draft → PreparedPrompt; revised → +PromptRevision; approved → +ApprovedPrompt', () => {
    seed();
    expect(Object.keys(promptRecordToEpisodeNodes(getPromptDraft('job_a')!))).toEqual(['PreparedPrompt']);
    createPromptDraft({ jobId: 'job_a', projectId: 'p1', conversationId: 'main', markdown: '# v2' });
    approvePromptDraft('job_a');
    publishApprovedPrompt('job_a', (j) => `handoff/${j}/prompt.md`);
    const nodes = promptRecordToEpisodeNodes(getPromptDraft('job_a')!);
    expect(Object.keys(nodes).sort()).toEqual(['ApprovedPrompt', 'PreparedPrompt', 'PromptRevision']);
    expect(nodes.ApprovedPrompt?.properties).toMatchObject({ artifact_path: 'handoff/job_a/prompt.md' });
  });

  it('the emitted prompt nodes fit a valid episode patch', () => {
    seed();
    approvePromptDraft('job_a');
    publishApprovedPrompt('job_a', (j) => `handoff/${j}/prompt.md`);
    const patch = buildEpisodePatch({
      episodeId: 'ep_p',
      projectId: 'p1',
      conversationId: 'main',
      provenance: { source: 'real_run', verified: false, productProof: false, trainingEligibility: 'needs_review' },
      goalText: 'ship the prompt',
      nodes: promptRecordToEpisodeNodes(getPromptDraft('job_a')!),
    });
    expect(validateThinkGraphPatch(AUTH, patch)).toBeNull();
  });
});
