import type { CardRuntimeOwner } from './cardRuntime';
import { resolveSavedHermesProvider } from '../providerSelection';
import { createHash } from 'node:crypto';
import { requestPythonRailsJson } from '../../services/pythonRailsClient';
import {
  hermesExternalMcpToolName,
  type HermesCardTools,
} from '../cardToolsPlugin';
import type { CardRuntime } from './cardRuntime';
import type { HermesSessionBinding } from './hermesSession';

export type CardHermesTurnResult = {
  text: string;
  status: string;
  event: {
    type: string;
    session_id?: string;
    seq?: number;
    payload?: Record<string, unknown>;
  };
  completedTurnGeneration?: number;
  completedHermesRunId?: string | null;
};

export type CardTurnSubmitOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: CardHermesTurnResult['event']) => void;
  surface?: 'card-shared-chat';
  routing?: CardTurnRouting;
  images?: unknown[];
  prepare?: () => Promise<(() => Promise<void>) | void>;
  binding?: HermesSessionBinding;
  resolveBinding?: () => Promise<HermesSessionBinding>;
};

type StagedCardRun = {
  owner: CardRuntimeOwner;
  profile: string;
  prepared: any;
  runId: string;
  conversationId: string;
  message: string;
  images: Array<Record<string, unknown>>;
  routing: CardTurnRouting;
  started: number;
  cancelRequested?: boolean;
};

export type CardTurnCompletion = {
  hermesSessionId: string;
  providerThreadId: string | null;
  providerTurnId: string | null;
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

export type CardTurnRouting = {
  managedCanonicalTools: string[];
  allowedCanonicalTools: string[];
  authorizedCanonicalTools: string[];
  modelOnce: {
    provider: string;
    model: string;
    reasoningEffort?: string;
  } | null;
};

type HermesTurnRouting = {
  managedTools: string[];
  allowedTools: string[];
  modelOnce: CardTurnRouting['modelOnce'];
};

function hermesToolName(configuration: HermesCardTools, canonicalName: string): string | null {
  const hermesTool = configuration.hermesSuppliedTools.find(
    (tool) => tool.canonicalName === canonicalName,
  );
  if (hermesTool) {
    return hermesTool.hermesName;
  }
  const plugin = configuration.pluginTools.find((tool) => tool.canonicalName === canonicalName);
  if (plugin) return plugin.hermesName;
  const external = configuration.externalMcpTools.find(
    (tool) => tool.canonicalName === canonicalName,
  );
  return external
    ? hermesExternalMcpToolName(external.connectionId, external.canonicalName)
    : null;
}

function hermesTurnRouting(
  configuration: HermesCardTools,
  routing: CardTurnRouting,
  unavailableToolReasons: Record<string, string>,
): HermesTurnRouting {
  const mapExact = (names: string[]) => names.map((name) => {
    const hermes = hermesToolName(configuration, name);
    if (!hermes) throw new Error(`card_turn_tool_unavailable:${name}`);
    return hermes;
  });
  const available = (names: string[]) => names.filter((name) => !unavailableToolReasons[name]);
  const managedTools = mapExact(available(routing.managedCanonicalTools));
  const allowedTools = mapExact(available(routing.allowedCanonicalTools));
  if (
    new Set(managedTools).size !== managedTools.length
    || new Set(allowedTools).size !== allowedTools.length
    || !allowedTools.every((name) => managedTools.includes(name))
  ) throw new Error('card_turn_tools_invalid');
  return { managedTools, allowedTools, modelOnce: routing.modelOnce };
}

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

function resolveTurnRouting(prepared: any, input: any): CardTurnRouting {
  const autoTools = prepared?.jevAutoTools;
  const toolReceipt = autoTools && typeof autoTools === 'object' && !Array.isArray(autoTools)
    ? autoTools
    : {};
  const managedCanonicalTools = exactStringList(
    Object.prototype.hasOwnProperty.call(toolReceipt, 'normalAuthorizedTools')
      ? toolReceipt.normalAuthorizedTools
      : input?.presentedTools || [],
    'card_runtime_turn_tools_invalid',
  );
  const allowedCanonicalTools = exactStringList(
    input?.presentedTools || [],
    'card_runtime_turn_tools_invalid',
  );
  if (!allowedCanonicalTools.every((name) => managedCanonicalTools.includes(name))) {
    throw new Error('card_runtime_turn_tools_broadened');
  }
  const authorizedCanonicalTools = exactStringList(
    Array.isArray(toolReceipt.selectedTools)
      ? toolReceipt.selectedTools
      : allowedCanonicalTools,
    'card_runtime_turn_tools_invalid',
  );
  if (!authorizedCanonicalTools.every((name) => managedCanonicalTools.includes(name))) {
    throw new Error('card_runtime_turn_tools_broadened');
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
  owner: CardRuntimeOwner,
  profile: string,
  prepared: any,
): {
  runId: string;
  message: string;
  images: Array<Record<string, unknown>>;
  routing: CardTurnRouting;
} {
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
    || !['main', 'delegate'].includes(String(runtime?.mode || ''))
    || !String(runtime?.profile || '').trim()
    || !message.trim()
    || message.length > 512_000
  ) {
    throw new Error('card_runtime_staged_run_invalid');
  }
  const rawImages = Object.prototype.hasOwnProperty.call(input, 'images')
    ? input.images
    : [];
  if (
    !Array.isArray(rawImages)
    || rawImages.length > 12
    || rawImages.some((image) => !image || typeof image !== 'object' || Array.isArray(image))
  ) {
    throw new Error('card_runtime_staged_run_images_invalid');
  }
  const images = rawImages as Array<Record<string, unknown>>;
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
    throw new Error('card_runtime_staged_run_identity_mismatch');
  }
  // Validate the exact saved provider before any text reaches the Hermes session.
  resolvePreparedHermesProvider(input);
  return { runId, message, images, routing: resolveTurnRouting(prepared, input) };
}

/**
 * Binds one already-materialized Card Run to one Hermes Gateway turn.
 * Gateway owns the Hermes session and transport; this class only preserves the
 * canonical Run receipt around that submitted turn.
 */
export class CardTurnBridge {
  private readonly staged = new Map<string, StagedCardRun>();

  constructor(private readonly request = requestPythonRailsJson) {}

  stage(
    owner: CardRuntimeOwner,
    runtimeSessionId: string,
    profile: string,
    prepared: any,
    conversationId = '',
  ): {
    runId: string;
    message: string;
    images: Array<Record<string, unknown>>;
    routing: CardTurnRouting;
  } {
    if (this.staged.has(runtimeSessionId)) {
      throw new Error('card_runtime_turn_already_running');
    }
    const { runId, message, images, routing } = resolveStagedRun(owner, profile, prepared);
    this.staged.set(runtimeSessionId, {
      owner: { ...owner },
      profile,
      prepared,
      runId,
      conversationId,
      message,
      images,
      routing,
      started: Date.now(),
    });
    return { runId, message, images, routing };
  }

  /** Persist the exact Hermes Gateway completion for an application-submitted turn. */
  async completeStaged(
    runtimeSessionId: string,
    hermesSessionId: string,
    result: CardHermesTurnResult,
  ): Promise<CardTurnCompletion> {
    const staged = this.staged.get(runtimeSessionId);
    if (!staged) throw new Error('card_runtime_staged_run_missing');
    if (staged.cancelRequested) {
      await this.cancelStaged(runtimeSessionId, 'hermes_turn_cancelled', 'cancelled');
      throw new Error('hermes_turn_cancelled');
    }
    const payload = result.event.payload || {};
    const providerUsage = payload.usage && typeof payload.usage === 'object'
      ? payload.usage as Record<string, unknown>
      : {};
    const selectedProvider = resolvePreparedHermesProvider(
      staged.prepared.hermesTransport.request,
    );
    const actualProvider = optionalText(payload.actualProvider ?? payload.actual_provider);
    const actualModel = optionalText(payload.actualModel ?? payload.actual_model);
    if (!actualProvider || !actualModel) {
      throw new Error('card_runtime_actual_model_missing');
    }
    const exposedTools = exactStringList(
      payload.exposedTools ?? payload.exposed_tools ?? [],
      'card_runtime_completion_tools_invalid',
    );
    const executionEvidence = Array.isArray(payload.executionEvidence)
      ? payload.executionEvidence
      : [];
    const executionEvidenceComplete = payload.executionEvidenceComplete === true;
    const executionEvidenceError = optionalText(payload.executionEvidenceError);
    if (actualProvider !== selectedProvider.provider || actualModel !== selectedProvider.model) {
      throw new Error('card_runtime_actual_model_mismatch');
    }
    const completion: CardTurnCompletion = {
      hermesSessionId,
      // Hermes owns these two wire fields. The application maps them once into
      // the provider-thread/provider-turn Run receipt vocabulary.
      providerThreadId: optionalText(payload.nativeRootId ?? payload.native_root_id),
      providerTurnId: optionalText(payload.nativeRunId ?? payload.native_run_id),
      effectiveProvider: actualProvider,
      actualModel,
      exposedTools,
      executionEvidence,
      executionEvidenceComplete,
      executionEvidenceError,
      providerApiMode: optionalText(payload.providerApiMode ?? payload.provider_api_mode)
        ?? selectedProvider.apiMode,
      inputTokens: optionalNonNegativeInteger(
        providerUsage.providerInputTokens,
        providerUsage.inputTokens,
        providerUsage.input_tokens,
        providerUsage.prompt_tokens,
        providerUsage.input,
        providerUsage.prompt,
      ),
      outputTokens: optionalNonNegativeInteger(
        providerUsage.providerOutputTokens,
        providerUsage.outputTokens,
        providerUsage.output_tokens,
        providerUsage.completion_tokens,
        providerUsage.output,
        providerUsage.completion,
      ),
      cachedTokens: optionalNonNegativeInteger(
        providerUsage.providerCachedTokens,
        providerUsage.cachedTokens,
        providerUsage.cached_tokens,
      ),
      reasoningTokens: optionalNonNegativeInteger(
        providerUsage.providerReasoningTokens,
        providerUsage.reasoningTokens,
        providerUsage.reasoning_tokens,
        providerUsage.reasoning,
      ),
      costUsd: optionalNonNegativeNumber(
        providerUsage.totalCostUsd,
        providerUsage.total_cost_usd,
        providerUsage.costUsd,
        providerUsage.cost_usd,
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
        providerThreadRef: completion.providerThreadId,
        providerTurnRef: completion.providerTurnId,
        effectiveProvider: completion.effectiveProvider,
        providerApiMode: completion.providerApiMode,
        providerInputTokens: completion.inputTokens,
        providerOutputTokens: completion.outputTokens,
        providerCachedTokens: completion.cachedTokens,
        providerReasoningTokens: completion.reasoningTokens,
        toolCallCount: completion.executionEvidence.filter((entry) => (
          entry && typeof entry === 'object'
          && !Array.isArray(entry)
          && (entry as Record<string, unknown>).kind === 'tool_call'
        )).length,
        totalCostUsd: completion.costUsd,
        durationMs: Date.now() - staged.started,
      }),
    });
    this.staged.delete(runtimeSessionId);
    return completion;
  }

  async cancelStaged(
    runtimeSessionId: string,
    errorSummary: string,
    state: 'failed' | 'cancelled' = 'failed',
  ): Promise<boolean> {
    const staged = this.staged.get(runtimeSessionId);
    if (!staged) return false;
    await this.request('/domain/runs/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: staged.runId,
        state,
        errorSummary: String(errorSummary || 'card_runtime_staged_turn_cancelled'),
      }),
    });
    this.staged.delete(runtimeSessionId);
    return true;
  }

  ownsRun(runtimeSessionId: string, runId: string): boolean {
    return this.staged.get(runtimeSessionId)?.runId === runId;
  }

  activeRunId(runtimeSessionId: string): string | null {
    return this.staged.get(runtimeSessionId)?.runId || null;
  }

  activeContext(runtimeSessionId: string): {
    runId: string;
    conversationId: string;
    authorizedCanonicalTools: string[];
  } | null {
    const staged = this.staged.get(runtimeSessionId);
    return staged ? {
      runId: staged.runId,
      conversationId: staged.conversationId,
      authorizedCanonicalTools: [...staged.routing.authorizedCanonicalTools],
    } : null;
  }

  requestCancellation(runtimeSessionId: string, runId: string): void {
    const staged = this.staged.get(runtimeSessionId);
    if (staged?.runId !== runId) throw new Error('card_runtime_run_not_active');
    staged.cancelRequested = true;
  }

  async abort(runtimeSessionId: string, reason = 'hermes_process_exited'): Promise<void> {
    await this.cancelStaged(runtimeSessionId, reason);
  }
}

export class CardTurn {
  constructor(private readonly runtime: CardRuntime) {}

  submit(
    text: string,
    options: CardTurnSubmitOptions = {},
  ): Promise<CardHermesTurnResult> {
    if (!text.trim()) throw new Error('card_turn_input_required');
    this.runtime.requireRunning();
    const execute = async () => {
      const cleanup = await options.prepare?.();
      try {
        const binding = options.binding
          || await options.resolveBinding?.()
          || {
            sessionId: this.runtime.state.hermesSessionId,
            storedSessionId: this.runtime.state.storedSessionId,
          };
        await this.attachImages(binding, options.images || [], options.onEvent);
        const routing = options.routing
          ? hermesTurnRouting(
            this.runtime.cardTools,
            options.routing,
            this.runtime.state.unavailableToolReasons,
          )
          : null;
        return await this.submitNow(binding, text, {
          ...options,
          ...(routing || {}),
        });
      } finally {
        await cleanup?.();
      }
    };
    const result = this.runtime.turnTail.then(execute, execute);
    this.runtime.turnTail = result.then(() => undefined, () => undefined);
    return result;
  }

  subscribe(listener: (event: CardHermesTurnResult['event']) => void): () => void {
    this.runtime.requireRunning();
    this.runtime.gatewayEventListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.runtime.gatewayEventListeners.delete(listener);
    };
  }

  private async attachImages(
    binding: HermesSessionBinding,
    images: unknown[],
    onEvent?: (event: CardHermesTurnResult['event']) => void,
  ): Promise<void> {
    if (!Array.isArray(images) || images.length > 12) throw new Error('card_turn_images_invalid');
    for (const [index, raw] of images.entries()) {
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('attachment_record_invalid');
        }
        const image = raw as Record<string, unknown>;
        const name = String(image.name || `attachment-${index + 1}.png`).trim();
        const dataUrl = String(image.dataUrl || '').trim();
        if (image.schemaVersion === 'worldview.turn-context.v1' && !dataUrl) {
          onEvent?.({
            type: 'attachment.context_only',
            session_id: binding.sessionId,
            payload: {
              index,
              source: String(image.kind || 'worldview-context'),
              captureError: String(image.captureError || ''),
            },
          });
          continue;
        }
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
        if (!match || !name || name.length > 200 || /[\\/]/.test(name)) {
          throw new Error('attachment_image_invalid');
        }
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
          throw new Error('attachment_image_size_invalid');
        }
        const expectedMediaType = String(image.mediaType || match[1]).trim().toLowerCase();
        if (expectedMediaType !== match[1]) throw new Error('attachment_image_media_type_mismatch');
        const expectedSha256 = String(image.sha256 || '').trim().toLowerCase();
        const actualSha256 = createHash('sha256').update(bytes).digest('hex');
        if (expectedSha256 && expectedSha256 !== actualSha256) {
          throw new Error('attachment_image_hash_mismatch');
        }
        const result = await this.runtime.client.request<Record<string, unknown>>(
          'image.attach_bytes',
          {
            session_id: binding.sessionId,
            profile: this.runtime.state.profile,
            content_base64: match[2],
            filename: name,
          },
        );
        if (result.attached !== true) throw new Error('attachment_image_not_accepted');
        onEvent?.({
          type: 'attachment.accepted',
          session_id: binding.sessionId,
          payload: {
            index,
            name,
            mediaType: match[1],
            sha256: actualSha256,
            source: String(image.kind || 'user-upload'),
          },
        });
      } catch (error) {
        onEvent?.({
          type: 'attachment.error',
          session_id: binding.sessionId,
          payload: {
            index,
            error: error instanceof Error ? error.message : 'attachment_image_failed',
          },
        });
      }
    }
  }

  private submitNow(
    binding: HermesSessionBinding,
    text: string,
    options: Omit<CardTurnSubmitOptions, 'prepare' | 'resolveBinding'> & Partial<HermesTurnRouting>,
  ): Promise<CardHermesTurnResult> {
    if (options.signal?.aborted) return Promise.reject(new Error('card_turn_cancelled'));
    const timeoutMs = options.timeoutMs ?? 30 * 60_000;
    return new Promise<CardHermesTurnResult>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      const detach = this.runtime.client.onEvent((event) => {
        if (event.session_id !== binding.sessionId) return;
        options.onEvent?.(event);
        if (event.type === 'message.complete') {
          const status = String(event.payload?.status || 'completed');
          const resultText = String(event.payload?.text || '');
          if (status === 'error' || status === 'failed') {
            finish(new Error(String(event.payload?.error || resultText || 'card_turn_failed')));
            return;
          }
          if (options.managedTools && options.allowedTools) {
            const exposed = event.payload?.exposedTools;
            if (!Array.isArray(exposed)
              || exposed.some((name) => typeof name !== 'string')
              || !options.allowedTools.every((name) => exposed.includes(name))
              || options.managedTools.some((name) => (
                !options.allowedTools!.includes(name) && exposed.includes(name)
              ))) {
              finish(new Error('card_turn_tool_exposure_mismatch'));
              return;
            }
          }
          const completedHermesRunId = String(
            event.payload?.nativeRunId ?? event.payload?.native_run_id ?? '',
          ).trim() || null;
          this.runtime.state.completedTurnGeneration += 1;
          this.runtime.state.completedHermesRunId = completedHermesRunId;
          finish(undefined, {
            text: resultText,
            status,
            event,
            completedTurnGeneration: this.runtime.state.completedTurnGeneration,
            completedHermesRunId,
          });
        } else if (event.type === 'error') {
          finish(new Error(String(event.payload?.message || 'card_turn_failed')));
        }
      });
      const finish = (error?: Error, result?: CardHermesTurnResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        detach();
        if (abortListener && options.signal) {
          options.signal.removeEventListener('abort', abortListener);
        }
        if (error) reject(error);
        else resolve(result!);
      };
      const interrupt = (reason: string) => {
        void this.runtime.client.request('session.interrupt', {
          session_id: binding.sessionId,
          profile: this.runtime.state.profile,
        }).catch(() => undefined);
        finish(new Error(reason));
      };
      if (options.signal) {
        abortListener = () => interrupt('card_turn_cancelled');
        options.signal.addEventListener('abort', abortListener, { once: true });
      }
      if (!settled) {
        timer = setTimeout(() => interrupt('card_turn_timeout'), timeoutMs);
        timer.unref?.();
      }
      void this.runtime.client.request('prompt.submit', {
        session_id: binding.sessionId,
        text,
        profile: this.runtime.state.profile,
        ...(options.surface ? { surface: options.surface } : {}),
        ...(options.managedTools ? { managed_tools: options.managedTools } : {}),
        ...(options.allowedTools ? { allowed_tools: options.allowedTools } : {}),
        ...(options.modelOnce ? { model_once: {
          provider: options.modelOnce.provider,
          model: options.modelOnce.model,
          ...(options.modelOnce.reasoningEffort
            ? { reasoning_effort: options.modelOnce.reasoningEffort }
            : {}),
        } } : {}),
      }, timeoutMs, options.signal).catch((error) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

export const cardTurnBridge = new CardTurnBridge();
