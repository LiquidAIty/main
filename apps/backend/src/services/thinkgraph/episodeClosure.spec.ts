import { afterEach, describe, expect, it } from 'vitest';
import { buildEpisodeCloseInput } from './episodeClosure';
import { buildEpisodePatch, externalAgentStandInProvenance, validateEpisodeInput } from './episodeContract';
import { validateThinkGraphPatch, type ThinkGraphPatchAuthority } from './thinkGraphStore';
import { createPromptDraft, approvePromptDraft, publishApprovedPrompt, resetPromptLifecycleForTest } from '../prompt/promptLifecycle';

const AUTH: ThinkGraphPatchAuthority = { projectId: 'p1', cardId: 'card_main_chat', correlationId: 't1', conversationId: 'main' };

afterEach(() => resetPromptLifecycleForTest());

describe('buildEpisodeCloseInput', () => {
  function context() {
    return {
      episodeId: 'ep_run1',
      projectId: 'p1',
      conversationId: 'main',
      goalText: 'Prove the chat-with-graph pipe end to end',
      goalId: 'goal:g1',
      provenance: externalAgentStandInProvenance({ provider: 'anthropic', model: 'claude' }, { verified: false }),
      jobId: 'job_run1',
      steps: {
        MainReasoning: 'decided to audit the coder runtime',
        SpecialistInvocation: 'invoked Coder in direct_main_audit',
        FilteredCodeGraphView: 'runCoderSubagent branch',
        HermesResearchResult: 'two sources on PTY runtimes',
        MagOneRun: 'orchestration run run1',
        WorkerResult: 'worker returned a diff',
        TestResult: 'tests passed',
        MainFinalResponse: 'summarized to the user',
        UserJudgment: 'accepted',
        TrainingEligibility: 'needs_review',
      } as const,
      graphRefs: { codeGraph: ['coderRouter.ts::runCoderSubagent'], knowGraph: ['kg:1'] },
      judgment: 'accepted' as const,
    };
  }

  it('pulls prompt lineage from the store and folds it into the episode', () => {
    createPromptDraft({ jobId: 'job_run1', projectId: 'p1', conversationId: 'main', markdown: '# Plan' });
    approvePromptDraft('job_run1');
    publishApprovedPrompt('job_run1', (j) => `handoff/${j}/prompt.md`);
    const input = buildEpisodeCloseInput(context());
    expect(input.nodes).toHaveProperty('PreparedPrompt');
    expect(input.nodes).toHaveProperty('ApprovedPrompt');
    expect(input.nodes).toHaveProperty('MainReasoning');
    // Goal node carries the goal id.
    expect(input.nodes?.Goal?.properties).toMatchObject({ goal_id: 'goal:g1' });
  });

  it('produces a valid episode patch carrying the stand-in labels', () => {
    createPromptDraft({ jobId: 'job_run1', projectId: 'p1', conversationId: 'main', markdown: '# Plan' });
    approvePromptDraft('job_run1');
    const input = buildEpisodeCloseInput(context());
    expect(validateEpisodeInput(input)).toBeNull();
    const patch = buildEpisodePatch(input);
    expect(validateThinkGraphPatch(AUTH, patch)).toBeNull();
    const episode = (patch.resources ?? []).find((r) => r.id === 'ep_run1');
    expect(episode?.properties).toMatchObject({ source: 'external_agent_standin', product_proof: false, pipe_test: true, judgment: 'accepted' });
  });

  it('works without a prompt job (partial episode) and stays valid', () => {
    const ctx = { ...context(), jobId: undefined };
    const patch = buildEpisodePatch(buildEpisodeCloseInput(ctx));
    expect(validateThinkGraphPatch(AUTH, patch)).toBeNull();
    const kinds = (patch.resources ?? []).map((r) => r.kind);
    expect(kinds).not.toContain('PreparedPrompt');
    expect(kinds).toContain('MainReasoning');
  });
});
