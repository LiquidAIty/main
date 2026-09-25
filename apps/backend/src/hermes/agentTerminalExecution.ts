import { requestPythonRailsJson } from '../services/pythonRailsClient';
import type { AgentTerminalOwner, AgentTerminalTurnResult } from './agentTerminal';
import { resolveSavedHermesProvider } from './providerSelection';

type StagedAgentTerminalRun = {
  owner: AgentTerminalOwner;
  profile: string;
  prepared: any;
  runId: string;
  conversationId: string;
  message: string;
  routing: AgentTerminalTurnRouting;
  started: number;
  cancelRequested?: boolean;
};

export type AgentTerminalGatewayCompletion = {
  hermesSessionId: string;
  nativeRootId: string | null;
  nativeRunId: string | null;
  effectiveProvider: string | null;
  actualModel: string | null;
  exposedTools: string[];
  executionEvidence: unknown[];
  executionEvidenceComplete: boolean;
  executionEvidenceError: string | null;
  providerApiMode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
};

export type AgentTerminalTurnRouting = {
  managedCanonicalTools: string[];
  allowedCanonicalTools: string[];
  authorizedCanonicalTools: string[];
  modelOnce: {
    provider: string;
    model: string;
    reasoningEffort?: string;
  } | null;
};

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function exactStringList(value: unknown, error: string): string[] {
  if (!Array.isArray(value) || value.length > 512) throw new Error(error);
  const result = value.map((item) => String(item || '').trim());
  if (result.some((item) => !item || item.length > 256) || new Set(result).size !== result.length) {
    throw new Error(error);
  }
  return result;
}

function resolveTurnRouting(prepared: any, input: any): AgentTerminalTurnRouting {
  const autoTools = prepared?.jevAutoTools;
  const toolReceipt = autoTools && typeof autoTools === 'object' && !Array.isArray(autoTools)
    ? autoTools
    : {};
  const managedCanonicalTools = exactStringList(
    Object.prototype.hasOwnProperty.call(toolReceipt, 'normalAuthorizedTools')
      ? toolReceipt.normalAuthorizedTools
      : input?.presentedTools || [],
    'agent_terminal_turn_tools_invalid',
  );
  const allowedCanonicalTools = exactStringList(
    input?.presentedTools || [],
    'agent_terminal_turn_tools_invalid',
  );
  if (!allowedCanonicalTools.every((name) => managedCanonicalTools.includes(name))) {
    throw new Error('agent_terminal_turn_tools_broadened');
  }
  const authorizedCanonicalTools = exactStringList(
    Array.isArray(toolReceipt.selectedTools)
      ? toolReceipt.selectedTools
      : allowedCanonicalTools,
    'agent_terminal_turn_tools_invalid',
  );
  if (!authorizedCanonicalTools.every((name) => managedCanonicalTools.includes(name))) {
    throw new Error('agent_terminal_turn_tools_broadened');
  }

  const router = prepared?.jevModelRouter;
  const routerReceipt = router && typeof router === 'object' && !Array.isArray(router)
    ? router
    : {};
  const saved = routerReceipt.savedModel && typeof routerReceipt.savedModel === 'object'
    ? routerReceipt.savedModel as Record<string, unknown>
    : {};
  const selected = routerReceipt.selectedModel && typeof routerReceipt.selectedModel === 'object'
    ? routerReceipt.selectedModel as Record<string, unknown>
    : {};
  const routeChanged = routerReceipt.enabled === true
    && ['selected', 'deterministic'].includes(String(routerReceipt.status || ''))
    && (
      String(saved.provider || '') !== String(selected.provider || '')
      || String(saved.modelKey || '') !== String(selected.modelKey || '')
      || String(saved.providerModelId || '') !== String(selected.providerModelId || '')
    );
  const resolved = resolvePreparedHermesProvider(input);
  const reasoningEffort = optionalText(input?.runtimeOptions?.reasoningEffort);
  return {
    managedCanonicalTools,
    allowedCanonicalTools,
    authorizedCanonicalTools,
    modelOnce: routeChanged ? {
      provider: resolved.provider,
      model: resolved.model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    } : null,
  };
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

function resolvePreparedHermesProvider(input: any) {
  const provider = input?.provider && typeof input.provider === 'object'
    && !Array.isArray(input.provider)
    ? input.provider
    : {};
  const runtimeOptions = input?.runtimeOptions && typeof input.runtimeOptions === 'object'
    && !Array.isArray(input.runtimeOptions)
    ? input.runtimeOptions
    : {};
  return resolveSavedHermesProvider({
    ...provider,
    openaiRuntime: runtimeOptions.openaiRuntime,
  });
}

function resolveStagedRun(
  owner: AgentTerminalOwner,
  profile: string,
  prepared: any,
): { runId: string; message: string; routing: AgentTerminalTurnRouting } {
  const transport = prepared?.hermesTransport;
  const identity = transport?.cardIdentity;
  const input = transport?.request;
  const runtime = input?.runtime;
  const runId = String(prepared?.runId || '').trim();
  const message = typeof input?.message === 'string' ? input.message : '';
  if (
    prepared?.runtimeOwner !== 'hermes'
    || !runId
    || !input
    || typeof input !== 'object'
    || runtime?.kind !== 'hermes'
    || !['main', 'delegate', 'kanban'].includes(runtime?.mode)
    || !String(runtime?.profile || '').trim()
    || !message.trim()
    || message.length > 512_000
  ) {
    throw new Error('agent_terminal_staged_run_invalid');
  }
  const retiredFields = [
    'systemPrompt',
    'outputRequirements',
    'builderOperation',
    'agentBuilderOperation',
    'buildTarget',
    'selectedCardTarget',
    'effectTarget',
    'effectTargetCardId',
    'effectTargetCardRevisionId',
    'effectTargetDeckRevision',
  ].filter((field) => Object.prototype.hasOwnProperty.call(input, field));
  if (retiredFields.length > 0) {
    throw new Error(`prepared_hermes_fields_retired:${retiredFields.join(',')}`);
  }
  const cardId = String(identity?.cardId || '').trim();
  const cardRevisionId = String(prepared?.cardRevisionId || '').trim();
  const cardRevisionSha256 = String(prepared?.cardRevisionSha256 || '').trim();
  const authorityFingerprint = String(prepared?.executionAuthorityFingerprint || '').trim();
  if (
    cardId !== owner.cardId
    || String(runtime.profile).trim() !== profile
    || !cardRevisionId
    || !/^[a-f0-9]{64}$/.test(cardRevisionSha256)
    || !/^[a-f0-9]{64}$/.test(authorityFingerprint)
    || String(input.runtimeOptions?.executionAuthorityFingerprint || '') !== authorityFingerprint
  ) {
    throw new Error('agent_terminal_staged_run_identity_mismatch');
  }
  // Validate the exact saved provider before any text reaches the native session.
  resolvePreparedHermesProvider(input);
  return { runId, message, routing: resolveTurnRouting(prepared, input) };
}

/**
 * Binds one already-materialized Card Run to one native Gateway turn.
 * Gateway owns the native session and transport; this class only preserves the
 * canonical Run receipt around that submitted turn.
 */
export class AgentTerminalExecution {
  private readonly staged = new Map<string, StagedAgentTerminalRun>();

  constructor(private readonly request = requestPythonRailsJson) {}

  stage(
    owner: AgentTerminalOwner,
    terminalSessionId: string,
    profile: string,
    prepared: any,
    conversationId = '',
  ): { runId: string; message: string; routing: AgentTerminalTurnRouting } {
    if (this.staged.has(terminalSessionId)) {
      throw new Error('agent_terminal_turn_already_running');
    }
    const { runId, message, routing } = resolveStagedRun(owner, profile, prepared);
    this.staged.set(terminalSessionId, {
      owner: { ...owner },
      profile,
      prepared,
      runId,
      conversationId,
      message,
      routing,
      started: Date.now(),
    });
    return { runId, message, routing };
  }

  /** Persist the exact native Gateway completion for an application-submitted turn. */
  async completeStaged(
    terminalSessionId: string,
    nativeSessionId: string,
    result: AgentTerminalTurnResult,
  ): Promise<AgentTerminalGatewayCompletion> {
    const staged = this.staged.get(terminalSessionId);
    if (!staged) throw new Error('agent_terminal_staged_run_missing');
    if (staged.cancelRequested) {
      await this.cancelStaged(terminalSessionId, 'hermes_turn_cancelled', 'cancelled');
      throw new Error('hermes_turn_cancelled');
    }
    const payload = result.event.payload || {};
    const nativeUsage = payload.usage && typeof payload.usage === 'object'
      ? payload.usage as Record<string, unknown>
      : {};
    const selectedProvider = resolvePreparedHermesProvider(
      staged.prepared.hermesTransport.request,
    );
    const actualProvider = optionalText(payload.actualProvider ?? payload.actual_provider);
    const actualModel = optionalText(payload.actualModel ?? payload.actual_model);
    if (!actualProvider || !actualModel) {
      throw new Error('agent_terminal_actual_model_missing');
    }
    const exposedTools = exactStringList(
      payload.exposedTools ?? payload.exposed_tools ?? [],
      'agent_terminal_completion_tools_invalid',
    );
    const executionEvidence = Array.isArray(payload.executionEvidence)
      ? payload.executionEvidence
      : [];
    const executionEvidenceComplete = payload.executionEvidenceComplete === true;
    const executionEvidenceError = optionalText(payload.executionEvidenceError);
    if (actualProvider !== selectedProvider.provider || actualModel !== selectedProvider.model) {
      throw new Error('agent_terminal_actual_model_mismatch');
    }
    const completion: AgentTerminalGatewayCompletion = {
      hermesSessionId: nativeSessionId,
      nativeRootId: optionalText(payload.nativeRootId ?? payload.native_root_id),
      nativeRunId: optionalText(payload.nativeRunId ?? payload.native_run_id),
      effectiveProvider: actualProvider,
      actualModel,
      exposedTools,
      executionEvidence,
      executionEvidenceComplete,
      executionEvidenceError,
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
    this.staged.delete(terminalSessionId);
    return completion;
  }

  async cancelStaged(
    terminalSessionId: string,
    errorSummary: string,
    state: 'failed' | 'cancelled' = 'failed',
  ): Promise<boolean> {
    const staged = this.staged.get(terminalSessionId);
    if (!staged) return false;
    await this.request('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: staged.runId,
        state,
        errorSummary: String(errorSummary || 'agent_terminal_staged_turn_cancelled'),
      }),
    });
    this.staged.delete(terminalSessionId);
    return true;
  }

  ownsRun(terminalSessionId: string, runId: string): boolean {
    return this.staged.get(terminalSessionId)?.runId === runId;
  }

  activeRunId(terminalSessionId: string): string | null {
    return this.staged.get(terminalSessionId)?.runId || null;
  }

  activeContext(terminalSessionId: string): {
    runId: string;
    conversationId: string;
    authorizedCanonicalTools: string[];
  } | null {
    const staged = this.staged.get(terminalSessionId);
    return staged ? {
      runId: staged.runId,
      conversationId: staged.conversationId,
      authorizedCanonicalTools: [...staged.routing.authorizedCanonicalTools],
    } : null;
  }

  requestCancellation(terminalSessionId: string, runId: string): void {
    const staged = this.staged.get(terminalSessionId);
    if (staged?.runId !== runId) throw new Error('agent_terminal_run_not_active');
    staged.cancelRequested = true;
  }

  async abort(terminalSessionId: string, reason = 'native_cli_process_exited'): Promise<void> {
    await this.cancelStaged(terminalSessionId, reason);
  }
}

export const agentTerminalExecution = new AgentTerminalExecution();
