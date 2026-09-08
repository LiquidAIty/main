import { describe, expect, it } from 'vitest';
import type { StandaloneCardTestResult } from '../../../components/AgentManager';
import { selectLatestRunResult } from './runResult';

const result = (runId: string, startedAt: string, state = 'completed'): StandaloneCardTestResult => ({
  runId, startedAt, state, status: state, conversationId: 'one', output: runId, tools: [], error: null,
});

describe('Run result ordering', () => {
  it('keeps a newer revision when older work finishes later', () => {
    const revision = result('revision', '2026-09-07T12:01:00Z', 'running');
    expect(selectLatestRunResult(revision, result('original', '2026-09-07T12:00:00Z'))).toBe(revision);
    expect(selectLatestRunResult(revision, { ...revision, state: 'completed', output: 'revised' })?.output).toBe('revised');
  });
  it('does not regress a completed Run to a delayed running observation', () => {
    const completed = result('run', '2026-09-07T12:00:00Z');
    expect(selectLatestRunResult(completed, { ...completed, state: 'running', output: '' })).toBe(completed);
  });
  it('allows another conversation and an explicit clear without comparing unrelated turns', () => {
    const current = result('new', '2026-09-07T12:01:00Z');
    const other = { ...result('other', '2026-09-07T12:00:00Z'), conversationId: 'two' };
    expect(selectLatestRunResult(current, other)).toBe(other);
    expect(selectLatestRunResult(current, null)).toBeNull();
  });
});
