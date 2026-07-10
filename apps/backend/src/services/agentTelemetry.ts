/**
 * Dev-only agent-call telemetry — a bounded ring of what every agent/card
 * call boundary actually did (frontdoor → Hermes preflight → Mag One →
 * card calls → graph reads/writes → Hermes postflight), plus a bounded
 * dev-only JSONL mirror so evidence survives backend watch reloads.
 *
 * Rules (SPEC: dev agent harness / Hermes dev observatory):
 *  - dev-only: recording is a no-op when dev test mode is off (production);
 *  - non-blocking: recordAgentEvent NEVER throws and the JSONL append is
 *    fire-and-forget — a telemetry failure must never break the app path;
 *  - bounded: fixed-size ring + size-capped JSONL under the gitignored
 *    coder-workspace/dev-telemetry/ (rotated by rewriting from the ring);
 *  - honest: events are recorded where the real call happens; events restored
 *    from disk after a restart are marked source='durable', never re-dated;
 *  - safe: input/output are redacted bounded summaries (never raw prompts,
 *    never secrets, never provider stack traces); dev evidence only — this is
 *    NOT product analytics and must not become user surveillance.
 */

import { randomUUID } from 'crypto';
import { appendFile, stat, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDevTestModeEnabled } from './devTest';
import { redactTrace } from './harnessTrace';
import { resolveCoderWorkspaceRoot } from '../coder/workspaceRoot';

export type AgentTelemetryStage =
  | 'frontdoor'
  | 'hermes_preflight'
  | 'mag_one_dispatch'
  | 'card_call'
  | 'participant_turn'
  | 'graph_read'
  | 'graph_write'
  | 'hermes_postflight'
  | 'dev_probe';

/**
 * Call reality, not model usage: real_model_call marks a REAL runtime
 * operation on the live path (a graph read on the live path is 'real' even
 * though no model ran); dry_run resolved config without executing; blocked
 * means gating refused the call.
 */
export type AgentTelemetryMode = 'real_model_call' | 'dry_run' | 'simulated_probe' | 'blocked';

export type AgentTelemetryStatus = 'started' | 'completed' | 'failed' | 'blocked';

export type AgentTelemetryEvent = {
  id: string;
  timestamp: string;
  projectId: string | null;
  deckId: string | null;
  conversationId: string | null;
  /** runId / correlationId — one identity across a run's events. */
  correlationId: string | null;
  stage: AgentTelemetryStage;
  /** Who invoked this boundary: 'user' | 'harness' | 'mag_one' | 'dev_probe' | route name. */
  caller: string;
  cardId: string | null;
  provider: string | null;
  model: string | null;
  inputSummary: string;
  outputSummary: string;
  status: AgentTelemetryStatus;
  errorSummary: string | null;
  durationMs: number | null;
  tools: string[];
  graphReads: string[];
  graphWrites: string[];
  mode: AgentTelemetryMode;
  metadata: Record<string, unknown>;
  /** 'ram' = recorded by this backend process; 'durable' = restored from the
   * JSONL mirror after a restart (original timestamp preserved). */
  source: 'ram' | 'durable';
};

export type AgentTelemetryInput = Partial<Omit<AgentTelemetryEvent, 'id' | 'timestamp' | 'source'>> &
  Pick<AgentTelemetryEvent, 'stage' | 'status' | 'mode'>;

const MAX_EVENTS = 500;
const SUMMARY_MAX = 300;
const MAX_FILE_BYTES = 2_000_000;
const SIZE_CHECK_EVERY = 25;

const events: AgentTelemetryEvent[] = [];
let telemetryDirOverride: string | null = null;
let seeded = false;
let appendsSinceSizeCheck = 0;

function telemetryFilePath(): string {
  const dir = telemetryDirOverride ?? path.join(resolveCoderWorkspaceRoot(), 'dev-telemetry');
  return path.join(dir, 'agent-events.jsonl');
}

const VALID_STATUSES = new Set(['started', 'completed', 'failed', 'blocked']);

/** Restore the ring from the JSONL mirror once per process (dev only). Rows
 * that do not parse as events are dropped, never repaired into fake history. */
function ensureSeeded(): void {
  if (seeded) return;
  seeded = true;
  try {
    if (!isDevTestModeEnabled()) return;
    const raw = readFileSync(telemetryFilePath(), 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-MAX_EVENTS);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AgentTelemetryEvent;
        if (parsed && typeof parsed.id === 'string' && typeof parsed.stage === 'string' && VALID_STATUSES.has(parsed.status)) {
          events.push({ ...parsed, source: 'durable' });
        }
      } catch {
        // skip corrupt line
      }
    }
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  } catch {
    // no mirror yet (or unreadable) — an empty ring is the honest state
  }
}

// Appends are chained on one promise so mirror lines keep event order; the
// chain is fire-and-forget for callers (recordAgentEvent never awaits it).
let pendingWrites: Promise<void> = Promise.resolve();

/** Fire-and-forget JSONL append with size-capped rotation. Never throws. */
function persistEvent(event: AgentTelemetryEvent): void {
  const file = telemetryFilePath();
  pendingWrites = pendingWrites
    .then(async () => {
      mkdirSync(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
      appendsSinceSizeCheck += 1;
      if (appendsSinceSizeCheck < SIZE_CHECK_EVERY) return;
      appendsSinceSizeCheck = 0;
      const info = await stat(file);
      if (info.size > MAX_FILE_BYTES) {
        // Rotate by rewriting the mirror from the bounded ring — explicit
        // retention, no unbounded growth, no second archive file.
        await writeFile(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      }
    })
    .catch(() => undefined);
}

/** Await all queued mirror appends (tests + clean shutdown only). */
export function flushAgentTelemetry(): Promise<void> {
  return pendingWrites.then(() => undefined).catch(() => undefined);
}

/** Redacted, whitespace-collapsed, bounded summary — never a raw prompt dump. */
export function summarizeForTelemetry(value: unknown, maxLength = SUMMARY_MAX): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const redacted = redactTrace(text.slice(0, maxLength * 2));
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 3)}...`;
}

/**
 * Record one telemetry event. Never throws; returns the event id, or null when
 * recording was skipped (production) or failed. Failure here must never affect
 * the caller's real work.
 */
export function recordAgentEvent(input: AgentTelemetryInput): string | null {
  try {
    if (!isDevTestModeEnabled()) return null;
    ensureSeeded();
    const event: AgentTelemetryEvent = {
      id: `evt_${randomUUID().slice(0, 12)}`,
      timestamp: new Date().toISOString(),
      projectId: input.projectId ?? null,
      deckId: input.deckId ?? null,
      conversationId: input.conversationId ?? null,
      correlationId: input.correlationId ?? null,
      stage: input.stage,
      caller: input.caller ?? 'unknown',
      cardId: input.cardId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      inputSummary: summarizeForTelemetry(input.inputSummary),
      outputSummary: summarizeForTelemetry(input.outputSummary),
      status: input.status,
      errorSummary: input.errorSummary ? summarizeForTelemetry(input.errorSummary) : null,
      durationMs: Number.isFinite(input.durationMs as number) ? (input.durationMs as number) : null,
      tools: Array.isArray(input.tools) ? input.tools.map(String) : [],
      graphReads: Array.isArray(input.graphReads) ? input.graphReads.map(String) : [],
      graphWrites: Array.isArray(input.graphWrites) ? input.graphWrites.map(String) : [],
      mode: input.mode,
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      source: 'ram',
    };
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    persistEvent(event);
    return event.id;
  } catch {
    return null; // telemetry must never break the app
  }
}

/** Newest-last slice of recent events. */
export function listAgentEvents(limit = 100): AgentTelemetryEvent[] {
  ensureSeeded();
  const bounded = Math.max(1, Math.min(MAX_EVENTS, Math.floor(limit) || 100));
  return events.slice(-bounded);
}

/** Every event sharing one runId/correlationId, oldest first. */
export function getAgentRunTrace(correlationId: string): AgentTelemetryEvent[] {
  ensureSeeded();
  const id = String(correlationId || '').trim();
  if (!id) return [];
  return events.filter((event) => event.correlationId === id);
}

/** Dev-dashboard clear button: empties the ring AND the durable mirror. */
export function clearAgentEvents(): number {
  ensureSeeded();
  const count = events.length;
  events.length = 0;
  try {
    writeFileSync(telemetryFilePath(), '', 'utf8');
  } catch {
    // mirror may not exist yet — the ring is cleared either way
  }
  return count;
}

/** Test-only: point the mirror at a temp dir (null = default) and reset state. */
export function resetAgentTelemetryForTest(dir: string | null): void {
  telemetryDirOverride = dir;
  seeded = false;
  appendsSinceSizeCheck = 0;
  events.length = 0;
}
