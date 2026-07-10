import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelAgentRuntimeTest, describeRuntimeTestCapabilities, getAgentRuntimeTest, resetAgentRuntimeTestsForTest, startAgentRuntimeTest, type RuntimeTestInput } from './agentRuntimeReality';

let root = '';

function input(overrides: Partial<RuntimeTestInput> = {}): RuntimeTestInput {
  return { mode: 'single_coder', projectId: 'p1', deckId: 'deck_builder', parentRunId: 'standin_1', correlationId: 'reality_1', adapter: 'claude_code', repositoryWorkspaceRef: 'repo_root', cardId: 'card_local_coder', objective: 'Create target.html', permissionGrant: 'workspace_write', expectedOutput: { path: 'target.html', marker: 'MARKER' }, timeoutMs: 30_000, developerTest: true, ...overrides };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'runtime-reality-'));
  mkdirSync(path.join(root, '.git'));
  vi.stubEnv('LIQUIDAITY_GRPC_CWD', root);
  vi.stubEnv('NODE_ENV', 'test');
  resetAgentRuntimeTestsForTest();
});

afterEach(() => { vi.unstubAllEnvs(); resetAgentRuntimeTestsForTest(); rmSync(root, { recursive: true, force: true }); });

describe('agent runtime reality layer', () => {
  it('describes the one repository grant, available adapters, and honest unavailable team mode', () => {
    const result = describeRuntimeTestCapabilities();
    expect(result.supportedModes).toEqual(['single_coder']);
    expect(result.unavailableModes).toEqual([{ mode: 'mag_one_team', error: 'runtime_test_mode_unavailable' }]);
    expect(result.adapters.map((item) => item.id)).toEqual(['claude_code', 'codex']);
    expect(result.repositoryGrant.root).toBe(root);
  });

  it('starts one canonical single-coder run and preserves parent/child identity', async () => {
    let captures = 0;
    const record = startAgentRuntimeTest(input(), {
      capture: () => ++captures === 1 ? new Map() : new Map([['target.html', 'hash']]),
      cancelCoder: vi.fn(),
      runCoder: async (_request, _adapter, observer) => {
        observer?.('child_run_created', { childRunId: 'coder_child', correlationId: 'trace_child', promptHash: 'abc' });
        writeFileSync(path.join(root, 'target.html'), 'MARKER', 'utf8');
        return { ok: true, adapter: 'claude_code', parentRunId: 'standin_1', childRunId: 'coder_child', correlationId: 'trace_child', promptHash: 'abc', sessionId: 'session_1', processExitCode: 0, structuredEventCount: 5, exactCommand: 'node verify', stdout: 'MARKER', stderr: '', commandExitStatus: 0, report: { filesChanged: ['target.html'] }, verification: null, error: null };
      },
    });
    expect(record.stage).toBe('running');
    await vi.waitFor(() => expect(getAgentRuntimeTest(record.runtimeTestId)?.stage).toBe('completed'));
    expect(getAgentRuntimeTest(record.runtimeTestId)).toMatchObject({ childRunId: 'coder_child', parentRunId: 'standin_1', promptHash: 'abc' });
  });

  it.each([
    [{ mode: 'mag_one_team' }, 'runtime_test_mode_unavailable'],
    [{ mode: 'unknown' }, 'runtime_test_mode_unknown'],
    [{ projectId: '' }, 'runtime_test_identity_incomplete'],
    [{ adapter: '' }, 'runtime_test_adapter_unsupported'],
    [{ repositoryWorkspaceRef: 'other' }, 'runtime_test_repository_grant_invalid'],
  ])('fails closed for invalid input %#', (overrides, error) => {
    expect(() => startAgentRuntimeTest(input(overrides as Partial<RuntimeTestInput>))).toThrow(error);
  });

  it('rejects duplicate starts and cancels the one active child without replacement', () => {
    const never = new Promise<never>(() => undefined);
    const cancel = vi.fn();
    const deps = { capture: () => new Map(), cancelCoder: cancel, runCoder: (_request: unknown, _adapter: unknown, observer: any) => { observer('child_run_created', { childRunId: 'coder_live' }); return never; } };
    const record = startAgentRuntimeTest(input(), deps);
    expect(() => startAgentRuntimeTest(input(), deps)).toThrow('runtime_test_duplicate_start');
    expect(cancelAgentRuntimeTest(record.runtimeTestId, cancel)).toMatchObject({ stage: 'cancelled' });
    expect(cancel).toHaveBeenCalledWith('claude_code', 'coder_live');
  });

  it('rejects production activation', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_TEST_REAL_LOOP', '');
    expect(() => startAgentRuntimeTest(input())).toThrow('runtime_test_disabled_in_production');
  });
});
