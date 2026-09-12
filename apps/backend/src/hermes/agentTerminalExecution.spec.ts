import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTerminalExecution } from './agentTerminalExecution';
import { clearHermesExecutionContextsForTest, resolveHermesExecutionContext } from './childExecutionContext';
import { verifyInternalMcpBearerForTest } from '../services/mcp/internalMcpAuth';

const owner = { userId: 'owner', projectId: 'project', deckId: 'deck', cardId: 'signal' };
const input = { message: 'Real user task', nativeSessionId: 'native-signal', model: 'saved-model', provider: 'openai-codex' };
const secretBefore = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
beforeEach(() => { process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'a'.repeat(64); clearHermesExecutionContextsForTest(); });
afterEach(() => { if (secretBefore === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
  else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = secretBefore; });

function fixture() {
  const request = vi.fn(async (route: string, init?: RequestInit): Promise<any> => {
    const body = JSON.parse(String(init?.body));
    if (route.endsWith('/finish')) return { ok: true };
    return { runId: body.runId, cardRevisionId: 'saved-revision', runtimeOwner: 'hermes',
      deckRevision: 'saved-deck-revision', hermesTransport: {
        cardIdentity: { cardId: body.cardId, title: body.cardId },
        request: { runtime: { kind: 'hermes', mode: 'delegate', profile: body.cardId },
          provider: { provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'saved-model', providerModelId: 'saved-model' },
          systemPrompt: 'Saved instructions', message: 'Reloaded canonical IDF request',
          enabledTools: ['worldsignals.package'], presentedTools: ['worldsignals.package'],
          nativeTools: ['memory'], mcpConnectionIds: [], runtimeOptions: {} },
      } };
  });
  const catalog = vi.fn(async () => []);
  return { request, catalog, lifecycle: new AgentTerminalExecution(request, catalog) };
}

describe('native Agent CLI canonical Run binding', () => {
  it('creates no Run before model input and forwards the canonical IDF projection without a conversation', async () => {
    const f = fixture();
    expect(f.request).not.toHaveBeenCalled();
    const prepared = await f.lifecycle.begin(owner, 'terminal-signal', 'signal', input);
    const sent = JSON.parse(String(f.request.mock.calls[0][1]?.body));
    expect(sent).toMatchObject({ projectId: 'project', deckId: 'deck', cardId: 'signal', assignment: input.message });
    expect(sent).not.toHaveProperty('conversationId');
    expect(prepared.runId).toBe(sent.runId);
    expect(prepared.message).toBe('Reloaded canonical IDF request');
    expect(prepared.sessionConfig.systemPrompt).toBe('Saved instructions');
    expect(prepared.sessionConfig.enabledToolsets).toEqual([]);
    expect(prepared.sessionConfig.enabledTools).toEqual(['memory',
      expect.stringMatching(/^mcp__main_runtime_[a-f0-9]+__worldsignals_package$/)]);
    const server = prepared.mcpServers[0] as any;
    const bearer = server.headers.find((h: any) => h.name === 'Authorization').value.slice(7);
    const principal = verifyInternalMcpBearerForTest(bearer, process.env).principal as any;
    expect(principal).toMatchObject({ kind: 'card-runtime', parentRunId: prepared.runId,
      conversationId: '', grantedTools: ['worldsignals.package'],
      terminalOwner: { userId: 'owner', terminalSessionId: 'terminal-signal', profile: 'signal', cardRevisionId: 'saved-revision' } });
    expect(resolveHermesExecutionContext({ contextId: prepared.executionContextId, principal }).sessionId).toBe('native-signal');
    for (const change of [{ projectId: 'other' }, { deckId: 'other' }, { callerCardId: 'other' },
      { parentRunId: 'other' }, { grantedTools: ['card.create'] },
      ...['userId', 'profile', 'terminalSessionId', 'cardRevisionId'].map((field) => ({ terminalOwner: { ...principal.terminalOwner, [field]: 'other' } }))]) {
      expect(() => resolveHermesExecutionContext({ contextId: prepared.executionContextId, principal: { ...principal, ...change } })).toThrow('principal_mismatch');
    }
    await f.lifecycle.finish('terminal-signal', { executionContextId: prepared.executionContextId,
      result: { completed: true, final_response: 'Actual native response' } });
    expect(JSON.parse(String(f.request.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      runId: sent.runId, state: 'completed', finalResult: 'Actual native response', providerThreadRef: 'native-signal' });
    expect(() => resolveHermesExecutionContext({ contextId: prepared.executionContextId, principal })).toThrow('closed');
  });

  it('isolates two native terminals and refuses concurrency, cross-session finish, and model switches', async () => {
    const f = fixture();
    const a = await f.lifecycle.begin(owner, 'terminal-a', 'signal', input);
    const b = await f.lifecycle.begin({ ...owner, cardId: 'quant' }, 'terminal-b', 'quant', { ...input, nativeSessionId: 'native-quant' });
    expect(a.runId).not.toBe(b.runId);
    expect(a.executionContextId).not.toBe(b.executionContextId);
    await expect(f.lifecycle.begin(owner, 'terminal-a', 'signal', input)).rejects.toThrow('already_running');
    await expect(f.lifecycle.finish('terminal-a', { executionContextId: b.executionContextId })).rejects.toThrow('mismatch');
    await expect(f.lifecycle.begin(owner, 'terminal-c', 'signal', { ...input, model: 'other-model' })).rejects.toThrow('configuration_mismatch');
    expect(JSON.parse(String(f.request.mock.calls.at(-1)?.[1]?.body)).state).toBe('failed');
    await f.lifecycle.abort('terminal-a');
    expect(JSON.parse(String(f.request.mock.calls.at(-1)?.[1]?.body)).errorSummary).toBe('native_cli_process_exited');
  });

  it('fails closed when canonical materialization fails and permits retry without inventing success', async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new Error('configured_tool_unknown'));
    await expect(f.lifecycle.begin(owner, 'terminal-a', 'signal', input)).rejects.toThrow('configured_tool_unknown');
    expect(f.request).toHaveBeenCalledOnce();
    expect(await f.lifecycle.begin(owner, 'terminal-a', 'signal', input)).toHaveProperty('runId');
  });

  it('fails the real Run if its native process exits during preparation', async () => {
    const f = fixture();
    let release!: () => void;
    f.catalog.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve([]);
    }));
    const pending = f.lifecycle.begin(owner, 'terminal-a', 'signal', input);
    await f.lifecycle.abort('terminal-a');
    release();
    await expect(pending).rejects.toThrow('native_cli_process_exited');
    expect(JSON.parse(String(f.request.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      state: 'failed', errorSummary: expect.stringContaining('native_cli_process_exited'),
    });
    await expect(f.lifecycle.host('terminal-a', { method: 'session/create_execution_context', params: {} }))
      .rejects.toThrow('host_request_invalid');
  });

  it('revokes a finished turn even if persisting its receipt fails', async () => {
    const f = fixture();
    const prepared = await f.lifecycle.begin(owner, 'terminal-a', 'signal', input);
    f.request.mockRejectedValueOnce(new Error('receipt_store_unavailable'));
    await expect(f.lifecycle.finish('terminal-a', { executionContextId: prepared.executionContextId,
      result: { completed: true, final_response: 'native result' } })).rejects.toThrow('receipt_store_unavailable');
    await expect(f.lifecycle.host('terminal-a', { method: 'session/create_execution_context', params: {} }))
      .rejects.toThrow('host_request_invalid');
    const next = await f.lifecycle.begin(owner, 'terminal-a', 'signal', input);
    expect(next.runId).not.toBe(prepared.runId);
    expect(next.executionContextId).not.toBe(prepared.executionContextId);
  });
});
