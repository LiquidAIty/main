/**
 * CoderReport evidence verifier — the dev-only anti-"trust me" primitive.
 *
 * A coding agent (external Claude Code/Codex/MCP/plugin, or the managed
 * OpenClaude+API adapter) submits its CoderReport claims; this module checks
 * them DETERMINISTICALLY against real runtime evidence:
 *   - agent telemetry (trace ids, card calls, provider/model, graph writes,
 *     failed/blocked contradictions, postflight)
 *   - the repository filesystem (claimed changed files exist + were recently
 *     modified — content is NOT diffed and the note says so).
 *
 * No LLM is involved anywhere in classification — every verdict cites the
 * exact event ids or filesystem facts it rests on. What telemetry cannot see
 * (test output, code content) is reported as MISSING_PROOF with an honest
 * note, never guessed. The original submission is preserved verbatim
 * (bounded). Verification failure never touches product runtime.
 *
 * Storage: bounded in-memory list + a JSONL mirror next to the telemetry
 * mirror (dev-only, survives watch reloads, cleared explicitly).
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDevTestModeEnabled } from './devTest';
import {
  getAgentRunTrace,
  summarizeForTelemetry,
  type AgentTelemetryEvent,
} from './agentTelemetry';
import { resolveCoderWorkspaceRoot, resolveRepoRoot } from '../coder/workspaceRoot';
import { CODER_EXECUTION_MODES, type CoderExecutionMode } from './coderJobs';

export type CoderReportClaims = {
  traceIds: string[];
  filesChanged: string[];
  tests: string[];
  cardCalls: string[];
  graphWrites: string[];
  provider: string | null;
  model: string | null;
  postflight: boolean | null;
  runtimeBehavior: string;
};

export type CoderReportSubmission = {
  id: string;
  timestamp: string;
  projectId: string;
  deckId: string | null;
  executionMode: CoderExecutionMode | 'unknown';
  /** Adapter identity: 'claude-code', 'codex', 'openclaude' … */
  adapter: string | null;
  jobId: string | null;
  reportText: string;
  claims: CoderReportClaims;
};

export type ClaimVerdict = 'SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED' | 'MISSING_PROOF';

export type ClaimFinding = {
  kind:
    | 'trace_exists'
    | 'provider_model'
    | 'card_call'
    | 'graph_write'
    | 'success_consistency'
    | 'postflight'
    | 'file_changed'
    | 'tests';
  claim: string;
  verdict: ClaimVerdict;
  /** Telemetry event ids (or filesystem facts) this verdict rests on. */
  evidence: string[];
  note: string;
};

export type CoderReportVerification = {
  id: string;
  submissionId: string;
  timestamp: string;
  findings: ClaimFinding[];
  verdict: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED';
  supported: number;
  unsupported: number;
  contradicted: number;
  missingProof: number;
};

const MAX_RECORDS = 50;
const REPORT_TEXT_MAX = 20_000;
const TRACE_FRESH_MS = 24 * 60 * 60 * 1000;
const FILE_FRESH_MS = 24 * 60 * 60 * 1000;

type StoredRecord = { submission: CoderReportSubmission; verification: CoderReportVerification | null };

const records: StoredRecord[] = [];
let dirOverride: string | null = null;
let seeded = false;
let pendingWrites: Promise<void> = Promise.resolve();

function mirrorFile(): string {
  const dir = dirOverride ?? path.join(resolveCoderWorkspaceRoot(), 'dev-telemetry');
  return path.join(dir, 'coder-reports.jsonl');
}

function ensureSeeded(): void {
  if (seeded) return;
  seeded = true;
  try {
    if (!isDevTestModeEnabled()) return;
    const lines = readFileSync(mirrorFile(), 'utf8').split(/\r?\n/).filter(Boolean).slice(-MAX_RECORDS);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as StoredRecord;
        if (parsed?.submission?.id) records.push(parsed);
      } catch {
        // drop corrupt line — never invent report history
      }
    }
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  } catch {
    // no mirror yet
  }
}

function persistRecord(record: StoredRecord): void {
  const file = mirrorFile();
  pendingWrites = pendingWrites
    .then(async () => {
      mkdirSync(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    })
    .catch(() => undefined);
}

async function rewriteMirror(): Promise<void> {
  const file = mirrorFile();
  pendingWrites = pendingWrites
    .then(async () => {
      mkdirSync(path.dirname(file), { recursive: true });
      await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8');
    })
    .catch(() => undefined);
  await pendingWrites;
}

function asStringArray(value: unknown, cap = 50): string[] {
  return Array.isArray(value)
    ? value.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, cap)
    : [];
}

export function normalizeSubmission(body: Record<string, unknown>): CoderReportSubmission | { error: string } {
  const projectId = String(body.projectId ?? '').trim();
  if (!projectId) return { error: 'projectId_required' };
  const reportText = String(body.reportText ?? body.report ?? '').slice(0, REPORT_TEXT_MAX);
  if (!reportText.trim()) return { error: 'reportText_required' };
  const claims = (body.claims && typeof body.claims === 'object' ? body.claims : {}) as Record<string, unknown>;
  const executionMode = String(body.executionMode ?? '').trim();
  return {
    id: `crpt_${randomUUID().slice(0, 12)}`,
    timestamp: new Date().toISOString(),
    projectId,
    deckId: String(body.deckId ?? '').trim() || null,
    executionMode: (CODER_EXECUTION_MODES as readonly string[]).includes(executionMode)
      ? (executionMode as CoderExecutionMode)
      : 'unknown',
    adapter: String(body.adapter ?? '').trim() || null,
    jobId: String(body.jobId ?? '').trim() || null,
    reportText,
    claims: {
      traceIds: asStringArray(claims.traceIds),
      filesChanged: asStringArray(claims.filesChanged),
      tests: asStringArray(claims.tests),
      cardCalls: asStringArray(claims.cardCalls),
      graphWrites: asStringArray(claims.graphWrites, 10),
      provider: String(claims.provider ?? '').trim() || null,
      model: String(claims.model ?? '').trim() || null,
      postflight: typeof claims.postflight === 'boolean' ? claims.postflight : null,
      runtimeBehavior: summarizeForTelemetry(claims.runtimeBehavior, 300),
    },
  };
}

/** Deterministic evidence matching. Pure over (submission, trace loader, fs facts). */
export function verifySubmission(
  submission: CoderReportSubmission,
  deps: {
    loadTrace?: (correlationId: string) => AgentTelemetryEvent[];
    repoRoot?: string;
    now?: number;
  } = {},
): CoderReportVerification {
  const loadTrace = deps.loadTrace ?? getAgentRunTrace;
  const repoRoot = deps.repoRoot ?? resolveRepoRoot();
  const now = deps.now ?? Date.now();
  const findings: ClaimFinding[] = [];
  const { claims } = submission;

  // 1 — every claimed trace id must exist in telemetry and be fresh.
  const traceEvents = new Map<string, AgentTelemetryEvent[]>();
  for (const traceId of claims.traceIds) {
    const events = loadTrace(traceId);
    traceEvents.set(traceId, events);
    if (events.length === 0) {
      findings.push({
        kind: 'trace_exists',
        claim: `trace ${traceId} exists`,
        verdict: 'MISSING_PROOF',
        evidence: [],
        note: 'no telemetry events carry this correlationId (ring + durable mirror checked)',
      });
      continue;
    }
    const newest = Math.max(...events.map((e) => Date.parse(e.timestamp) || 0));
    const stale = now - newest > TRACE_FRESH_MS;
    findings.push({
      kind: 'trace_exists',
      claim: `trace ${traceId} exists`,
      verdict: stale ? 'UNSUPPORTED' : 'SUPPORTED',
      evidence: events.map((e) => e.id).slice(0, 20),
      note: stale
        ? `trace found but newest event is older than 24h (${new Date(newest).toISOString()})`
        : `${events.length} event(s), newest ${new Date(newest).toISOString()}`,
    });
  }
  const allTraceEvents = [...traceEvents.values()].flat();

  // 2 — claimed provider/model must match what the traces actually resolved.
  if (claims.provider || claims.model) {
    const modelEvents = allTraceEvents.filter((e) => e.provider || e.model);
    if (modelEvents.length === 0) {
      findings.push({
        kind: 'provider_model',
        claim: `ran via ${claims.provider ?? '?'}/${claims.model ?? '?'}`,
        verdict: 'MISSING_PROOF',
        evidence: [],
        note: 'no event in the claimed traces carries provider/model',
      });
    } else {
      const matches = modelEvents.filter(
        (e) =>
          (!claims.provider || e.provider === claims.provider) &&
          (!claims.model || e.model === claims.model),
      );
      const conflicting = modelEvents.filter(
        (e) =>
          (claims.provider && e.provider && e.provider !== claims.provider) ||
          (claims.model && e.model && e.model !== claims.model),
      );
      findings.push({
        kind: 'provider_model',
        claim: `ran via ${claims.provider ?? '?'}/${claims.model ?? '?'}`,
        verdict: matches.length > 0 ? 'SUPPORTED' : 'CONTRADICTED',
        evidence: (matches.length > 0 ? matches : conflicting).map((e) => e.id).slice(0, 10),
        note:
          matches.length > 0
            ? `${matches.length} event(s) match`
            : `traces show ${[...new Set(conflicting.map((e) => `${e.provider}/${e.model}`))].join(', ')} instead`,
      });
    }
  }

  // 3 — claimed card calls must appear in the traces.
  for (const cardId of claims.cardCalls) {
    const hits = allTraceEvents.filter((e) => e.cardId === cardId);
    findings.push({
      kind: 'card_call',
      claim: `card ${cardId} was called`,
      verdict: hits.length > 0 ? 'SUPPORTED' : 'MISSING_PROOF',
      evidence: hits.map((e) => e.id).slice(0, 10),
      note: hits.length > 0 ? `${hits.length} event(s)` : 'no event in the claimed traces names this card',
    });
  }

  // 4 — claimed graph writes must show a completed graph_write; a blocked one contradicts.
  for (const graph of claims.graphWrites) {
    const writes = allTraceEvents.filter(
      (e) => e.stage === 'graph_write' && e.graphWrites.includes(graph),
    );
    const completed = writes.filter((e) => e.status === 'completed');
    const blocked = writes.filter((e) => e.status === 'blocked' || e.status === 'failed');
    findings.push({
      kind: 'graph_write',
      claim: `wrote graph ${graph}`,
      verdict: completed.length > 0 ? 'SUPPORTED' : blocked.length > 0 ? 'CONTRADICTED' : 'MISSING_PROOF',
      evidence: (completed.length > 0 ? completed : blocked).map((e) => e.id).slice(0, 10),
      note:
        completed.length > 0
          ? `${completed.length} completed write event(s)`
          : blocked.length > 0
            ? `write was blocked/failed: ${blocked[0].errorSummary ?? 'no reason recorded'}`
            : 'no graph_write event for this graph in the claimed traces',
    });
  }

  // 5 — a success-shaped report is contradicted by failed events in its own traces.
  if (allTraceEvents.length > 0) {
    const failed = allTraceEvents.filter((e) => e.status === 'failed');
    findings.push({
      kind: 'success_consistency',
      claim: 'claimed runtime behavior is not contradicted by failed events',
      verdict: failed.length === 0 ? 'SUPPORTED' : 'CONTRADICTED',
      evidence: failed.map((e) => e.id).slice(0, 10),
      note:
        failed.length === 0
          ? 'no failed events in the claimed traces'
          : `${failed.length} failed event(s): ${[...new Set(failed.map((e) => e.stage))].join(', ')}`,
    });
  }

  // 6 — claimed postflight must show a completed hermes_postflight event.
  if (claims.postflight === true) {
    const postflights = allTraceEvents.filter(
      (e) => e.stage === 'hermes_postflight' && e.status === 'completed',
    );
    findings.push({
      kind: 'postflight',
      claim: 'Hermes postflight ran',
      verdict: postflights.length > 0 ? 'SUPPORTED' : 'MISSING_PROOF',
      evidence: postflights.map((e) => e.id).slice(0, 5),
      note: postflights.length > 0 ? 'completed postflight event found' : 'no completed hermes_postflight event in the claimed traces',
    });
  }

  // 7 — claimed changed files: exist + recently modified (content NOT diffed).
  for (const file of claims.filesChanged) {
    const rel = file.replace(/\\/g, '/');
    if (rel.includes('..')) {
      findings.push({ kind: 'file_changed', claim: `changed ${rel}`, verdict: 'UNSUPPORTED', evidence: [], note: 'path traversal rejected' });
      continue;
    }
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) {
      findings.push({
        kind: 'file_changed',
        claim: `changed ${rel}`,
        verdict: 'CONTRADICTED',
        evidence: [`missing: ${rel}`],
        note: 'claimed changed file does not exist in the repo',
      });
      continue;
    }
    try {
      const mtime = statSync(abs).mtime.getTime();
      const fresh = now - mtime <= FILE_FRESH_MS;
      findings.push({
        kind: 'file_changed',
        claim: `changed ${rel}`,
        verdict: fresh ? 'SUPPORTED' : 'UNSUPPORTED',
        evidence: [`mtime: ${new Date(mtime).toISOString()}`],
        note: fresh
          ? 'file exists and was modified within 24h — content not diffed by this check'
          : 'file exists but was not recently modified',
      });
    } catch {
      findings.push({ kind: 'file_changed', claim: `changed ${rel}`, verdict: 'MISSING_PROOF', evidence: [], note: 'file stat failed' });
    }
  }

  // 8 — test claims are not measurable from runtime telemetry; say so honestly.
  for (const test of claims.tests) {
    findings.push({
      kind: 'tests',
      claim: `tests: ${summarizeForTelemetry(test, 120)}`,
      verdict: 'MISSING_PROOF',
      evidence: [],
      note: 'test execution is not measurable by runtime telemetry — verify via the test command output in the report',
    });
  }

  // Overall verdict weighs only measurable kinds (tests are informational).
  const measurable = findings.filter((f) => f.kind !== 'tests');
  const contradicted = measurable.filter((f) => f.verdict === 'CONTRADICTED').length;
  const supported = measurable.filter((f) => f.verdict === 'SUPPORTED').length;
  const unsupported = measurable.filter((f) => f.verdict === 'UNSUPPORTED').length;
  const missing = findings.filter((f) => f.verdict === 'MISSING_PROOF').length;
  const verdict: CoderReportVerification['verdict'] =
    contradicted > 0
      ? 'CONTRADICTED'
      : supported > 0 && unsupported === 0 && measurable.every((f) => f.verdict === 'SUPPORTED')
        ? 'SUPPORTED'
        : supported > 0
          ? 'PARTIALLY_SUPPORTED'
          : 'UNSUPPORTED';

  return {
    id: `crv_${randomUUID().slice(0, 12)}`,
    submissionId: submission.id,
    timestamp: new Date().toISOString(),
    findings,
    verdict,
    supported,
    unsupported,
    contradicted,
    missingProof: missing,
  };
}

// ── store operations (dev-only, bounded, mirrored) ───────────────────────────

export function submitCoderReport(body: Record<string, unknown>):
  | { ok: true; submission: CoderReportSubmission; verification: CoderReportVerification }
  | { ok: false; error: string } {
  ensureSeeded();
  const submission = normalizeSubmission(body);
  if ('error' in submission) return { ok: false, error: submission.error };
  const verification = verifySubmission(submission);
  const record: StoredRecord = { submission, verification };
  records.push(record);
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  persistRecord(record);
  return { ok: true, submission, verification };
}

/** Re-run verification for an existing submission (events may have arrived). */
export function reverifyCoderReport(submissionId: string):
  | { ok: true; verification: CoderReportVerification }
  | { ok: false; error: string } {
  ensureSeeded();
  const record = records.find((r) => r.submission.id === submissionId);
  if (!record) return { ok: false, error: `coder_report_not_found: ${submissionId}` };
  record.verification = verifySubmission(record.submission);
  void rewriteMirror();
  return { ok: true, verification: record.verification };
}

export function getCoderReport(submissionId: string): StoredRecord | null {
  ensureSeeded();
  return records.find((r) => r.submission.id === submissionId) ?? null;
}

export function listCoderReports(limit = 20): StoredRecord[] {
  ensureSeeded();
  const bounded = Math.max(1, Math.min(MAX_RECORDS, Math.floor(limit) || 20));
  return records.slice(-bounded);
}

export function clearCoderReports(): number {
  ensureSeeded();
  const count = records.length;
  records.length = 0;
  // Truncate through the SAME write chain so a queued append from a just-
  // submitted report cannot land after the truncation and resurrect it.
  const file = mirrorFile();
  pendingWrites = pendingWrites
    .then(async () => {
      mkdirSync(path.dirname(file), { recursive: true });
      await writeFile(file, '', 'utf8');
    })
    .catch(() => undefined);
  return count;
}

/** Test-only: point the mirror at a temp dir (null = default) and reset. */
export function resetCoderReportsForTest(dir: string | null): void {
  dirOverride = dir;
  seeded = false;
  records.length = 0;
  pendingWrites = Promise.resolve();
}

/** Await queued mirror writes (tests only). */
export function flushCoderReports(): Promise<void> {
  return pendingWrites.then(() => undefined).catch(() => undefined);
}
