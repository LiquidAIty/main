// Entity: Card Invocation
// Relationship: This file submits one exact saved Card assignment for preparation and rejects any returned Card, revision, profile, conversation, or transport identity mismatch.
// Entity: Run Ledger
// Relationship: This file starts, reads, and finishes durable Runs while validating transition readback and normalizing bounded Hermes token and cost usage.

import { randomUUID } from 'node:crypto';

import { autoModelCandidates } from '../llm/models.config';
import { readToolCatalog } from './mcp/toolCatalogMcpClient';
import { requestPythonRailsJson } from './pythonRailsClient';
import type { ProjectCardBinding } from './projectCardAuthority';

export type PreparedCardRun = { runId: string; request: Record<string, any> };

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export async function prepareCardRun(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  message: string;
  target: ProjectCardBinding;
  dataAnchors: unknown[];
  images: unknown[];
  runId?: string;
  senderCardId?: string;
  originatingRunId?: string;
}): Promise<PreparedCardRun> {
  const runId = String(args.runId || '').trim()
    || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(runId)) throw new Error('card_run_identity_invalid');
  const catalog = await readToolCatalog();
  const prepared = record(await requestPythonRailsJson('/domain/runs/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      cardId: args.target.card.id,
      runId,
      correlationId: runId,
      conversationId: args.conversationId,
      assignment: args.message,
      senderCardId: String(args.senderCardId || '').trim(),
      originatingRunId: String(args.originatingRunId || '').trim(),
      dataAnchors: args.dataAnchors,
      images: args.images,
      discoveredTools: catalog.tools,
      discoveredToolCatalogState: catalog.state,
      unavailableToolCatalogFamilies: catalog.unavailableFamilies,
      discoveredToolFailures: catalog.toolFailures,
      autoModelCandidates,
    }),
  }));
  const transport = record(prepared.hermesTransport);
  const request = record(transport.request);
  const identityMismatch = (
    String(prepared.runId || '') !== runId
    || String(prepared.correlationId || '') !== runId
    || String(prepared.projectId || '') !== args.projectId
    || String(prepared.deckId || '') !== args.deckId
    || String(prepared.conversationId || '') !== args.conversationId
    || String(prepared.cardId || '') !== args.target.card.id
    || String(prepared.cardRevisionId || '') !== args.target.cardRevisionId
    || String(transport.cardIdentity?.cardId || '') !== args.target.card.id
    || String(request.runtime?.profile || '') !== args.target.profile
    || !String(request.message || '').trim()
  );
  if (identityMismatch) {
    await finishCardRun({
      runId,
      state: 'failed',
      errorCode: 'saved_card_preparation_identity_mismatch',
      errorSummary: 'saved_card_preparation_identity_mismatch',
    }).catch(() => undefined);
    throw new Error('saved_card_preparation_identity_mismatch');
  }
  return { runId, request };
}

export async function startCardRun(args: {
  runId: string;
  submissionId: string;
  hermesSessionRef: string;
}): Promise<void> {
  const started = record(await requestPythonRailsJson('/domain/runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: args.runId,
      correlationId: args.runId,
      submissionId: args.submissionId,
      hermesSessionRef: args.hermesSessionRef,
    }),
  }));
  if (
    started.ok !== true
    || String(started.runId || '') !== args.runId
    || String(started.correlationId || '') !== args.runId
    || String(started.submissionId || '') !== args.submissionId
    || String(started.state || '') !== 'running'
  ) throw new Error('run_submission_start_readback_mismatch');
}

export async function readCardRun(args: {
  projectId: string;
  deckId: string;
  runId: string;
  cardId: string;
  profile: string;
  conversationId?: string;
}): Promise<Record<string, any>> {
  const response = record(await requestPythonRailsJson('/domain/runs/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      runId: args.runId,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    }),
  }));
  const run = record(response.run);
  if (
    response.ok !== true
    || String(run.runId || '') !== args.runId
    || String(run.projectId || '') !== args.projectId
    || String(run.deckId || '') !== args.deckId
    || String(run.cardId || '') !== args.cardId
    || String(run.runtimeProfile || '').toLowerCase() !== args.profile.toLowerCase()
    || (
      Boolean(args.conversationId)
      && String(run.conversationId || '') !== args.conversationId
    )
  ) throw new Error('card_turn_run_identity_mismatch');
  return run;
}

export function hermesUsageFields(value: unknown): Record<string, number | null> {
  const usage = record(value);
  const count = (...values: unknown[]): number | null => {
    const supplied = values.filter((item): item is number => typeof item === 'number');
    if (supplied.some((item) => (
      !Number.isSafeInteger(item) || Number(item) < 0
    ))) throw new Error('hermes_usage_invalid');
    return supplied.length > 0 ? Number(supplied[0]) : null;
  };
  const amount = (...values: unknown[]): number | null => {
    const supplied = values.filter((item): item is number => typeof item === 'number');
    if (supplied.some((item) => (
      !Number.isFinite(item) || Number(item) < 0
    ))) throw new Error('hermes_usage_invalid');
    return supplied.length > 0 ? Number(supplied[0]) : null;
  };
  // Hermes exposes both canonical uncached buckets (`input`/`output`) and the
  // provider-facing totals (`prompt`/`completion`). Run accounting records the
  // provider totals, with cache reads and reasoning retained as their subsets.
  const providerInputTokens = count(usage.prompt, usage.input, usage.prompt_tokens, usage.input_tokens);
  const providerOutputTokens = count(usage.completion, usage.output, usage.completion_tokens, usage.output_tokens);
  const providerCachedTokens = count(usage.cache_read, usage.cached, usage.cached_tokens);
  const providerReasoningTokens = count(usage.reasoning, usage.reasoning_tokens);
  const reportedTotal = count(usage.total, usage.total_tokens);
  const computedTotal = providerInputTokens !== null && providerOutputTokens !== null
    ? providerInputTokens + providerOutputTokens
    : null;
  if (
    reportedTotal !== null && computedTotal !== null && reportedTotal !== computedTotal
    || providerCachedTokens !== null && providerInputTokens !== null
      && providerCachedTokens > providerInputTokens
    || providerReasoningTokens !== null && providerOutputTokens !== null
      && providerReasoningTokens > providerOutputTokens
  ) throw new Error('hermes_usage_invalid');
  return {
    providerInputTokens,
    providerOutputTokens,
    providerCachedTokens,
    providerReasoningTokens,
    providerTotalTokens: reportedTotal ?? computedTotal,
    totalCostUsd: amount(usage.cost_usd, usage.total_cost_usd),
  };
}

export async function finishCardRun(payload: Record<string, unknown>): Promise<void> {
  const runId = String(payload.runId || '').trim();
  if (!runId) throw new Error('run_id_required');
  const finished = record(await requestPythonRailsJson('/domain/runs/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  if (
    finished.ok !== true
    || String(finished.runId || '') !== runId
    || String(finished.state || '') !== String(payload.state || '')
  ) throw new Error('run_finish_readback_mismatch');
}
