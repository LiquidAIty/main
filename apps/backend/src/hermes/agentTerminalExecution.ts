import { randomUUID } from 'node:crypto';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { listPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import { buildHermesHostSessionProjection, resolveHermesTurnArgs } from './mainAdapter';
import { registerHermesRootExecutionContext, finishHermesExecutionContext } from './childExecutionContext';
import type { AgentTerminalOwner, AgentTerminalTurnResult } from './agentTerminal';
import {
  handleHermesHostExecutionRequest,
  isHermesHostExecutionMethod,
  startHermesHostTeamMonitor,
  type HermesTeamResultDelivery,
} from './hostExecutionLifecycle';
import {
  runHermesProfileDelegation,
  type HermesProfileDelegationAuthority,
} from './profileDelegation';
import { resolveSavedHermesProvider } from './providerSelection';

type StagedAgentTerminalRun = {
  owner: AgentTerminalOwner;
  profile: string;
  prepared: any;
  runId: string;
  conversationId: string;
  message: string;
  started: number;
  cancelRequested?: boolean;
};

export type AgentTerminalGatewayCompletion = {
  hermesSessionId: string;
  nativeRootId: string | null;
  nativeRunId: string | null;
  effectiveProvider: string | null;
  providerApiMode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
};

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNonNegativeInteger(...values: unknown[]): number | null {
  const value = values.find((candidate) => (
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
  ));
  return typeof value === 'number' ? value : null;
}

function optionalNonNegativeNumber(...values: unknown[]): number | null {
  const value = values.find((candidate) => (
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
  ));
  return typeof value === 'number' ? value : null;
}

function sameOwner(left: AgentTerminalOwner, right: AgentTerminalOwner): boolean {
  return left.userId === right.userId
    && left.projectId === right.projectId
    && left.deckId === right.deckId
    && left.cardId === right.cardId;
}

/** Native CLI transport to the existing saved Card/IDF/Run authority. */
export class AgentTerminalExecution {
  private readonly active = new Map<string, {
    runId: string; contextId: string; hermesSessionId: string; started: number;
    closing?: boolean; cancelRequested?: boolean;
    profileAuthority: HermesProfileDelegationAuthority;
  }>();
  private readonly preparing = new Map<string, {
    cancelled: boolean; runId: string; cancelRequested?: boolean;
  }>();
  private readonly staged = new Map<string, StagedAgentTerminalRun>();
  private readonly children = new Map<string, Set<string>>();

  constructor(private readonly request = requestPythonRailsJson,
    private readonly catalog = listPythonAgentMcpCatalog,
    private readonly delegateProfile = runHermesProfileDelegation,
    private readonly handleHostExecution = handleHermesHostExecutionRequest,
    private readonly startTeamMonitor = startHermesHostTeamMonitor) {}

  /**
   * Bind an already-materialized Card Run to the next turn of one exact
   * Gateway-owned session. The native plugin consumes this once from begin();
   * it does not create another Run or another runtime identity.
   */
  stage(
    owner: AgentTerminalOwner,
    terminalSessionId: string,
    profile: string,
    prepared: any,
    conversationId = '',
  ): { runId: string; message: string } {
    if (this.active.has(terminalSessionId)
      || this.preparing.has(terminalSessionId)
      || this.staged.has(terminalSessionId)) {
      throw new Error('agent_terminal_turn_already_running');
    }
    const runId = String(prepared?.runId || '').trim();
    if (prepared?.runtimeOwner !== 'hermes' || !runId || !prepared?.hermesTransport) {
      throw new Error('agent_terminal_staged_run_invalid');
    }
    const args = resolveHermesTurnArgs({
      prepared,
      projectId: owner.projectId,
      deckId: owner.deckId,
      conversationId,
      parentRunId: runId,
      onEvent: () => undefined,
    }, prepared.hermesTransport);
    if (args.cardId !== owner.cardId || args.runtime.profile !== profile) {
      throw new Error('agent_terminal_staged_run_identity_mismatch');
    }
    const staged = {
      owner: { ...owner },
      profile,
      prepared,
      runId,
      conversationId,
      message: args.message,
      started: Date.now(),
    } satisfies StagedAgentTerminalRun;
    this.staged.set(terminalSessionId, staged);
    return { runId, message: staged.message };
  }

  /** Persist the exact native Gateway completion for an application-submitted turn. */
  async completeStaged(
    terminalSessionId: string,
    nativeSessionId: string,
    result: AgentTerminalTurnResult,
  ): Promise<AgentTerminalGatewayCompletion> {
    const staged = this.staged.get(terminalSessionId);
    if (!staged) throw new Error('agent_terminal_staged_run_missing');
    this.staged.delete(terminalSessionId);

    const payload = result.event.payload || {};
    const nativeUsage = payload.usage && typeof payload.usage === 'object'
      ? payload.usage as Record<string, unknown>
      : {};
    const selectedProvider = resolveSavedHermesProvider(
      staged.prepared.hermesTransport.request.provider,
    );
    const completion: AgentTerminalGatewayCompletion = {
      hermesSessionId: nativeSessionId,
      nativeRootId: optionalText(payload.nativeRootId ?? payload.native_root_id),
      nativeRunId: optionalText(payload.nativeRunId ?? payload.native_run_id),
      effectiveProvider: optionalText(payload.effectiveProvider ?? payload.effective_provider)
        ?? selectedProvider.provider,
      providerApiMode: optionalText(payload.providerApiMode ?? payload.provider_api_mode)
        ?? selectedProvider.apiMode,
      inputTokens: optionalNonNegativeInteger(
        nativeUsage.providerInputTokens,
        nativeUsage.inputTokens,
        nativeUsage.input_tokens,
        nativeUsage.prompt_tokens,
      ),
      outputTokens: optionalNonNegativeInteger(
        nativeUsage.providerOutputTokens,
        nativeUsage.outputTokens,
        nativeUsage.output_tokens,
        nativeUsage.completion_tokens,
      ),
      cachedTokens: optionalNonNegativeInteger(
        nativeUsage.providerCachedTokens,
        nativeUsage.cachedTokens,
        nativeUsage.cached_tokens,
      ),
      reasoningTokens: optionalNonNegativeInteger(
        nativeUsage.providerReasoningTokens,
        nativeUsage.reasoningTokens,
        nativeUsage.reasoning_tokens,
      ),
      costUsd: optionalNonNegativeNumber(
        nativeUsage.totalCostUsd,
        nativeUsage.total_cost_usd,
        nativeUsage.costUsd,
        nativeUsage.cost_usd,
      ),
    };
    await this.request('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: staged.runId,
        state: 'completed',
        finalResult: result.text,
        hermesSessionRef: completion.hermesSessionId,
        providerThreadRef: completion.nativeRootId,
        providerTurnRef: completion.nativeRunId,
        effectiveProvider: completion.effectiveProvider,
        providerApiMode: completion.providerApiMode,
        providerInputTokens: completion.inputTokens,
        providerOutputTokens: completion.outputTokens,
        providerCachedTokens: completion.cachedTokens,
        providerReasoningTokens: completion.reasoningTokens,
        totalCostUsd: completion.costUsd,
        durationMs: Date.now() - staged.started,
      }),
    });
    return completion;
  }

  async cancelStaged(
    terminalSessionId: string,
    errorSummary: string,
    state: 'failed' | 'cancelled' = 'failed',
  ): Promise<boolean> {
    const staged = this.staged.get(terminalSessionId);
    if (!staged) return false;
    this.staged.delete(terminalSessionId);
    await this.request('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: staged.runId,
        state,
        errorSummary: String(errorSummary || 'agent_terminal_staged_turn_cancelled'),
      }),
    });
    return true;
  }

  async begin(owner: AgentTerminalOwner, terminalSessionId: string, profile: string,
    payload: Record<string, unknown>) {
    if (this.active.has(terminalSessionId) || this.preparing.has(terminalSessionId)) {
      throw new Error('agent_terminal_turn_already_running');
    }
    const { message, nativeSessionId, model, provider } = payload;
    if (typeof message !== 'string' || !message.trim() || message.length > 512_000
      || typeof nativeSessionId !== 'string' || !nativeSessionId || nativeSessionId.length > 256) {
      throw new Error('agent_terminal_turn_input_invalid');
    }
    const preparation = { cancelled: false, runId: '', cancelRequested: false };
    this.preparing.set(terminalSessionId, preparation);
    let persistedRunId = '';
    let contextId = '';
    try {
      const staged = this.staged.get(terminalSessionId);
      let prepared: any;
      let conversationId = '';
      if (staged) {
        this.staged.delete(terminalSessionId);
        persistedRunId = staged.runId;
        preparation.runId = staged.runId;
        conversationId = staged.conversationId;
        if (!sameOwner(staged.owner, owner)
          || staged.profile !== profile
          || staged.message !== message) {
          throw new Error('agent_terminal_staged_run_identity_mismatch');
        }
        if (staged.cancelRequested) throw new Error('hermes_turn_cancelled');
        prepared = staged.prepared;
      } else {
        const runId = randomUUID();
        prepared = await this.request('/domain/runs/begin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: owner.projectId, deckId: owner.deckId,
            cardId: owner.cardId, assignment: message, runId, correlationId: runId,
            discoveredTools: await this.catalog() }),
        });
      }
      persistedRunId = String(prepared.runId || '');
      preparation.runId = persistedRunId;
      if (!persistedRunId) throw new Error('agent_terminal_run_not_persisted');
      if (preparation.cancelled) throw new Error('native_cli_process_exited');
      const args = resolveHermesTurnArgs({ prepared, projectId: owner.projectId,
        deckId: owner.deckId, conversationId, parentRunId: persistedRunId,
        onEvent: () => undefined }, prepared.hermesTransport);
      if (args.cardId !== owner.cardId || args.runtime.profile !== profile
        || args.providerModelId !== model || args.nativeProvider !== provider
      ) {
        throw new Error('agent_terminal_native_configuration_mismatch');
      }
      args.sessionKey = JSON.stringify([owner.userId, owner.projectId, owner.deckId,
        owner.cardId, profile, nativeSessionId]);
      args.terminalOwner = { userId: owner.userId, terminalSessionId, profile,
        cardRevisionId: String(prepared.cardRevisionId || '') };
      const context = registerHermesRootExecutionContext({
        sessionId: nativeSessionId, runId: persistedRunId, projectId: owner.projectId,
        deckId: owner.deckId, conversationId, cardId: owner.cardId,
        runtimeMode: args.runtime.mode, terminalOwner: args.terminalOwner,
        grantedTools: args.grantedTools || [],
      });
      contextId = context.contextId;
      const projection = buildHermesHostSessionProjection(args, process.env, contextId);
      this.active.set(terminalSessionId, { runId: persistedRunId, contextId,
        hermesSessionId: nativeSessionId, started: Date.now(),
        profileAuthority: {
          projectId: owner.projectId,
          deckId: owner.deckId,
          deckRevision: String(args.deckRevision || ''),
          conversationId,
          parentRunId: persistedRunId,
          sourceCardId: owner.cardId,
          sourceRuntimeMode: args.runtime.mode,
          parentExecutionContextId: contextId,
          profileTargets: [...(args.profileTargets || [])],
        },
      });
      return { runId: persistedRunId, executionContextId: contextId,
        message: args.message, mcpServers: projection.mcpServers,
        sessionConfig: (projection.sessionMeta as any).hermes.sessionConfig };
    } catch (error) {
      const cancelled = preparation.cancelRequested
        || (error instanceof Error && error.message === 'hermes_turn_cancelled');
      if (contextId) await finishHermesExecutionContext({
        contextId,
        state: cancelled ? 'cancelled' : 'failed',
      });
      if (persistedRunId) await this.request('/domain/runs/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: persistedRunId,
          state: cancelled ? 'cancelled' : 'failed',
          errorSummary: String(error),
        }),
      });
      throw error;
    } finally { this.preparing.delete(terminalSessionId); }
  }

  async finish(terminalSessionId: string, payload: Record<string, unknown>) {
    const active = this.active.get(terminalSessionId);
    if (!active || active.closing || active.contextId !== payload.executionContextId) {
      throw new Error('agent_terminal_execution_context_mismatch');
    }
    const result = payload.result as Record<string, unknown> | undefined;
    const error = String(payload.error || result?.error || '');
    const failed = !!error || !result || result.failed === true || result.completed !== true;
    const providerThreadRef = typeof result?.codex_thread_id === 'string'
      ? result.codex_thread_id.trim() : '';
    const providerTurnRef = typeof result?.codex_turn_id === 'string'
      ? result.codex_turn_id.trim() : '';
    const effectiveProvider = typeof result?.effective_provider === 'string'
      ? result.effective_provider.trim() : '';
    const providerApiMode = typeof result?.provider_api_mode === 'string'
      ? result.provider_api_mode.trim() : '';
    const terminalState = active.cancelRequested
      ? 'cancelled'
      : failed ? 'failed' : 'completed';
    const nativeUsage = payload.usage as Record<string, unknown> | undefined;
    const usage = Object.fromEntries(['providerInputTokens', 'providerOutputTokens',
      'providerCachedTokens', 'providerReasoningTokens'].map((field) => [field,
      typeof nativeUsage?.[field] === 'number' && Number.isSafeInteger(nativeUsage[field]) && Number(nativeUsage[field]) >= 0
        ? nativeUsage[field] : null]));
    active.closing = true;
    try {
      // Close authorization before awaiting persistence so a finishing turn
      // cannot dispatch another tool or attach another child.
      await finishHermesExecutionContext({ contextId: active.contextId,
        state: terminalState });
      for (const contextId of this.children.get(terminalSessionId) || []) {
        await finishHermesExecutionContext({ contextId, state: 'cancelled',
          errorSummary: 'native_cli_parent_turn_finished', request: this.request });
      }
      await this.request('/domain/runs/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: active.runId, state: terminalState,
          errorSummary: terminalState !== 'completed'
            ? error || (active.cancelRequested
              ? 'hermes_turn_cancelled'
              : String(result?.turn_exit_reason || 'hermes_turn_incomplete'))
            : undefined,
          finalResult: typeof result?.final_response === 'string' ? result.final_response : '',
          hermesSessionRef: active.hermesSessionId,
          providerThreadRef: providerThreadRef || undefined,
          providerTurnRef: providerTurnRef || undefined,
          effectiveProvider: effectiveProvider || undefined,
          providerApiMode: providerApiMode || undefined,
          durationMs: Date.now() - active.started,
          ...usage, totalCostUsd: null }),
      });
      return { ok: true, runId: active.runId };
    } finally {
      this.active.delete(terminalSessionId);
      this.children.delete(terminalSessionId);
    }
  }

  async host(
    terminalSessionId: string,
    payload: Record<string, unknown>,
    appendTeamResult?: (result: HermesTeamResultDelivery) => Promise<void>,
  ) {
    const active = this.active.get(terminalSessionId);
    const params = payload.params as Record<string, unknown> | undefined;
    if (!active || active.closing || !params) {
      throw new Error('agent_terminal_host_request_invalid');
    }
    if (payload.method === 'session/delegate_profile') {
      return this.delegateProfile(active.profileAuthority, params);
    }
    if (!isHermesHostExecutionMethod(payload.method)) {
      throw new Error('agent_terminal_host_request_invalid');
    }
    const children = this.children.get(terminalSessionId) || new Set<string>();
    this.children.set(terminalSessionId, children);
    if (payload.method === 'session/create_execution_context') {
      if (params.sessionId !== active.hermesSessionId
        || (params.parentExecutionContextId !== active.contextId
          && !children.has(String(params.parentExecutionContextId)))) {
        throw new Error('agent_terminal_child_identity_mismatch');
      }
    } else if (!children.has(String(params.executionContextId))) {
      throw new Error('agent_terminal_child_identity_mismatch');
    }
    const result = await this.handleHostExecution({ method: payload.method, params });
    if (active.closing && result.nativeContext) {
      await finishHermesExecutionContext({ contextId: result.nativeContext.contextId,
        state: 'cancelled', errorSummary: 'native_cli_parent_turn_finished', request: this.request });
      throw new Error('agent_terminal_parent_turn_finished');
    }
    if (result.nativeContext) {
      children.add(result.nativeContext.contextId);
      if (!appendTeamResult) {
        await finishHermesExecutionContext({
          contextId: result.nativeContext.contextId,
          state: 'failed',
          errorSummary: 'agent_terminal_team_result_sink_missing',
          request: this.request,
        });
        children.delete(result.nativeContext.contextId);
        throw new Error('agent_terminal_team_result_sink_missing');
      }
      this.startTeamMonitor({
        context: result.nativeContext,
        appendRetryAttempts: 900,
        appendTeamResult,
      });
    }
    return result.result;
  }

  ownsRun(terminalSessionId: string, runId: string): boolean {
    return this.staged.get(terminalSessionId)?.runId === runId
      || this.preparing.get(terminalSessionId)?.runId === runId
      || this.active.get(terminalSessionId)?.runId === runId;
  }

  activeRunId(terminalSessionId: string): string | null {
    return this.staged.get(terminalSessionId)?.runId
      || this.preparing.get(terminalSessionId)?.runId
      || this.active.get(terminalSessionId)?.runId
      || null;
  }

  requestCancellation(terminalSessionId: string, runId: string): void {
    const staged = this.staged.get(terminalSessionId);
    if (staged?.runId === runId) {
      staged.cancelRequested = true;
      return;
    }
    const preparing = this.preparing.get(terminalSessionId);
    if (preparing?.runId === runId) {
      preparing.cancelled = true;
      preparing.cancelRequested = true;
      return;
    }
    const active = this.active.get(terminalSessionId);
    if (active?.runId === runId && !active.closing) {
      active.cancelRequested = true;
      return;
    }
    throw new Error('agent_terminal_run_not_active');
  }

  async abort(terminalSessionId: string, reason = 'native_cli_process_exited') {
    await this.cancelStaged(terminalSessionId, reason);
    const preparation = this.preparing.get(terminalSessionId);
    if (preparation) preparation.cancelled = true;
    const active = this.active.get(terminalSessionId);
    if (active && !active.closing) await this.finish(terminalSessionId, {
      executionContextId: active.contextId, error: reason,
    });
  }
}

export const agentTerminalExecution = new AgentTerminalExecution();
