import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetCoderReportsForTest } from '../../services/coderReportEvidence';
import { runCoderSubagent } from './coderRouter';
import type { CoderAdapterId, CoderExecutionAdapter, CoderRunPacket, CoderRunSnapshot } from './coderExecution';

const temp = mkdtempSync(path.join(tmpdir(), 'coder-router-'));
resetCoderReportsForTest(temp);

function fakeAdapter(id: CoderAdapterId, hello: string): CoderExecutionAdapter & { prepared: CoderRunPacket | null } {
  const adapter: CoderExecutionAdapter & { prepared: CoderRunPacket | null } = {
    id,
    prepared: null,
    availability: () => ({ available: true, executable: id, version: 'test', error: null }),
    validate: () => undefined,
    prepare: (packet) => { adapter.prepared = packet; return snapshot(packet, 'prepared'); },
    start: () => snapshot(adapter.prepared!, 'running'),
    wait: async () => ({ ...snapshot(adapter.prepared!, 'completed'), exitCode: 0, sessionId: `${id}_session_1`, report: { exactCommand: `node -e "console.log('${hello}')"`, stdout: `${hello}\n`, stderr: '', exitStatus: 0, blockers: [] } }),
    sendInput: () => undefined,
    cancel: () => snapshot(adapter.prepared!, 'cancelled'),
    inspect: () => null,
    finalOutput: () => '',
    inspectLaunch: () => ({ executable: id, args: [], cwd: '.', environmentKeys: [] }),
    dispose: () => undefined,
  };
  return adapter;
}

function snapshot(packet: CoderRunPacket, status: CoderRunSnapshot['status']): CoderRunSnapshot {
  return { packet, status, sessionId: 'requested_session', processId: 123, exitCode: null, error: null, events: [{ sequence: 1, timestamp: '2026-07-10T00:00:00.000Z', type: 'process_started' }], finalOutput: '', report: null };
}

afterEach(() => resetCoderReportsForTest(temp));

describe('runCoderSubagent', () => {
  it('routes explicitly to Claude Code and links parent/child runs without rewriting prompt bytes', async () => {
    const adapter = fakeAdapter('claude_code', 'HELLO_FROM_CLAUDE_CODE');
    const approvedPrompt = 'Run exactly: node -e "console.log(\'HELLO_FROM_CLAUDE_CODE\')"\nDo not modify files.\n';
    const result = await runCoderSubagent({ parentRunId: 'req_parent', projectId: 'p1', deckId: 'deck_builder', conversationId: 'c1', cardId: 'card_local_coder', adapter: 'claude_code', approvedPrompt }, adapter);
    expect(result).toMatchObject({ ok: true, adapter: 'claude_code', parentRunId: 'req_parent', sessionId: 'claude_code_session_1', exactCommand: 'node -e "console.log(\'HELLO_FROM_CLAUDE_CODE\')"', stdout: 'HELLO_FROM_CLAUDE_CODE\n', commandExitStatus: 0 });
    expect(result.childRunId).toMatch(/^coder_/);
    expect(adapter.prepared?.approvedPrompt).toBe(approvedPrompt);
    expect(adapter.prepared?.parentRunId).toBe('req_parent');
    expect(adapter.prepared?.adapter).toBe('claude_code');
  });

  it('routes explicitly to Codex with the same contract and linked identity', async () => {
    const adapter = fakeAdapter('codex', 'HELLO_FROM_CODEX');
    const result = await runCoderSubagent({ parentRunId: 'req_parent_2', projectId: 'p1', deckId: 'deck_builder', conversationId: 'c1', cardId: 'card_local_coder', adapter: 'codex', approvedPrompt: 'Create helloworld.md.\n' }, adapter);
    expect(result).toMatchObject({ ok: true, adapter: 'codex', parentRunId: 'req_parent_2', sessionId: 'codex_session_1', stdout: 'HELLO_FROM_CODEX\n', commandExitStatus: 0 });
    expect(adapter.prepared?.adapter).toBe('codex');
  });

  it('rejects unknown adapters without fallback', async () => {
    await expect(runCoderSubagent({ parentRunId: 'p', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'cursor', approvedPrompt: 'x' })).rejects.toThrow('coder_router_adapter_unsupported');
  });

  it('rejects a requested adapter that does not match the resolved adapter (no silent substitution)', async () => {
    await expect(runCoderSubagent({ parentRunId: 'p', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'codex', approvedPrompt: 'x' }, fakeAdapter('claude_code', 'X'))).rejects.toThrow('coder_router_adapter_mismatch');
  });

  it('rejects an unavailable selected adapter without trying another adapter', async () => {
    const adapter = fakeAdapter('claude_code', 'X');
    adapter.availability = () => ({ available: false, executable: null, version: null, error: 'not_logged_in' });
    await expect(runCoderSubagent({ parentRunId: 'p', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'claude_code', approvedPrompt: 'x' }, adapter)).rejects.toThrow('coder_router_adapter_unavailable: not_logged_in');
    expect(adapter.prepared).toBeNull();
  });
});

rmSync(temp, { recursive: true, force: true });
