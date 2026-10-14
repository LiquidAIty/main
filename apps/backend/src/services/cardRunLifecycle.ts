import { randomUUID } from 'node:crypto';

import { autoModelCandidates } from '../llm/models.config';
import { readToolCatalog } from './mcp/toolCatalogMcpClient';
import { requestPythonRailsJson } from './pythonRailsClient';
import type { ProjectCardBinding } from './projectCardAuthority';

export type PreparedCardRun = { runId: string; request: Record<string, any> };

export function internalCardTurnEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const origin = String(env.LIQUIDAITY_INTERNAL_BACKEND_URL || 'http://127.0.0.1:4000').trim();
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('internal_card_turn_origin_invalid');
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname.toLowerCase());
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) || parsed.username || parsed.password) {
    throw new Error('internal_card_turn_origin_invalid');
  }
  parsed.pathname = '/api/card-turn';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

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
  if (
    String(prepared.runId || '') !== runId
    || String(transport.cardIdentity?.cardId || '') !== args.target.card.id
    || String(request.runtime?.profile || '') !== args.target.profile
    || !String(request.message || '').trim()
  ) throw new Error('saved_card_preparation_identity_mismatch');
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
}): Promise<Record<string, any>> {
  const response = record(await requestPythonRailsJson('/domain/runs/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      runId: args.runId,
    }),
  }));
  const run = record(response.run);
  if (
    response.ok !== true
    || String(run.runId || '') !== args.runId
    || !String(run.projectId || '')
    || String(run.deckId || '') !== args.deckId
    || String(run.cardId || '') !== args.cardId
    || String(run.runtimeProfile || '').toLowerCase() !== args.profile.toLowerCase()
  ) throw new Error('card_turn_run_identity_mismatch');
  return run;
}

export function hermesUsageFields(value: unknown): Record<string, number | null> {
  const usage = record(value);
  const number = (...values: unknown[]): number | null => {
    const selected = values.find((item) => typeof item === 'number' && Number.isFinite(item));
    return typeof selected === 'number' ? selected : null;
  };
  const providerInputTokens = number(usage.input, usage.prompt, usage.input_tokens);
  const providerOutputTokens = number(usage.output, usage.completion, usage.output_tokens);
  const reportedTotal = number(usage.total, usage.total_tokens);
  return {
    providerInputTokens,
    providerOutputTokens,
    providerCachedTokens: number(usage.cached, usage.cached_tokens),
    providerReasoningTokens: number(usage.reasoning, usage.reasoning_tokens),
    providerTotalTokens: reportedTotal ?? (
      providerInputTokens !== null && providerOutputTokens !== null
        ? providerInputTokens + providerOutputTokens
        : null
    ),
    totalCostUsd: number(usage.cost_usd, usage.total_cost_usd),
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
