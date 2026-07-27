import { describe, expect, it } from 'vitest';
import { buildEpisodeCloseInput } from './episodeClosure';
import { buildEpisodePatch, externalAgentStandInProvenance, validateEpisodeInput } from './episodeContract';
import { validateThinkGraphPatch, type ThinkGraphPatchAuthority } from './thinkGraphStore';

const AUTH: ThinkGraphPatchAuthority = { projectId: 'p1', cardId: 'card_main_chat', correlationId: 't1', conversationId: 'main' };

describe('buildEpisodeCloseInput', () => {
  function context() {
    return {
      episodeId: 'ep_run1',
      projectId: 'p1',
      conversationId: 'main',
      goalText: 'Prove the chat-with-graph pipe end to end',
      goalId: 'goal:g1',
      provenance: externalAgentStandInProvenance({ provider: 'anthropic', model: 'claude' }, { verified: false }),
      steps: {
        MainReasoning: 'decided to audit the coder runtime',
        SpecialistInvocation: 'invoked Coder in direct_main_audit',
        FilteredCodeGraphView: 'runOpenClaudeCodeTask branch',
        HermesResearchResult: 'two sources on PTY runtimes',
        MagOneRun: 'orchestration run run1',
        WorkerResult: 'worker returned a diff',
        TestResult: 'tests passed',
        MainFinalResponse: 'summarized to the user',
        UserJudgment: 'accepted',
        TrainingEligibility: 'needs_review',
      } as const,
      graphRefs: { codeGraph: ['coderConsoleRuntime.ts::runOpenClaudeCodeTask'], knowGraph: ['kg:1'] },
      judgment: 'accepted' as const,
    };
  }

  it('builds the episode only from explicit run records', () => {
    const input = buildEpisodeCloseInput(context());
    expect(input.nodes).toHaveProperty('MainReasoning');
    // Goal node carries the goal id.
    expect(input.nodes?.Goal?.properties).toMatchObject({ goal_id: 'goal:g1' });
  });

  it('produces a valid episode patch carrying the stand-in labels', () => {
    const input = buildEpisodeCloseInput(context());
    expect(validateEpisodeInput(input)).toBeNull();
    const patch = buildEpisodePatch(input);
    expect(validateThinkGraphPatch(AUTH, patch)).toBeNull();
    const episode = (patch.resources ?? []).find((r) => r.id === 'ep_run1');
    expect(episode?.properties).toMatchObject({ source: 'external_agent_standin', product_proof: false, pipe_test: true, judgment: 'accepted' });
  });

  it('stays valid without optional specialist steps', () => {
    const ctx = { ...context(), steps: { MainReasoning: 'bounded decision' } };
    const patch = buildEpisodePatch(buildEpisodeCloseInput(ctx as any));
    expect(validateThinkGraphPatch(AUTH, patch)).toBeNull();
    const kinds = (patch.resources ?? []).map((r) => r.kind);
    expect(kinds).not.toContain('PreparedPrompt');
    expect(kinds).toContain('MainReasoning');
  });
});
