import { randomUUID } from 'node:crypto';

import type { ConversationMessage } from '../conversations/store';
import { autoModelCandidates } from '../llm/models.config';
import type { HermesGatewayEvent } from './hermesGateway';
import type { SessionBinding } from './hermesCardSession';
import { readToolCatalog } from './mcp/toolCatalogMcpClient';
import { requestPythonRailsJson } from './pythonRailsClient';
import {
  boundedSharedContext,
  objectRecord,
  type AddressableCard,
} from './savedCardAuthority';

export type PreparedCardRun = {
  runId: string;
  request: Record<string, unknown>;
};
export class SavedCardRunFailure extends Error {
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

export function boundedSavedCardRunFailureCode(value: unknown): string | null {
  const code = String(value || '').trim();
  return /^[a-z][a-z0-9_]{2,120}$/.test(code) ? code : null;
}

export function savedCardRunFailureFields(
  error: unknown,
  fallbackCode: string,
): { errorCode: string; errorSummary: string } {
  if (error instanceof SavedCardRunFailure) {
    return { errorCode: error.failureCode, errorSummary: error.message };
  }
  const errorSummary = error instanceof Error ? error.message : String(error || fallbackCode);
  const explicitCode = boundedSavedCardRunFailureCode(errorSummary.split(':', 1)[0]);
  return { errorCode: explicitCode || fallbackCode, errorSummary };
}

function isCancellationFailure(code: string): boolean {
  return code === 'hermes_turn_cancelled'
    || code === 'hermes_turn_interrupted'
    || code === 'saved_specialist_cancelled';
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
  const failure = args.error ? savedCardRunFailureFields(args.error, 'hermes_inference_failed') : null;
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
  const failure = savedCardRunFailureFields(error, 'saved_card_preparation_failed');
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
