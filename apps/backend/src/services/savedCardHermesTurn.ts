import type { HermesGatewayClient, HermesGatewayEvent } from './hermesGateway';
import type { SessionBinding } from './hermesCardSession';
import { objectRecord } from './savedCardAuthority';
import {
  boundedSavedCardRunFailureCode,
  recordSavedCardRunSubmissionStarted,
  SavedCardRunFailure,
  savedCardRunFailureFields,
} from './savedCardRunLedger';
import type {
  HermesCardScriptDefinition,
  HermesDynamicToolDefinition,
} from './savedCardHermesToolProjection';

function completedTurnFailure(
  event: HermesGatewayEvent,
  status: string,
  toolCalls: number,
): SavedCardRunFailure {
  const payload = objectRecord(event.payload);
  const surface = objectRecord(payload.error_surface);
  const surfaceCode = boundedSavedCardRunFailureCode(surface.code);
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
      const failure = savedCardRunFailureFields(error, 'hermes_submit_failed');
      beginInterrupt(new SavedCardRunFailure(failure.errorCode, failure.errorSummary));
    });
  });
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
