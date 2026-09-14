import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTerminalExecution } from './agentTerminalExecution';
import { clearHermesExecutionContextsForTest, resolveHermesExecutionContext } from './childExecutionContext';
import { verifyInternalMcpBearerForTest } from '../services/mcp/internalMcpAuth';
import { startHermesHostTeamMonitor } from './hostExecutionLifecycle';

const owner = { userId: 'owner', projectId: 'project', deckId: 'deck', cardId: 'signal' };
const input = { message: 'Real user task', nativeSessionId: 'native-signal', model: 'saved-model', provider: 'openai-codex' };
const authorityFingerprint = 'a'.repeat(64);
const cardRevisionSha256 = 'b'.repeat(64);
const secretBefore = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
beforeEach(() => { process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'a'.repeat(64); clearHermesExecutionContextsForTest(); });
afterEach(() => { if (secretBefore === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
  else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = secretBefore; });

function fixture() {
  const preparedRun = (runId: string, cardId = owner.cardId) => ({
    runId,
    cardRevisionId: 'saved-revision',
    cardRevisionSha256,
    executionAuthorityFingerprint: authorityFingerprint,
    runtimeOwner: 'hermes',
    deckRevision: 'saved-deck-revision',
    hermesTransport: {
      cardIdentity: { cardId, title: cardId },
      delegationTargets: [{
        cardId: 'target-card',
        cardRevisionId: 'target-revision',
        title: 'Target Card',
        profile: 'target-profile',
        description: 'Authorized saved target',
      }],
      request: {
        runtime: { kind: 'hermes', mode: 'delegate', profile: cardId },
        provider: {
          provider: 'openai',
          accessMode: 'chatgpt-account',
          modelKey: 'saved-model',
          providerModelId: 'saved-model',
        },
        systemPrompt: 'Saved instructions',
        message: 'Reloaded canonical IDF request',
        enabledTools: ['worldsignals.package', 'web_search'],
        presentedTools: ['worldsignals.package', 'web_search'],
        nativeTools: ['memory'],
        skills: ['saved-skill'],
        mcpConnectionIds: [],
        runtimeOptions: {
          executionAuthorityFingerprint: authorityFingerprint,
          delegationRole: 'profile',
        },
      },
    },
  });
  const request = vi.fn(async (route: string, init?: RequestInit): Promise<any> => {
    const body = JSON.parse(String(init?.body));
    if (route.endsWith('/finish')) return { ok: true };
    return preparedRun(body.runId, body.cardId);
  });
  const catalog = vi.fn(async () => []);
  const delegateProfile = vi.fn(async () => ({
    nativeChildId: 'profile-012345abcdef',
    targetProfile: 'target-profile',
    runId: 'child-run',
    result: 'child result',
    nativeEvents: [],
  }));
  const handleHostExecution = vi.fn();
  const startTeamMonitor = vi.fn(
    (_args: Parameters<typeof startHermesHostTeamMonitor>[0]) => true,
  );
  return { request, catalog, preparedRun, delegateProfile, handleHostExecution, startTeamMonitor,
    lifecycle: new AgentTerminalExecution(
      request,
      catalog,
      delegateProfile,
      handleHostExecution as never,
      startTeamMonitor as never,
    ) };
}

describe('native Agent CLI canonical Run binding', () => {
  it('consumes one already-materialized Run without beginning or finishing a second Run', async () => {
    const f = fixture();
    const preparedRun = f.preparedRun('prepared-run');
    const staged = f.lifecycle.stage(owner, 'terminal-signal', 'signal', preparedRun, 'conversation-1');
    expect(staged).toEqual({ runId: 'prepared-run', message: 'Reloaded canonical IDF request' });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.catalog).not.toHaveBeenCalled();

    const prepared = await f.lifecycle.begin(owner, 'terminal-signal', 'signal', {
      ...input, message: staged.message,
    });
    expect(prepared.runId).toBe('prepared-run');
    expect(f.request).not.toHaveBeenCalledWith('/domain/runs/begin', expect.anything());
    expect(f.catalog).not.toHaveBeenCalled();
    const server = prepared.mcpServers[0] as any;
    const bearer = server.headers.find((header: any) => header.name === 'Authorization').value.slice(7);
    const principal = verifyInternalMcpBearerForTest(bearer, process.env).principal as any;
    expect(principal).toMatchObject({ parentRunId: 'prepared-run', conversationId: 'conversation-1' });

    await f.lifecycle.finish('terminal-signal', {
      executionContextId: prepared.executionContextId,
      result: {
        completed: true,
        final_response: 'Actual staged result',
      },
    });
    const finishCalls = f.request.mock.calls.filter(([route]) => route === '/domain/runs/finish');
    expect(finishCalls).toHaveLength(1);
    expect(JSON.parse(String(finishCalls[0][1]?.body))).toMatchObject({
      runId: 'prepared-run', state: 'completed', finalResult: 'Actual staged result',
    });
    expect(JSON.parse(String(finishCalls[0][1]?.body))).not.toHaveProperty('errorSummary');
  });

  it('fails the staged Run on identity or exact-message mismatch and permits an intentional retry', async () => {
    const f = fixture();
    const preparedRun = f.preparedRun('prepared-run');
    expect(() => f.lifecycle.stage({ ...owner, cardId: 'other' }, 'terminal-signal', 'signal', preparedRun))
      .toThrow('identity_mismatch');

    f.lifecycle.stage(owner, 'terminal-signal', 'signal', preparedRun);
    await expect(f.lifecycle.begin(owner, 'terminal-signal', 'signal', {
      ...input, message: 'Different message',
    })).rejects.toThrow('identity_mismatch');
    expect(JSON.parse(String(f.request.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      runId: 'prepared-run', state: 'failed', errorSummary: expect.stringContaining('identity_mismatch'),
    });

    const retry = f.preparedRun('retry-run');
    const retryStaged = f.lifecycle.stage(owner, 'terminal-signal', 'signal', retry);
    expect((await f.lifecycle.begin(owner, 'terminal-signal', 'signal', {
      ...input, message: retryStaged.message,
    })).runId).toBe('retry-run');
  });

  it('cancels an unconsumed staged Run once and leaves no hidden staged owner', async () => {
    const f = fixture();
    f.lifecycle.stage(owner, 'terminal-signal', 'signal', f.preparedRun('prepared-run'));
    await expect(f.lifecycle.cancelStaged('terminal-signal', 'gateway_submit_failed')).resolves.toBe(true);
    await expect(f.lifecycle.cancelStaged('terminal-signal', 'duplicate')).resolves.toBe(false);
    expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual({
      runId: 'prepared-run', state: 'failed', errorSummary: 'gateway_submit_failed',
    });
    expect((await f.lifecycle.begin(owner, 'terminal-signal', 'signal', input)).runId).toBeTruthy();
  });

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
      expect.stringMatching(/^mcp__main_runtime_[a-f0-9]+__worldsignals_package$/),
      expect.stringMatching(/^mcp__main_runtime_[a-f0-9]+__web_search$/)]);
    const server = prepared.mcpServers[0] as any;
    const bearer = server.headers.find((h: any) => h.name === 'Authorization').value.slice(7);
    const principal = verifyInternalMcpBearerForTest(bearer, process.env).principal as any;
    expect(principal).toMatchObject({ kind: 'card-runtime', parentRunId: prepared.runId,
      conversationId: '', grantedTools: ['web_search', 'worldsignals.package'],
      terminalOwner: { userId: 'owner', terminalSessionId: 'terminal-signal', profile: 'signal', cardRevisionId: 'saved-revision' } });
    expect(resolveHermesExecutionContext({ contextId: prepared.executionContextId, principal }).sessionId).toBe('native-signal');
    for (const change of [{ projectId: 'other' }, { deckId: 'other' }, { callerCardId: 'other' },
      { parentRunId: 'other' }, { grantedTools: ['card.create'] },
      ...['userId', 'profile', 'terminalSessionId', 'cardRevisionId'].map((field) => ({ terminalOwner: { ...principal.terminalOwner, [field]: 'other' } }))]) {
      expect(() => resolveHermesExecutionContext({ contextId: prepared.executionContextId, principal: { ...principal, ...change } })).toThrow('principal_mismatch');
    }
    await f.lifecycle.finish('terminal-signal', { executionContextId: prepared.executionContextId,
      result: { completed: true, final_response: 'Actual native response',
        effective_provider: 'openai-codex', provider_api_mode: 'codex_responses' } });
    expect(JSON.parse(String(f.request.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      runId: sent.runId, state: 'completed', finalResult: 'Actual native response',
      hermesSessionRef: 'native-signal', effectiveProvider: 'openai-codex',
      providerApiMode: 'codex_responses' });
    expect(() => resolveHermesExecutionContext({ contextId: prepared.executionContextId, principal })).toThrow('closed');
  });

  it('keeps a genuine Hermes failure failed without inventing a successful result', async () => {
    const f = fixture();
    const prepared = await f.lifecycle.begin(owner, 'terminal-signal', 'signal', input);

    await f.lifecycle.finish('terminal-signal', {
      executionContextId: prepared.executionContextId,
      result: {
        completed: false,
        failed: true,
        error: 'provider request failed',
        final_response: '',
      },
    });

    expect(JSON.parse(String(f.request.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      runId: prepared.runId,
      state: 'failed',
      errorSummary: 'provider request failed',
      finalResult: '',
    });
  });

  it('binds profile delegation to the exact initiating Gateway turn and saved deck authority', async () => {
    const f = fixture();
    const prepared = await f.lifecycle.begin(owner, 'terminal-signal', 'signal', input);
    const params = {
      sessionId: input.nativeSessionId,
      parentExecutionContextId: prepared.executionContextId,
      nativeChildId: 'profile-012345abcdef',
      targetProfile: 'target-profile',
      goal: 'Inspect the bounded evidence',
      context: 'Parent-authored context',
      background: true,
    };

    await expect(f.lifecycle.host('terminal-signal', {
      method: 'session/delegate_profile',
      params,
    })).resolves.toMatchObject({
      nativeChildId: 'profile-012345abcdef',
      targetProfile: 'target-profile',
      runId: 'child-run',
    });
    expect(f.delegateProfile).toHaveBeenCalledExactlyOnceWith({
      projectId: owner.projectId,
      deckId: owner.deckId,
      deckRevision: 'saved-deck-revision',
      conversationId: '',
      parentRunId: prepared.runId,
      sourceCardId: owner.cardId,
      sourceRuntimeMode: 'delegate',
      parentExecutionContextId: prepared.executionContextId,
      profileTargets: [{
        cardId: 'target-card',
        cardRevisionId: 'target-revision',
        title: 'Target Card',
        profile: 'target-profile',
        description: 'Authorized saved target',
      }],
    }, params);
    expect(f.request.mock.calls.filter(([route]) => route === '/domain/runs/begin')).toHaveLength(1);
  });

  it('observes native Team completion through the initiating Card Gateway session', async () => {
    const f = fixture();
    const prepared = await f.lifecycle.begin(owner, 'terminal-signal', 'signal', input);
    const nativeContext = {
      contextId: 'native-child-context',
      sessionId: input.nativeSessionId,
      runId: 'native-child-run',
    };
    f.handleHostExecution.mockResolvedValue({
      result: { executionContextId: nativeContext.contextId, runId: nativeContext.runId },
      nativeContext,
    });
    const appendTeamResult = vi.fn(async () => undefined);
    const params = {
      sessionId: input.nativeSessionId,
      parentExecutionContextId: prepared.executionContextId,
      nativeChildId: 'native-team-child',
      provider: 'openai-codex',
      model: 'saved-model',
    };

    await expect(f.lifecycle.host(
      'terminal-signal',
      { method: 'session/create_execution_context', params },
      appendTeamResult,
    )).resolves.toEqual({
      executionContextId: 'native-child-context',
      runId: 'native-child-run',
    });
    expect(f.handleHostExecution).toHaveBeenCalledExactlyOnceWith({
      method: 'session/create_execution_context', params,
    });
    expect(f.startTeamMonitor).toHaveBeenCalledExactlyOnceWith({
      context: nativeContext,
      appendRetryAttempts: 900,
      appendTeamResult,
    });
    const delivery = {
      sessionId: input.nativeSessionId,
      taskId: 'native-team-task',
      result: 'Measured Team result',
      state: 'completed' as const,
    };
    const monitorArgs = f.startTeamMonitor.mock.calls[0]![0];
    await monitorArgs.appendTeamResult(delivery);
    expect(appendTeamResult).toHaveBeenCalledExactlyOnceWith(delivery);
    expect(f.request.mock.calls.filter(([route]) => route === '/domain/runs/begin')).toHaveLength(1);
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

  it('revokes a finished turn even if persisting its Run result fails', async () => {
    const f = fixture();
    const prepared = await f.lifecycle.begin(owner, 'terminal-a', 'signal', input);
    f.request.mockRejectedValueOnce(new Error('receipt_store_unavailable'));
    await expect(f.lifecycle.finish('terminal-a', { executionContextId: prepared.executionContextId,
      result: { completed: true, final_response: 'native result',
        effective_provider: 'openai-codex', provider_api_mode: 'codex_responses' } }))
      .rejects.toThrow('receipt_store_unavailable');
    await expect(f.lifecycle.host('terminal-a', { method: 'session/create_execution_context', params: {} }))
      .rejects.toThrow('host_request_invalid');
    const next = await f.lifecycle.begin(owner, 'terminal-a', 'signal', input);
    expect(next.runId).not.toBe(prepared.runId);
    expect(next.executionContextId).not.toBe(prepared.executionContextId);
  });
});
