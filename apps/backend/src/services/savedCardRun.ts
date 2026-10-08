import { createHash, randomUUID } from 'node:crypto';

import type { ConversationMessage } from '../conversations/store';
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
    const stem = canonicalName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 72)
      || `tool_${index + 1}`;
    const suffix = createHash('sha256').update(canonicalName).digest('hex').slice(0, 10);
    const name = `card__${stem}__${suffix}`;
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
    || String(transport.cardIdentity?.cardId || '') !== args.target.card.id
    || String(request.runtime?.profile || '') !== args.target.profile
    || !String(request.message || '').trim()
  ) {
    throw new Error('saved_card_preparation_identity_mismatch');
  }
  return { runId, request };
}

export async function submitHermesTurn(args: {
  client: HermesGatewayClient;
  binding: SessionBinding;
  profile: string;
  text: string;
  submissionId: string;
  dynamicTools: HermesDynamicToolDefinition[];
  toolEndpoint: string;
  toolAuthorization: string;
  onEvent(event: HermesGatewayEvent): void;
  signal?: AbortSignal;
  interrupt?(): Promise<void>;
  onSubmissionIssued?(): void;
}): Promise<{ text: string; event: HermesGatewayEvent; toolCalls: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let interruptionStarted = false;
    let toolCalls = 0;
    let submitStatus = '';
    let ownTurnStarted = false;
    let submitRequested = false;
    let submitSettled = false;
    let pendingInterruptError: Error | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let detach: () => void = () => undefined;
    let detachState: () => void = () => undefined;
    const onAbort = () => fail(new Error('hermes_turn_cancelled'), true);
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
        (interruptError) => finish(new Error(
          `hermes_target_interrupt_failed:${interruptError instanceof Error
            ? interruptError.message
          : String(interruptError)}`,
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
    detach = args.client.onEvent((event) => {
      if (event.session_id !== args.binding.sessionId) return;
      const eventSubmissionId = String(event.payload?.submission_id || '');
      if (event.type === 'prompt.submission.started') {
        if (eventSubmissionId !== args.submissionId) return;
        ownTurnStarted = true;
      }
      if (!ownTurnStarted) return;
      if (eventSubmissionId && eventSubmissionId !== args.submissionId) return;
      args.onEvent(event);
      if (event.type === 'tool.start') toolCalls += 1;
      if (event.type === 'error') {
        fail(new Error(String(event.payload?.message || 'hermes_turn_failed')), false);
        return;
      }
      if (event.type !== 'message.complete') return;
      const status = String(event.payload?.status || 'complete');
      const text = String(event.payload?.text || '');
      if (['error', 'failed'].includes(status)) {
        fail(new Error(String(event.payload?.error || text || 'hermes_turn_failed')), false);
        return;
      }
      finish(undefined, { text, event });
    });
    detachState = args.client.onState((state) => {
      if (state === 'closed' || state === 'error') {
        fail(new Error(`hermes_gateway_${state}`), false);
      }
    });
    timer = setTimeout(() => fail(new Error('hermes_turn_timeout'), true), 30 * 60_000);
    timer.unref?.();
    args.signal?.addEventListener('abort', onAbort, { once: true });
    if (args.signal?.aborted) {
      onAbort();
      return;
    }
    submitRequested = true;
    void args.client.request<Record<string, unknown>>('prompt.submit', {
      session_id: args.binding.sessionId,
      profile: args.profile,
      text: args.text,
      queued: true,
      submission_id: args.submissionId,
      ...(args.dynamicTools.length ? {
        dynamic_tools: args.dynamicTools,
        tool_endpoint: args.toolEndpoint,
        tool_authorization: args.toolAuthorization,
      } : {}),
    }).then((submitted) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      if (pendingInterruptError) {
        beginInterrupt(pendingInterruptError);
        return;
      }
      submitStatus = String(submitted.status || 'streaming');
      if (!['streaming', 'queued'].includes(submitStatus)) {
        fail(new Error(`hermes_submit_status_unsupported:${submitStatus || 'missing'}`), true);
      }
    }).catch((error) => {
      submitSettled = true;
      args.onSubmissionIssued?.();
      beginInterrupt(
        pendingInterruptError
        || (error instanceof Error ? error : new Error(String(error))),
      );
    });
  });
}

function usageFields(event: HermesGatewayEvent): Record<string, number | null> {
  const usage = objectRecord(event.payload?.usage);
  const number = (...values: unknown[]): number | null => {
    const value = values.find((item) => typeof item === 'number' && Number.isFinite(item));
    return typeof value === 'number' ? value : null;
  };
  return {
    providerInputTokens: number(usage.input, usage.prompt, usage.input_tokens),
    providerOutputTokens: number(usage.output, usage.completion, usage.output_tokens),
    providerCachedTokens: number(usage.cached, usage.cached_tokens),
    providerReasoningTokens: number(usage.reasoning, usage.reasoning_tokens),
    totalCostUsd: number(usage.cost_usd, usage.total_cost_usd),
  };
}

export async function finishSavedCardRun(args: {
  run: PreparedCardRun;
  binding: SessionBinding;
  result?: { text: string; event: HermesGatewayEvent; toolCalls: number };
  error?: unknown;
}): Promise<void> {
  const provider = objectRecord(args.binding.info);
  const runtimeOptions = objectRecord(args.run.request.runtimeOptions);
  const requestedProvider = objectRecord(args.run.request.provider);
  const usage = args.result ? usageFields(args.result.event) : {};
  await requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: args.run.runId,
      state: args.error ? 'failed' : 'completed',
      finalResult: args.result?.text,
      errorCode: args.error ? 'hermes_turn_failed' : undefined,
      errorSummary: args.error instanceof Error ? args.error.message : args.error ? String(args.error) : undefined,
      hermesSessionRef: args.binding.storedSessionId,
      effectiveProvider: String(provider.provider || requestedProvider.provider || ''),
      providerApiMode: String(runtimeOptions.openaiRuntime || ''),
      model: String(provider.model || requestedProvider.providerModelId || ''),
      provider: String(provider.provider || requestedProvider.provider || ''),
      toolCallCount: args.result?.toolCalls ?? 0,
      ...usage,
    }),
  });
}

export async function failAcceptedSavedCardRun(
  runId: string,
  error: unknown,
  binding?: SessionBinding | null,
): Promise<void> {
  await requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      state: 'failed',
      errorCode: 'hermes_turn_failed',
      errorSummary: error instanceof Error ? error.message : String(error),
      ...(binding?.storedSessionId ? { hermesSessionRef: binding.storedSessionId } : {}),
    }),
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

