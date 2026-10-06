import type { CardRuntime, CardRuntimeState } from './cardRuntime';

const SETTLEMENT_TIMEOUT_MS = 5_000;

export type SessionCompactionReceipt = {
  status: 'compressed' | 'aborted' | 'unavailable' | 'failed';
  terminalSessionId: string;
  hermesSessionId: string;
  storedSessionId: string;
  profile: string;
  focusApplied: false;
  beforeMessages: number | null;
  afterMessages: number | null;
  beforeTokens: number | null;
  afterTokens: number | null;
  errorCode: string | null;
};

export type SessionCompactionIdentity = Pick<
  CardRuntimeState,
  | 'sessionId'
  | 'hermesSessionId'
  | 'storedSessionId'
  | 'profile'
  | 'completedTurnGeneration'
  | 'completedHermesRunId'
>;

function requestError(error: unknown): string {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : {};
  const code = typeof value.code === 'number' && Number.isSafeInteger(value.code)
    ? value.code
    : null;
  if (code === 4009) return 'agent_terminal_context_compaction_hermes_session_busy';
  if (code === -32601) return 'agent_terminal_context_compaction_hermes_method_unavailable';
  if (code !== null) {
    return `agent_terminal_context_compaction_hermes_rpc_${code < 0 ? `negative_${Math.abs(code)}` : code}`;
  }
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (/^request timed out after \d+s: session\.compress$/i.test(message)) {
    return 'agent_terminal_context_compaction_request_timeout';
  }
  return 'agent_terminal_context_compaction_request_failed';
}

export class HermesSessionMaintenance {
  constructor(
    private readonly runtime: CardRuntime,
    private readonly activeContext: (sessionId: string) => unknown | null,
  ) {}

  async dispatchLearn(request: string): Promise<string> {
    const result = await this.runtime.client.request<any>('command.dispatch', {
      name: 'learn',
      arg: request,
    });
    const message = result?.type === 'send' ? String(result.message || '').trim() : '';
    if (!message) throw new Error('hermes_learn_command_dispatch_failed');
    return message;
  }

  queueCompaction(
    expected: SessionCompactionIdentity,
    onReceipt?: (receipt: SessionCompactionReceipt) => void,
  ): Promise<SessionCompactionReceipt> {
    const base = (): Omit<SessionCompactionReceipt, 'status' | 'errorCode'> => ({
      terminalSessionId: String(expected?.sessionId || ''),
      hermesSessionId: String(expected?.hermesSessionId || ''),
      storedSessionId: String(expected?.storedSessionId || ''),
      profile: String(expected?.profile || ''),
      focusApplied: false,
      beforeMessages: null,
      afterMessages: null,
      beforeTokens: null,
      afterTokens: null,
    });
    const deliver = (receipt: SessionCompactionReceipt) => {
      try { onReceipt?.({ ...receipt }); } catch {}
      return receipt;
    };
    const immediate = (
      status: SessionCompactionReceipt['status'],
      errorCode: string | null,
    ) => Promise.resolve(deliver({ ...base(), status, errorCode }));
    if (!expected?.sessionId?.trim()
      || !expected.hermesSessionId?.trim()
      || !expected.storedSessionId?.trim()
      || !expected.profile?.trim()
      || !Number.isSafeInteger(expected.completedTurnGeneration)
      || expected.completedTurnGeneration < 0
      || (expected.completedHermesRunId !== null
        && (typeof expected.completedHermesRunId !== 'string'
          || !expected.completedHermesRunId.trim()))) {
      return immediate('failed', 'agent_terminal_context_compaction_identity_invalid');
    }
    const identityMatches = () => (
      this.runtime.state.status === 'running'
      && this.runtime.state.sessionId === expected.sessionId
      && this.runtime.state.hermesSessionId === expected.hermesSessionId
      && this.runtime.state.storedSessionId === expected.storedSessionId
      && this.runtime.state.profile === expected.profile
    );
    const turnMatches = () => (
      this.runtime.state.completedTurnGeneration === expected.completedTurnGeneration
      && this.runtime.state.completedHermesRunId === expected.completedHermesRunId
    );
    if (!identityMatches()) {
      return immediate('unavailable', 'agent_terminal_context_compaction_identity_changed');
    }
    try {
      if (this.activeContext(this.runtime.state.sessionId) !== null) {
        return immediate('unavailable', 'agent_terminal_context_compaction_run_active');
      }
    } catch {
      return immediate('unavailable', 'agent_terminal_context_compaction_run_state_unavailable');
    }
    const count = (value: unknown): number | null => (
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
    );
    const execute = async (): Promise<SessionCompactionReceipt> => {
      if (!identityMatches()) return {
        ...base(), status: 'unavailable', errorCode: 'agent_terminal_context_compaction_identity_changed',
      };
      if (!await this.waitForSettlement()) return {
        ...base(), status: 'unavailable', errorCode: 'agent_terminal_context_compaction_settlement_timeout',
      };
      if (!identityMatches()) return {
        ...base(), status: 'unavailable', errorCode: 'agent_terminal_context_compaction_identity_changed',
      };
      try {
        if (this.activeContext(this.runtime.state.sessionId) !== null) return {
          ...base(), status: 'unavailable', errorCode: 'agent_terminal_context_compaction_run_active',
        };
      } catch {
        return {
          ...base(), status: 'unavailable', errorCode: 'agent_terminal_context_compaction_run_state_unavailable',
        };
      }
      if (!turnMatches()) return {
        ...base(), status: 'unavailable', errorCode: 'agent_terminal_context_compaction_turn_changed',
      };
      let result: unknown;
      try {
        result = await this.runtime.client.request('session.compress', {
          session_id: expected.hermesSessionId,
          profile: expected.profile,
        });
      } catch (error) {
        return { ...base(), status: 'failed', errorCode: requestError(error) };
      }
      if (!identityMatches() || !result || typeof result !== 'object' || Array.isArray(result)) {
        return {
          ...base(),
          status: 'failed',
          errorCode: identityMatches()
            ? 'agent_terminal_context_compaction_result_invalid'
            : 'agent_terminal_context_compaction_identity_changed',
        };
      }
      const value = result as Record<string, unknown>;
      const info = value.info && typeof value.info === 'object' && !Array.isArray(value.info)
        ? value.info as Record<string, unknown>
        : {};
      const reportedHermes = String(info.session_id || '').trim();
      const reportedStored = String(info.stored_session_id || '').trim();
      if ((reportedHermes && reportedHermes !== expected.hermesSessionId)
        || (reportedStored && reportedStored !== expected.storedSessionId)) {
        return {
          ...base(), status: 'failed', errorCode: 'agent_terminal_context_compaction_identity_changed',
        };
      }
      const measurements = {
        beforeMessages: count(value.before_messages),
        afterMessages: count(value.after_messages),
        beforeTokens: count(value.before_tokens),
        afterTokens: count(value.after_tokens),
      };
      const status = String(value.status || '').trim();
      if (status === 'compressed') {
        return { ...base(), ...measurements, status: 'compressed', errorCode: null };
      }
      if (status === 'aborted') return {
        ...base(), ...measurements, status: 'aborted', errorCode: 'agent_terminal_context_compaction_aborted',
      };
      if (value.lock_held === true) return {
        ...base(), ...measurements, status: 'unavailable',
        errorCode: 'agent_terminal_context_compaction_lock_held',
      };
      if (status === 'pending') return {
        ...base(), ...measurements, status: 'unavailable',
        errorCode: 'agent_terminal_context_compaction_pending',
      };
      if (value.compressed === false) return {
        ...base(), ...measurements, status: 'unavailable',
        errorCode: 'agent_terminal_context_compaction_unavailable',
      };
      return {
        ...base(), ...measurements, status: 'failed',
        errorCode: 'agent_terminal_context_compaction_result_invalid',
      };
    };
    const attempt = this.runtime.turnTail
      .then(execute, execute)
      .then(deliver, () => deliver({
        ...base(), status: 'failed', errorCode: 'agent_terminal_context_compaction_request_failed',
      }));
    this.runtime.turnTail = attempt.then(() => undefined, () => undefined);
    return attempt;
  }

  private waitForSettlement(timeoutMs = SETTLEMENT_TIMEOUT_MS): Promise<boolean> {
    if (this.runtime.hermesTurnSettled) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (settled: boolean) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        this.runtime.hermesTurnSettlementWaiters.delete(finish);
        resolve(settled);
      };
      this.runtime.hermesTurnSettlementWaiters.add(finish);
      if (this.runtime.hermesTurnSettled) {
        finish(true);
        return;
      }
      timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
    });
  }
}
