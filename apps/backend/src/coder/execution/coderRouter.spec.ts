import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetCoderReportsForTest } from '../../services/coderReportEvidence';
import { runCoderSubagent } from './coderRouter';
import type { CoderExecutionAdapter, CoderRunPacket, CoderRunSnapshot } from './coderExecution';

const temp = mkdtempSync(path.join(tmpdir(), 'coder-router-'));
resetCoderReportsForTest(temp);

function fakeAdapter(): CoderExecutionAdapter & { prepared: CoderRunPacket | null } {
  const adapter: CoderExecutionAdapter & { prepared: CoderRunPacket | null } = {
    id: 'claude_code',
    prepared: null,
    availability: () => ({ available: true, executable: 'claude', version: 'test', error: null }),
    validate: () => undefined,
    prepare: (packet) => { adapter.prepared = packet; return snapshot(packet, 'prepared'); },
    start: () => snapshot(adapter.prepared!, 'running'),
    wait: async () => ({ ...snapshot(adapter.prepared!, 'completed'), exitCode: 0, sessionId: 'claude_session_1', report: { exactCommand: 'node -e "console.log(\'HELLO_FROM_CLAUDE_CODE\')"', stdout: 'HELLO_FROM_CLAUDE_CODE\n', stderr: '', exitStatus: 0, blockers: [] } }),
    sendInput: () => undefined,
    cancel: () => snapshot(adapter.prepared!, 'cancelled'),
    inspect: () => null,
    finalOutput: () => '',
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
    const adapter = fakeAdapter();
    const approvedPrompt = 'Run exactly: node -e "console.log(\'HELLO_FROM_CLAUDE_CODE\')"\nDo not modify files.\n';
    const result = await runCoderSubagent({ parentRunId: 'req_parent', projectId: 'p1', deckId: 'deck_builder', conversationId: 'c1', cardId: 'card_local_coder', adapter: 'claude_code', approvedPrompt }, adapter);
    expect(result).toMatchObject({ ok: true, adapter: 'claude_code', parentRunId: 'req_parent', claudeSessionId: 'claude_session_1', exactCommand: 'node -e "console.log(\'HELLO_FROM_CLAUDE_CODE\')"', stdout: 'HELLO_FROM_CLAUDE_CODE\n', commandExitStatus: 0 });
    expect(result.childRunId).toMatch(/^coder_/);
    expect(adapter.prepared?.approvedPrompt).toBe(approvedPrompt);
    expect(adapter.prepared?.parentRunId).toBe('req_parent');
  });

  it('rejects every adapter other than claude_code without fallback', async () => {
    await expect(runCoderSubagent({ parentRunId: 'p', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'codex' as never, approvedPrompt: 'x' }, fakeAdapter())).rejects.toThrow('coder_router_adapter_unsupported');
  });
});

rmSync(temp, { recursive: true, force: true });
