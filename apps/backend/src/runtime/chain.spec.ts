import { describe, it, expect } from 'vitest';
import {
  ChainCondition,
  ChainRunState,
  ChainStep,
  PromptChain,
  sortChainSteps,
  evaluateChainCondition,
  canRunChainStep,
  resolveRunnableSteps,
} from './chain';

describe('ExecutionChain primitive', () => {
  const baseState: ChainRunState = {
    currentStepId: null,
    completedStepIds: [],
    failedStepIds: [],
    approved: false,
    researchPackReady: false,
    planApproved: false,
    evidenceCount: 0,
    swarmCount: 0,
    outputsByStepId: {},
  };

  const createStep = (overrides: Partial<ChainStep> = {}): ChainStep => ({
    id: `step_${Math.random().toString(36).substring(7)}`,
    order: 0,
    label: 'Test Step',
    cardId: 'card_1',
    role: 'chat_router',
    condition: 'always',
    runMode: 'sequential',
    requiresApproval: false,
    promptPart: 'test prompt',
    inputFrom: 'user',
    outputKey: 'test_output',
    ...overrides,
  });

  it('1. steps sort by order', () => {
    const step1 = createStep({ id: 's1', order: 10 });
    const step2 = createStep({ id: 's2', order: 1 });
    const step3 = createStep({ id: 's3', order: 5 });

    const sorted = sortChainSteps([step1, step2, step3]);
    expect(sorted.map(s => s.id)).toEqual(['s2', 's3', 's1']);
  });

  it('2. always condition passes', () => {
    expect(evaluateChainCondition('always', baseState)).toBe(true);
  });

  it('3. after_chat_pair passes only when lastChatPairId exists', () => {
    expect(evaluateChainCondition('after_chat_pair', baseState)).toBe(false);
    expect(evaluateChainCondition('after_chat_pair', { ...baseState, lastChatPairId: 'chat_1' })).toBe(true);
  });

  it('4. research_pack_ready passes only when researchPackReady is true', () => {
    expect(evaluateChainCondition('research_pack_ready', baseState)).toBe(false);
    expect(evaluateChainCondition('research_pack_ready', { ...baseState, researchPackReady: true })).toBe(true);
  });

  it('5. plan_approved passes only when planApproved is true', () => {
    expect(evaluateChainCondition('plan_approved', baseState)).toBe(false);
    expect(evaluateChainCondition('plan_approved', { ...baseState, planApproved: true })).toBe(true);
  });

  it('6. evidence_received passes only when evidenceCount > 0', () => {
    expect(evaluateChainCondition('evidence_received', baseState)).toBe(false);
    expect(evaluateChainCondition('evidence_received', { ...baseState, evidenceCount: 1 })).toBe(true);
  });

  it('7. requiresApproval blocks if approved is false', () => {
    const step = createStep({ requiresApproval: true, condition: 'always' });
    expect(canRunChainStep(step, baseState)).toBe(false);
    expect(canRunChainStep(step, { ...baseState, approved: true })).toBe(true);
  });

  it('8. approval_gate blocks if approved is false', () => {
    const step = createStep({ runMode: 'approval_gate', condition: 'always' });
    expect(canRunChainStep(step, baseState)).toBe(false);
    expect(canRunChainStep(step, { ...baseState, approved: true })).toBe(true);
  });

  it('9. resolveRunnableSteps returns only runnable steps', () => {
    const chain: PromptChain = {
      id: 'chain_1',
      name: 'Test Chain',
      mode: 'locked',
      steps: [
        createStep({ id: 'always_step', condition: 'always', order: 1 }),
        createStep({ id: 'blocked_step', condition: 'plan_approved', order: 2 }),
      ],
    };

    const runnable = resolveRunnableSteps(chain, baseState);
    expect(runnable.length).toBe(1);
    expect(runnable[0].id).toBe('always_step');
  });

  it('10. generic baseline state only allows chat_router/always step if chain contains the default chat step', () => {
    const chain: PromptChain = {
      id: 'chain_research',
      name: 'Interactive Research Chain',
      mode: 'locked',
      steps: [
        createStep({ id: 'chat_step', role: 'chat_router', condition: 'always', order: 1 }),
        createStep({ id: 'think_step', role: 'thinkgraph', condition: 'after_chat_pair', order: 2 }),
        createStep({ id: 'plan_step', role: 'planflow', condition: 'research_pack_ready', order: 3 }),
        createStep({ id: 'research_step', role: 'research', condition: 'plan_approved', requiresApproval: true, order: 4 }),
      ],
    };

    const runnable = resolveRunnableSteps(chain, baseState);
    expect(runnable.length).toBe(1);
    expect(runnable[0].id).toBe('chat_step');
    expect(runnable[0].role).toBe('chat_router');
  });

  it('11. no arbitrary condition strings are accepted silently; unknown condition returns false or throws a controlled error', () => {
    // In evaluateChainCondition it throws. In canRunChainStep it catches and returns false.
    const badCondition = 'evil_eval' as ChainCondition;
    
    expect(() => evaluateChainCondition(badCondition, baseState)).toThrowError(/Unknown condition/);
    
    const step = createStep({ condition: badCondition });
    expect(canRunChainStep(step, baseState)).toBe(false);
  });

  it('completed or failed steps are not runnable', () => {
    const step = createStep({ id: 'step_1', condition: 'always' });
    expect(canRunChainStep(step, baseState)).toBe(true);
    
    expect(canRunChainStep(step, { ...baseState, completedStepIds: ['step_1'] })).toBe(false);
    expect(canRunChainStep(step, { ...baseState, failedStepIds: ['step_1'] })).toBe(false);
  });
});
