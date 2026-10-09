import { createHash, randomUUID } from 'node:crypto';

import type { ConversationMessage } from '../conversations/store';
import { autoModelCandidates } from '../llm/models.config';
import type { HermesGatewayClient, HermesGatewayEvent } from './hermesGateway';
import type { SessionBinding } from './hermesCardSession';
import { readToolCatalog } from './mcp/toolCatalogMcpClient';
import { requestPythonRailsJson } from './pythonRailsClient';
import {
  boundedSharedContext,
  exactStrings,
  objectRecord,
  type AddressableCard,
} from './savedCardAuthority';

export type PreparedCardRun = {
  runId: string;
  request: Record<string, unknown>;
};

export type HermesDynamicToolDefinition = {
  type: 'function';
  name: string;
  canonical_name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type HermesCardScriptDefinition = {
  version: number;
  source: string;
  source_hash: string;
  compiled_hash: string;
  mode: 'tool_recipe';
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  tool_aliases: Record<string, string>;
  tool_states: Record<string, number>;
  timeout_seconds: number;
  max_tool_calls: number;
  max_output_bytes: number;
};

class SavedCardRunFailure extends Error {
  constructor(
    readonly failureCode: string,
    message: string = failureCode,
    readonly terminal?: { event: HermesGatewayEvent; toolCalls: number },
  ) {
    super(message);
    this.name = 'SavedCardRunFailure';
  }
}

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'blocked', 'cancelled']);

function settledRunState(value: unknown, runId: string): string {
  const settled = objectRecord(value);
  const runRecord = objectRecord(settled.runRecord);
  const state = String(runRecord.state || settled.state || '').trim();
  if (
    settled.ok !== true
    || String(settled.runId || '') !== runId
    || !TERMINAL_RUN_STATES.has(state)
  ) {
    throw new SavedCardRunFailure('saved_card_settlement_unconfirmed');
  }
  return state;
}

function boundedFailureCode(value: unknown): string | null {
  const code = String(value || '').trim();
  return /^[a-z][a-z0-9_]{2,120}$/.test(code) ? code : null;
}

function failureFields(
  error: unknown,
  fallbackCode: string,
): { errorCode: string; errorSummary: string } {
  if (error instanceof SavedCardRunFailure) {
    return { errorCode: error.failureCode, errorSummary: error.message };
  }
  const errorSummary = error instanceof Error ? error.message : String(error || fallbackCode);
  const explicitCode = boundedFailureCode(errorSummary.split(':', 1)[0]);
  return { errorCode: explicitCode || fallbackCode, errorSummary };
}

function isCancellationFailure(code: string): boolean {
  return code === 'hermes_turn_cancelled'
    || code === 'hermes_turn_interrupted'
    || code === 'saved_specialist_cancelled';
}

function completedTurnFailure(
  event: HermesGatewayEvent,
  status: string,
  toolCalls: number,
): SavedCardRunFailure {
  const payload = objectRecord(event.payload);
  const surface = objectRecord(payload.error_surface);
  const surfaceCode = boundedFailureCode(surface.code);
  const surfaceLayer = String(surface.layer || '').trim();
  const fallbackCode = status === 'interrupted'
    ? 'hermes_turn_interrupted'
    : surfaceLayer === 'tool'
      ? 'hermes_tool_failed'
      : 'hermes_inference_failed';
  const code = surfaceCode || fallbackCode;
  const summary = String(
    payload.error || payload.failure_reason || payload.text || code,
  );
  return new SavedCardRunFailure(code, summary, { event, toolCalls });
}

function confirmedExecutionFields(
  binding: SessionBinding,
  event?: HermesGatewayEvent,
  allowFailureFallback = false,
): Record<string, string> {
  if (!event) return {};
  const payload = objectRecord(event?.payload);
  const turnUsage = objectRecord(payload.turn_usage);
  const usage = Object.keys(turnUsage).length
    ? turnUsage
    : allowFailureFallback ? objectRecord(payload.usage) : {};
  const surface = objectRecord(payload.error_surface);
  const provider = String(surface.provider || binding.info.provider || '').trim();
  const model = String(
    usage.model || (allowFailureFallback ? surface.model || binding.info.model : ''),
  ).trim();
  if (!provider || !model) return {};
  const reportedApiMode = String(binding.info.api_mode || '').trim();
  const providerApiMode = reportedApiMode
    || (provider === 'openai-codex' ? 'codex_app_server' : '');
  return {
    provider,
    model,
    effectiveProvider: provider,
    ...(providerApiMode ? { providerApiMode } : {}),
  };
}

function runProvider(requestValue: unknown): {
  providerModelId: string;
} {
  const request = objectRecord(requestValue);
  const provider = objectRecord(request.provider);
  const runtimeOptions = objectRecord(request.runtimeOptions);
  if (runtimeOptions.autoModel !== undefined && typeof runtimeOptions.autoModel !== 'boolean') {
    throw new SavedCardRunFailure('saved_card_auto_model_invalid');
  }
  const providerModelId = String(provider.providerModelId || '').trim();
  if (!providerModelId) throw new SavedCardRunFailure('saved_card_run_model_missing');
  return { providerModelId };
}

async function ensureHermesTurnModel(args: {
  client: HermesGatewayClient;
  binding: SessionBinding;
  profile: string;
  runRequest: Record<string, unknown>;
}): Promise<string> {
  const desired = runProvider(args.runRequest).providerModelId;
  const liveProvider = String(args.binding.info.provider || '').trim();
  if (!liveProvider || !args.binding.sessionId || !args.binding.storedSessionId) {
    throw new SavedCardRunFailure('hermes_session_model_binding_invalid');
  }
  if (String(args.binding.info.model || '').trim() !== desired) {
    const changed = objectRecord(await args.client.request('config.set', {
      profile: args.profile,
      session_id: args.binding.sessionId,
      key: 'model',
      value: `${desired} --provider ${liveProvider} --session`,
      scope: 'session',
      confirm_expensive_model: false,
    }));
    if (
      String(changed.key || '') !== 'model'
      || String(changed.value || '') !== desired
      || String(changed.scope || '') !== 'session'
      || changed.deferred === true
      || changed.confirm_required === true
    ) throw new SavedCardRunFailure('hermes_session_model_apply_failed');
  }
  const activated = objectRecord(await args.client.request('session.activate', {
    profile: args.profile,
    session_id: args.binding.sessionId,
    omit_messages: true,
    bot_mode_roster: args.binding.botModeRoster,
  }));
  const info = objectRecord(activated.info);
  if (
    String(activated.session_id || '') !== args.binding.sessionId
    || String(activated.stored_session_id || activated.session_key || '')
      !== args.binding.storedSessionId
    || activated.messages_omitted !== true
    || String(info.provider || '') !== liveProvider
    || String(info.model || '') !== desired
  ) throw new SavedCardRunFailure('hermes_session_model_readback_mismatch');
  args.binding.info = info;
  return desired;
}

function requireCompletionModel(
  event: HermesGatewayEvent,
  desired: string,
  failed: boolean,
  toolCalls: number,
): void {
  const payload = objectRecord(event.payload);
  const turnUsage = objectRecord(payload.turn_usage);
  const hasTurnUsage = Object.keys(turnUsage).length > 0;
  const reported = String(
    turnUsage.model || (failed && !hasTurnUsage ? objectRecord(payload.usage).model : ''),
  ).trim();
  if (!reported || reported !== desired) {
    throw new SavedCardRunFailure(
      'auto_model_execution_mismatch',
      `auto_model_execution_mismatch:${desired}:${reported || 'missing'}`,
      { event, toolCalls },
    );
  }
}

function hermesDynamicToolName(canonicalName: string): string {
  const stem = canonicalName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 72)
    || 'tool';
  const suffix = createHash('sha256').update(canonicalName).digest('hex').slice(0, 10);
  return `card__${stem}__${suffix}`;
}

export function hermesDynamicToolDefinitions(value: unknown): HermesDynamicToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const seenNames = new Set<string>();
  return value.map(objectRecord).map((definition, index) => {
    const canonicalName = String(definition.canonicalId || '').trim();
    const publications = exactStrings(definition.publications);
    const inputSchema = objectRecord(definition.inputSchema);
    if (
      !canonicalName
      || definition.available !== true
      || !publications.some((item) => item === 'card-runtime' || item === 'external-mcp')
      || !Object.keys(inputSchema).length
    ) {
      throw new Error(`dynamic_tool_contract_unavailable:${canonicalName || index}`);
    }
    const name = hermesDynamicToolName(canonicalName);
    if (seenNames.has(name)) throw new Error(`dynamic_tool_name_collision:${canonicalName}`);
    seenNames.add(name);
    return {
      type: 'function' as const,
      name,
      canonical_name: canonicalName,
      description: String(definition.description || ''),
      input_schema: inputSchema,
    };
  });
}

export function hermesCardScriptDefinition(
  requestValue: unknown,
): HermesCardScriptDefinition | undefined {
  const request = objectRecord(requestValue);
  if (objectRecord(request.scriptPresentation).mode !== 'script') return undefined;
  const script = objectRecord(objectRecord(request.runtimeOptions).script);
  const compiled = objectRecord(script.compiled);
  const source = String(script.source || '');
  const sourceHash = String(script.sourceHash || '');
  const compiledHash = String(script.compiledHash || '');
  const version = Number(script.version);
  const inputSchema = objectRecord(compiled.inputSchema);
  const outputSchema = objectRecord(compiled.outputSchema);
  const toolStates = objectRecord(compiled.toolStates);
  const scriptToolIds = exactStrings(compiled.scriptToolIds);
  const agentToolIds = exactStrings(compiled.agentToolIds);
  const enabledTools = new Set(exactStrings(request.enabledTools));
  const presentedTools = exactStrings(request.presentedTools);
  const boundedInteger = (value: unknown, minimum: number, maximum: number): number => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new Error('card_script_compiled_budget_invalid');
    }
    return parsed;
  };
  if (
    !Number.isSafeInteger(version) || version < 1
    || !source.trim() || Buffer.byteLength(source, 'utf8') > 32_768
    || !/^[0-9a-f]{64}$/.test(sourceHash)
    || createHash('sha256').update(source, 'utf8').digest('hex') !== sourceHash
    || !/^[0-9a-f]{64}$/.test(compiledHash)
    || compiled.mode !== 'tool_recipe'
    || inputSchema.type !== 'object'
    || outputSchema.type !== 'object'
    || script.lastValidation === undefined
    || objectRecord(script.lastValidation).status !== 'valid'
  ) {
    throw new Error('card_script_compiled_contract_invalid');
  }
  if (
    [...scriptToolIds, ...agentToolIds].some((name) => !enabledTools.has(name))
    || presentedTools.length !== agentToolIds.length
    || presentedTools.some((name, index) => name !== agentToolIds[index])
  ) {
    throw new Error('card_script_tool_scope_invalid');
  }
  const normalizedStates: Record<string, number> = {};
  for (const [name, rawMode] of Object.entries(toolStates)) {
    const mode = Number(rawMode);
    if (!enabledTools.has(name) || !Number.isInteger(mode) || mode < 0 || mode > 3) {
      throw new Error('card_script_tool_scope_invalid');
    }
    normalizedStates[name] = mode;
  }
  const expectedScriptTools = Object.entries(normalizedStates)
    .filter(([, mode]) => mode === 1 || mode === 3)
    .map(([name]) => name);
  if (
    expectedScriptTools.length !== scriptToolIds.length
    || expectedScriptTools.some((name, index) => name !== scriptToolIds[index])
  ) {
    throw new Error('card_script_tool_scope_invalid');
  }
  return {
    version,
    source,
    source_hash: sourceHash,
    compiled_hash: compiledHash,
    mode: 'tool_recipe',
    input_schema: inputSchema,
    output_schema: outputSchema,
    tool_aliases: Object.fromEntries(scriptToolIds.map((canonicalName) => [
      canonicalName,
      hermesDynamicToolName(canonicalName),
    ])),
    tool_states: normalizedStates,
    timeout_seconds: boundedInteger(compiled.timeoutSeconds, 1, 60),
    max_tool_calls: boundedInteger(compiled.maxToolCalls, 1, 32),
    max_output_bytes: boundedInteger(compiled.maxOutputBytes, 256, 50_000),
  };
}

export function hermesCallbackToolNames(
  dynamicTools: HermesDynamicToolDefinition[],
  cardScript?: HermesCardScriptDefinition,
): string[] {
  return [...new Set([
    ...dynamicTools.map((tool) => tool.canonical_name),
    ...Object.keys(cardScript?.tool_aliases || {}),
  ])];
}

export async function prepareSavedCardRun(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  message: string;
  target: AddressableCard;
  main: AddressableCard;
  priorMessages: ConversationMessage[];
  dataAnchors: unknown[];
  images: unknown[];
  runId?: string;
  originatingRunId?: string;
  senderCardId?: string;
  onAccepted?(runId: string): void;
}): Promise<PreparedCardRun> {
  const runId = args.runId || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const toolCatalog = await readToolCatalog();
  const payload = {
    projectId: args.projectId,
    deckId: args.deckId,
    cardId: args.target.card.id,
    cardRevisionId: args.target.cardRevisionId,
    runId,
    correlationId: runId,
    acceptedAt: new Date().toISOString(),
    conversationId: args.conversationId,
    dataAnchors: args.dataAnchors,
    images: args.images,
    sharedConversation: boundedSharedContext(args.priorMessages),
    sharedConversationTargetLabel: args.target.title,
    discoveredTools: toolCatalog.tools,
    discoveredToolCatalogState: toolCatalog.state,
    unavailableToolCatalogFamilies: toolCatalog.unavailableFamilies,
    discoveredToolFailures: toolCatalog.toolFailures,
    autoModelCandidates: autoModelCandidates.filter((candidate) => candidate.eligible),
    ...(args.originatingRunId ? { originatingRunId: args.originatingRunId } : {}),
    ...(args.senderCardId ? { senderCardId: args.senderCardId } : {}),
  };
  const direct = args.target.card.id !== args.main.card.id;
  const prepared = objectRecord(await requestPythonRailsJson(
    direct ? '/domain/runs/begin' : '/domain/main/runs/begin',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(direct
        ? { ...payload, assignment: args.message }
        : { ...payload, message: args.message }),
    },
  ));
  args.onAccepted?.(runId);
  const transport = objectRecord(prepared.hermesTransport);
  const request = objectRecord(transport.request);
  if (
    String(prepared.runId || '') !== runId
    || String(prepared.cardRevisionId || '') !== args.target.cardRevisionId
    || String(transport.cardIdentity?.cardId || '') !== args.target.card.id
    || String(request.runtime?.profile || '') !== args.target.profile
    || !String(request.message || '').trim()
  ) {
    throw new Error('saved_card_preparation_identity_mismatch');
  }
  return { runId, request };
}

export async function recordSavedCardRunSubmissionStarted(args: {
  runId: string;
  binding: SessionBinding;
  submissionId: string;
}): Promise<void> {
  const started = objectRecord(await requestPythonRailsJson('/domain/runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: args.runId,
      correlationId: args.runId,
      submissionId: args.submissionId,
      hermesSessionRef: args.binding.storedSessionId,
    }),
  }));
  if (
    started.ok !== true
    || String(started.runId || '') !== args.runId
    || String(started.correlationId || '') !== args.runId
    || String(started.submissionId || '') !== args.submissionId
    || started.state !== 'running'
  ) {
    throw new SavedCardRunFailure('saved_card_run_start_not_persisted');
  }
}

export async function submitHermesTurn(args: {
  client: HermesGatewayClient;
  binding: SessionBinding;
  profile: string;
  runRequest: Record<string, unknown>;
  text: string;
  submissionId: string;
  dynamicTools: HermesDynamicToolDefinition[];
  cardScript?: HermesCardScriptDefinition;
  toolEndpoint: string;
  toolAuthorization: string;
  onEvent(event: HermesGatewayEvent): void;
  signal?: AbortSignal;
  interrupt?(): Promise<void>;
  onSubmissionIssued?(): void;
  onSubmissionStarted?(event: HermesGatewayEvent): void;
}): Promise<{ text: string; event: HermesGatewayEvent; toolCalls: number }> {
  const desiredModel = await ensureHermesTurnModel(args);
  return new Promise((resolve, reject) => {
    let settled = false;
    let interruptionStarted = false;
    let toolCalls = 0;
    let submitStatus = '';
    let ownTurnStarted = false;
    let submitRequested = false;
    let submitSettled = false;
    let pendingInterruptError: Error | null = null;
    let eventChain = Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;
    let detach: () => void = () => undefined;
    let detachState: () => void = () => undefined;
    const onAbort = () => fail(new SavedCardRunFailure('hermes_turn_cancelled'), true);
    const finish = (error?: Error, value?: { text: string; event: HermesGatewayEvent }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach();
      detachState();
      args.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve({ ...value!, toolCalls });
    };
    const beginInterrupt = (error: Error) => {
      if (settled) return;
      if (!args.interrupt) {
        finish(error);
        return;
      }
      if (interruptionStarted) return;
      interruptionStarted = true;
      void args.interrupt().then(
        () => finish(error),
        (interruptError) => finish(new SavedCardRunFailure(
          'hermes_target_interrupt_failed',
          interruptError instanceof Error ? interruptError.message : String(interruptError),
        )),
      );
    };
    const fail = (error: Error, interrupt: boolean) => {
      if (settled) return;
      if (!interrupt || !args.interrupt) {
        finish(error);
        return;
      }
      if (submitRequested && !submitSettled) {
        pendingInterruptError ||= error;
        return;
      }
      beginInterrupt(error);
    };
    const handleOwnEvent = async (event: HermesGatewayEvent) => {
      if (settled) return;
      if (event.type === 'prompt.submission.started') {
        try {
          await recordSavedCardRunSubmissionStarted({
            runId: args.submissionId,
            binding: args.binding,
            submissionId: String(event.payload?.submission_id || ''),
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          fail(new SavedCardRunFailure(
            'saved_card_run_start_persist_failed',
            `saved_card_run_start_persist_failed:${detail}`,
          ), true);
          return;
        }
        if (settled) return;
        args.onSubmissionStarted?.(event);
      }
      args.onEvent(event);
      if (event.type === 'tool.start') toolCalls += 1;
      if (event.type === 'error') {
        fail(new SavedCardRunFailure(
          'hermes_session_error',
          String(event.payload?.message || 'Hermes session error.'),
        ), false);
        return;
      }
      if (event.type !== 'message.complete') return;
      const status = String(event.payload?.status || 'complete');
      const text = String(event.payload?.text || '');
      try {
        requireCompletionModel(
          event,
          desiredModel,
          ['error', 'failed', 'interrupted'].includes(status),
          toolCalls,
        );
      } catch (error) {
        fail(error as Error, false);
        return;
      }
      if (['error', 'failed', 'interrupted'].includes(status)) {
        fail(completedTurnFailure(event, status, toolCalls), false);
        return;
      }
      finish(undefined, { text, event });
    };
    detach = args.client.onEvent((event) => {
      if (event.session_id !== args.binding.sessionId) return;
      const eventSubmissionId = String(event.payload?.submission_id || '');
      if (event.type === 'prompt.submission.started') {
        if (eventSubmissionId !== args.submissionId) return;
        ownTurnStarted = true;
      }
      if (!ownTurnStarted) return;
      if (eventSubmissionId && eventSubmissionId !== args.submissionId) return;
      eventChain = eventChain.then(() => handleOwnEvent(event)).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        fail(new SavedCardRunFailure(
          'hermes_event_handling_failed',
          `hermes_event_handling_failed:${detail}`,
        ), true);
      });
    });
    detachState = args.client.onState((state) => {
      if (state === 'closed' || state === 'error') {
        fail(new SavedCardRunFailure(`hermes_gateway_${state}`), false);
      }
    });
    timer = setTimeout(
      () => fail(new SavedCardRunFailure('hermes_turn_timeout'), true),
      30 * 60_000,
    );
    timer.unref?.();
    args.signal?.addEventListener('abort', onAbort, { once: true });
    if (args.signal?.aborted) {
      onAbort();
      return;
    }
    submitRequested = true;
    const scriptUsesTools = Object.keys(args.cardScript?.tool_aliases || {}).length > 0;
    void args.client.request<Record<string, unknown>>('prompt.submit', {
      session_id: args.binding.sessionId,
      profile: args.profile,
      text: args.text,
      queued: true,
      submission_id: args.submissionId,
      bot_mode_roster: args.binding.botModeRoster,
      expected_profile_capability_fingerprint:
        args.binding.profileCapabilityFingerprint,
      ...(args.dynamicTools.length ? {
        dynamic_tools: args.dynamicTools,
      } : {}),
      ...(args.dynamicTools.length || scriptUsesTools ? {
        tool_endpoint: args.toolEndpoint,
        tool_authorization: args.toolAuthorization,
      } : {}),
      ...(args.cardScript ? { card_script: args.cardScript } : {}),
    }).then((submitted) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      if (pendingInterruptError) {
        beginInterrupt(pendingInterruptError);
        return;
      }
      submitStatus = String(submitted.status || 'streaming');
      if (!['streaming', 'queued'].includes(submitStatus)) {
        fail(new SavedCardRunFailure(
          'hermes_submit_status_unsupported',
          submitStatus || 'missing',
        ), true);
      }
    }).catch((error) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      if (pendingInterruptError) {
        beginInterrupt(pendingInterruptError);
        return;
      }
      const failure = failureFields(error, 'hermes_submit_failed');
      beginInterrupt(new SavedCardRunFailure(failure.errorCode, failure.errorSummary));
    });
  });
}

function usageFields(event: HermesGatewayEvent): Record<string, number | string | null> {
  const usage = objectRecord(event.payload?.turn_usage);
  const number = (...values: unknown[]): number | null => {
    const value = values.find((item) => (
      typeof item === 'number' && Number.isFinite(item) && item >= 0
    ));
    return typeof value === 'number' ? value : null;
  };
  return {
    providerInputTokens: number(usage.input, usage.prompt, usage.input_tokens),
    providerOutputTokens: number(usage.output, usage.completion, usage.output_tokens),
    providerCachedTokens: number(usage.cache_read, usage.cached, usage.cached_tokens),
    providerReasoningTokens: number(usage.reasoning, usage.reasoning_tokens),
    providerTotalTokens: number(usage.total, usage.total_tokens),
    totalCostUsd: number(usage.cost_usd, usage.total_cost_usd),
    costStatus: typeof usage.cost_status === 'string' ? usage.cost_status : null,
  };
}

export async function finishSavedCardRun(args: {
  run: PreparedCardRun;
  binding: SessionBinding;
  result?: { text: string; event: HermesGatewayEvent; toolCalls: number };
  error?: unknown;
}): Promise<void> {
  const terminal = args.result || (
    args.error instanceof SavedCardRunFailure ? args.error.terminal : undefined
  );
  const usage = terminal ? usageFields(terminal.event) : {};
  const failure = args.error ? failureFields(args.error, 'hermes_inference_failed') : null;
  const requestedState = !failure
    ? 'completed'
    : isCancellationFailure(failure.errorCode) ? 'cancelled' : 'failed';
  try {
    const settled = await requestPythonRailsJson('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: args.run.runId,
        state: requestedState,
        finalResult: args.result?.text,
        errorCode: failure?.errorCode,
        errorSummary: failure?.errorSummary,
        hermesSessionRef: args.binding.storedSessionId,
        providerTurnRef: terminal ? args.run.runId : undefined,
        ...confirmedExecutionFields(args.binding, terminal?.event, Boolean(failure)),
        toolCallCount: terminal?.toolCalls,
        ...usage,
      }),
    });
    const actualState = settledRunState(settled, args.run.runId);
    if (actualState !== requestedState) {
      throw new SavedCardRunFailure(
        'saved_card_settlement_state_mismatch',
        `saved_card_settlement_state_mismatch:${requestedState}:${actualState}`,
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SavedCardRunFailure(
      'saved_card_settlement_failed',
      `saved_card_settlement_failed:${detail}`,
    );
  }
}

export async function failAcceptedSavedCardRun(
  runId: string,
  error: unknown,
  binding?: SessionBinding | null,
): Promise<void> {
  const failure = failureFields(error, 'saved_card_preparation_failed');
  const requestedState = isCancellationFailure(failure.errorCode) ? 'cancelled' : 'failed';
  try {
    const settled = await requestPythonRailsJson('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        state: requestedState,
        errorCode: failure.errorCode,
        errorSummary: failure.errorSummary,
        ...(binding?.storedSessionId ? { hermesSessionRef: binding.storedSessionId } : {}),
        ...(binding ? confirmedExecutionFields(binding) : {}),
      }),
    });
    settledRunState(settled, runId);
  } catch (settlementError) {
    const detail = settlementError instanceof Error
      ? settlementError.message
      : String(settlementError);
    throw new SavedCardRunFailure(
      'accepted_run_settlement_failed',
      `accepted_run_settlement_failed:${detail}`,
    );
  }
}

export async function interruptHermesSubmission(
  client: HermesGatewayClient,
  binding: SessionBinding,
  submissionId: string,
): Promise<void> {
  const interrupted = objectRecord(await client.request('session.interrupt', {
    session_id: binding.sessionId,
    expected_submission_id: submissionId,
  }));
  if (interrupted.status !== 'interrupted') {
    throw new Error('hermes_target_submission_not_active');
  }
}
