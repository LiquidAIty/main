import { afterEach, describe, expect, it } from 'vitest';
import { setLatestCoderAuditView, getLatestCoderAuditView, resetCoderAuditViewsForTest } from './coderAuditView';

afterEach(() => resetCoderAuditViewsForTest());

function input(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'p1',
    conversationId: 'main',
    childRunId: 'coder_1',
    correlationId: 'trace_1',
    conclusion: 'audited',
    repositoryIdentity: 'liquidaity',
    revision: 'abc',
    freshness: 'fresh',
    codeGraphQuery: 'runCoderSubagent',
    codeGraphNodeRefs: ['n1'],
    viewContract: { focusSymbols: ['runCoderSubagent'] },
    transcriptArtifact: 'coder-workspace/runs/coder_1/transcript.txt',
    ...overrides,
  } as Parameters<typeof setLatestCoderAuditView>[0];
}

describe('coderAuditView store', () => {
  it('returns null when no audit view exists', () => {
    expect(getLatestCoderAuditView('p1', 'main')).toBeNull();
  });

  it('stores and returns the latest audit view per conversation', () => {
    setLatestCoderAuditView(input({ conclusion: 'first' }));
    setLatestCoderAuditView(input({ conclusion: 'second' }));
    const view = getLatestCoderAuditView('p1', 'main');
    expect(view?.conclusion).toBe('second');
    expect(view?.viewContract.focusSymbols).toEqual(['runCoderSubagent']);
    expect(view?.updatedAt).toBeTruthy();
  });

  it('keys by project + conversation (no cross-conversation leakage)', () => {
    setLatestCoderAuditView(input({ conversationId: 'a', conclusion: 'A' }));
    setLatestCoderAuditView(input({ conversationId: 'b', conclusion: 'B' }));
    expect(getLatestCoderAuditView('p1', 'a')?.conclusion).toBe('A');
    expect(getLatestCoderAuditView('p1', 'b')?.conclusion).toBe('B');
    expect(getLatestCoderAuditView('p2', 'a')).toBeNull();
  });
});
