import { describe, expect, it, vi } from 'vitest';
import { AgentTerminalExecution } from './agentTerminalExecution';

const owner = {
  userId: 'owner', projectId: 'project', deckId: 'deck', cardId: 'signal',
};
const authorityFingerprint = 'a'.repeat(64);
const cardRevisionSha256 = 'b'.repeat(64);

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'prepared-run',
    cardRevisionId: 'saved-revision',
    cardRevisionSha256,
    executionAuthorityFingerprint: authorityFingerprint,
    runtimeOwner: 'hermes',
    hermesTransport: {
      cardIdentity: { cardId: owner.cardId, title: 'Signal' },
      request: {
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'signal' },
        provider: {
          provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'saved-model',
        },
        message: 'Reloaded canonical IDF request',
        runtimeOptions: { executionAuthorityFingerprint: authorityFingerprint },
      },
    },
    ...overrides,
  };
}

function fixture() {
  const request = vi.fn(async (_path: string, _init: RequestInit) => ({ ok: true }));
  return { request, execution: new AgentTerminalExecution(request as never) };
}

describe('Gateway Card Run receipt binding', () => {
  it('stages one already-materialized Run without creating another authority', () => {
    const { execution, request } = fixture();
    expect(execution.stage(owner, 'terminal-signal', 'signal', prepared(), 'conversation-1'))
      .toEqual({ runId: 'prepared-run', message: 'Reloaded canonical IDF request' });
    expect(execution.activeRunId('terminal-signal')).toBe('prepared-run');
    expect(execution.ownsRun('terminal-signal', 'prepared-run')).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects invalid identity, authority, provider, and retired operation fields before staging', () => {
    const cases: Array<[typeof owner, unknown, string]> = [
      [{ ...owner, cardId: 'other' }, prepared(), 'agent_terminal_staged_run_identity_mismatch'],
      [owner, prepared({ cardRevisionSha256: 'not-a-hash' }), 'agent_terminal_staged_run_identity_mismatch'],
      [owner, prepared({
        hermesTransport: {
          ...prepared().hermesTransport,
          request: { ...prepared().hermesTransport.request, builderOperation: 'invented' },
        },
      }), 'prepared_hermes_fields_retired:builderOperation'],
      [owner, prepared({
        hermesTransport: {
          ...prepared().hermesTransport,
          request: {
            ...prepared().hermesTransport.request,
            systemPrompt: 'duplicate saved Card prompt',
            outputRequirements: 'duplicate legacy output contract',
          },
        },
      }), 'prepared_hermes_fields_retired:systemPrompt,outputRequirements'],
      [owner, prepared({
        hermesTransport: {
          ...prepared().hermesTransport,
          request: {
            ...prepared().hermesTransport.request,
            provider: { provider: 'openai', accessMode: 'openrouter-api', modelKey: 'saved-model' },
          },
        },
      }), 'hermes_saved_provider_access_mode_mismatch:openai:openrouter-api'],
    ];
    cases.forEach(([caseOwner, value, error], index) => {
      const { execution } = fixture();
      expect(() => execution.stage(caseOwner, `terminal-${index}`, 'signal', value)).toThrow(error);
    });
  });

  it('persists exact Gateway identity, provider, usage, and final text once', async () => {
    const { execution, request } = fixture();
    execution.stage(owner, 'terminal-signal', 'signal', prepared());

    await expect(execution.completeStaged('terminal-signal', 'native-session', {
      text: 'Exact Gateway answer',
      status: 'complete',
      event: {
        type: 'message.complete',
        session_id: 'native-session',
        payload: {
          native_root_id: 'native-root',
          native_run_id: 'native-turn',
          usage: {
            input_tokens: 17,
            output_tokens: 9,
            cached_tokens: 3,
            reasoning_tokens: 2,
            total_cost_usd: 0.004,
          },
        },
      },
    })).resolves.toEqual({
      hermesSessionId: 'native-session',
      nativeRootId: 'native-root',
      nativeRunId: 'native-turn',
      effectiveProvider: 'openai-codex',
      providerApiMode: null,
      inputTokens: 17,
      outputTokens: 9,
      cachedTokens: 3,
      reasoningTokens: 2,
      costUsd: 0.004,
    });

    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(expect.objectContaining({
      runId: 'prepared-run',
      state: 'completed',
      finalResult: 'Exact Gateway answer',
      hermesSessionRef: 'native-session',
      providerThreadRef: 'native-root',
      providerTurnRef: 'native-turn',
      effectiveProvider: 'openai-codex',
      providerInputTokens: 17,
      providerOutputTokens: 9,
      providerCachedTokens: 3,
      providerReasoningTokens: 2,
      totalCostUsd: 0.004,
    }));
    expect(execution.activeRunId('terminal-signal')).toBeNull();
  });

  it('refuses concurrent staging and cancels an unconsumed Run exactly once', async () => {
    const { execution, request } = fixture();
    execution.stage(owner, 'terminal-signal', 'signal', prepared());
    expect(() => execution.stage(owner, 'terminal-signal', 'signal', prepared({ runId: 'other' })))
      .toThrow('agent_terminal_turn_already_running');

    await expect(execution.cancelStaged('terminal-signal', 'gateway_submit_failed')).resolves.toBe(true);
    await expect(execution.cancelStaged('terminal-signal', 'duplicate')).resolves.toBe(false);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      runId: 'prepared-run', state: 'failed', errorSummary: 'gateway_submit_failed',
    });
  });

  it('retains staged ownership until a failed completion receipt is settled', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('run_native_transport_evidence_incomplete'))
      .mockResolvedValueOnce({ ok: true });
    const execution = new AgentTerminalExecution(request as never);
    execution.stage(owner, 'terminal-signal', 'signal', prepared());

    await expect(execution.completeStaged('terminal-signal', 'native-session', {
      text: 'Provider completed before receipt persistence failed',
      status: 'complete',
      event: { type: 'message.complete', payload: {} },
    })).rejects.toThrow('run_native_transport_evidence_incomplete');
    expect(execution.activeRunId('terminal-signal')).toBe('prepared-run');

    await expect(execution.cancelStaged(
      'terminal-signal',
      'run_native_transport_evidence_incomplete',
    )).resolves.toBe(true);
    expect(execution.activeRunId('terminal-signal')).toBeNull();
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      runId: 'prepared-run',
      state: 'failed',
      errorSummary: 'run_native_transport_evidence_incomplete',
    });
  });

  it('honors a requested cancellation instead of accepting a racing completion', async () => {
    const { execution, request } = fixture();
    execution.stage(owner, 'terminal-signal', 'signal', prepared());
    execution.requestCancellation('terminal-signal', 'prepared-run');

    await expect(execution.completeStaged('terminal-signal', 'native-session', {
      text: 'Late answer',
      status: 'complete',
      event: { type: 'message.complete', payload: {} },
    })).rejects.toThrow('hermes_turn_cancelled');
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      runId: 'prepared-run', state: 'cancelled', errorSummary: 'hermes_turn_cancelled',
    });
    expect(execution.activeRunId('terminal-signal')).toBeNull();
  });
});
