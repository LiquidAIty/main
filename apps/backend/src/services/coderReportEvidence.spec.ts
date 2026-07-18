// CoderReport evidence verifier: deterministic matching against real
// telemetry + filesystem facts. Every verdict path (SUPPORTED / UNSUPPORTED /
// CONTRADICTED / MISSING_PROOF) is exercised with injected traces — nothing
// here fabricates evidence, and the store survives a simulated reload.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTelemetryEvent } from './agentTelemetry';
import {
  clearCoderReports,
  flushCoderReports,
  getCoderReport,
  listCoderReports,
  normalizeSubmission,
  resetCoderReportsForTest,
  reverifyCoderReport,
  submitCoderReport,
  verifySubmission,
  type CoderReportSubmission,
} from './coderReportEvidence';

let dir: string;
let repoDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'coder-reports-'));
  repoDir = mkdtempSync(path.join(tmpdir(), 'coder-repo-'));
  resetCoderReportsForTest(dir);
});

afterEach(async () => {
  await flushCoderReports();
  resetCoderReportsForTest(null);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(repoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const NOW = Date.parse('2026-07-10T12:00:00.000Z');

function event(partial: Partial<AgentTelemetryEvent>): AgentTelemetryEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: '2026-07-10T11:30:00.000Z',
    projectId: 'p1',
    deckId: 'deck_builder',
    conversationId: null,
    correlationId: 'run_1',
    stage: 'card_call',
    caller: 'dev_probe',
    cardId: 'card_research_agent',
    provider: 'openrouter',
    model: 'openai/gpt-5.1-chat',
    inputSummary: '',
    outputSummary: '',
    status: 'completed',
    errorSummary: null,
    durationMs: 100,
    contextChars: null,
    tools: [],
    graphReads: [],
    graphWrites: [],
    mode: 'real_model_call',
    metadata: {},
    source: 'ram',
    ...partial,
  };
}

function submission(claims: Partial<CoderReportSubmission['claims']>): CoderReportSubmission {
  const normalized = normalizeSubmission({
    projectId: 'p1',
    reportText: 'VERDICT: done',
    executionMode: 'external_coder',
    adapter: 'claude-code',
    claims,
  });
  if ('error' in normalized) throw new Error(normalized.error);
  return normalized;
}

describe('verifySubmission — deterministic evidence matching', () => {
  it('supports a claim whose trace, model, card call, and graph write all check out', () => {
    const events = [
      event({ correlationId: 'run_1' }),
      event({ correlationId: 'run_1', stage: 'graph_write', graphWrites: ['thinkgraph'] }),
    ];
    const verification = verifySubmission(
      submission({
        traceIds: ['run_1'],
        cardCalls: ['card_research_agent'],
        graphWrites: ['thinkgraph'],
        provider: 'openrouter',
        model: 'openai/gpt-5.1-chat',
      }),
      { loadTrace: () => events, now: NOW },
    );
    expect(verification.verdict).toBe('SUPPORTED');
    expect(verification.contradicted).toBe(0);
    const traceFinding = verification.findings.find((f) => f.kind === 'trace_exists')!;
    expect(traceFinding.verdict).toBe('SUPPORTED');
    expect(traceFinding.evidence.length).toBeGreaterThan(0);
  });

  it('reports MISSING_PROOF for a trace id nothing recorded', () => {
    const verification = verifySubmission(submission({ traceIds: ['run_ghost'] }), {
      loadTrace: () => [],
      now: NOW,
    });
    expect(verification.verdict).toBe('UNSUPPORTED');
    expect(verification.findings[0]).toMatchObject({ kind: 'trace_exists', verdict: 'MISSING_PROOF' });
  });

  it('marks a stale trace UNSUPPORTED (older than 24h)', () => {
    const stale = [event({ timestamp: '2026-07-08T00:00:00.000Z' })];
    const verification = verifySubmission(submission({ traceIds: ['run_1'] }), {
      loadTrace: () => stale,
      now: NOW,
    });
    expect(verification.findings[0].verdict).toBe('UNSUPPORTED');
    expect(verification.findings[0].note).toContain('older than 24h');
  });

  it('CONTRADICTS a model claim when traces resolved a different provider/model', () => {
    const events = [event({ provider: 'openai', model: 'gpt-5.1-chat-latest' })];
    const verification = verifySubmission(
      submission({ traceIds: ['run_1'], provider: 'openrouter', model: 'openai/gpt-5.1-chat' }),
      { loadTrace: () => events, now: NOW },
    );
    const finding = verification.findings.find((f) => f.kind === 'provider_model')!;
    expect(finding.verdict).toBe('CONTRADICTED');
    expect(finding.note).toContain('openai/gpt-5.1-chat-latest');
    expect(verification.verdict).toBe('CONTRADICTED');
  });

  it('CONTRADICTS a graph-write claim when the write event was blocked', () => {
    const events = [
      event({
        stage: 'graph_write',
        status: 'blocked',
        graphWrites: ['thinkgraph'],
        errorSummary: 'thinkgraph_authority_missing',
      }),
    ];
    const verification = verifySubmission(
      submission({ traceIds: ['run_1'], graphWrites: ['thinkgraph'] }),
      { loadTrace: () => events, now: NOW },
    );
    const finding = verification.findings.find((f) => f.kind === 'graph_write')!;
    expect(finding.verdict).toBe('CONTRADICTED');
    expect(finding.note).toContain('thinkgraph_authority_missing');
  });

  it('CONTRADICTS success when the claimed traces contain failed events', () => {
    const events = [event({}), event({ status: 'failed', stage: 'mag_one_dispatch', errorSummary: 'rails down' })];
    const verification = verifySubmission(submission({ traceIds: ['run_1'] }), {
      loadTrace: () => events,
      now: NOW,
    });
    const finding = verification.findings.find((f) => f.kind === 'success_consistency')!;
    expect(finding.verdict).toBe('CONTRADICTED');
  });

  it('checks claimed files against the real filesystem (exists+fresh / missing)', () => {
    const freshFile = path.join(repoDir, 'src', 'real.ts');
    mkdirSync(path.dirname(freshFile), { recursive: true });
    writeFileSync(freshFile, 'x', 'utf8');
    utimesSync(freshFile, new Date(NOW - 1000), new Date(NOW - 1000));
    const verification = verifySubmission(
      submission({ filesChanged: ['src/real.ts', 'src/ghost.ts'] }),
      { loadTrace: () => [], repoRoot: repoDir, now: NOW },
    );
    const [real, ghost] = verification.findings.filter((f) => f.kind === 'file_changed');
    expect(real.verdict).toBe('SUPPORTED');
    expect(real.note).toContain('content not diffed');
    expect(ghost.verdict).toBe('CONTRADICTED');
    expect(verification.verdict).toBe('CONTRADICTED');
  });

  it('reports test claims as MISSING_PROOF (not measurable) without sinking the verdict', () => {
    const verification = verifySubmission(
      submission({ traceIds: ['run_1'], tests: ['vitest run — 12 passed'] }),
      { loadTrace: () => [event({})], now: NOW },
    );
    const testFinding = verification.findings.find((f) => f.kind === 'tests')!;
    expect(testFinding.verdict).toBe('MISSING_PROOF');
    expect(verification.verdict).toBe('SUPPORTED');
  });
});

describe('store — submit / reverify / get / list / clear, mirrored', () => {
  it('submit verifies immediately, preserves the report, and survives a reload', async () => {
    const result = submitCoderReport({
      projectId: 'p1',
      reportText: 'VERDICT: done',
      executionMode: 'openclaude_api_coder',
      adapter: 'openclaude',
      claims: { traceIds: ['run_none'] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verification.findings[0].verdict).toBe('MISSING_PROOF');
    expect(result.submission.executionMode).toBe('openclaude_api_coder');
    await flushCoderReports();

    resetCoderReportsForTest(dir); // simulate backend watch reload
    const restored = getCoderReport(result.submission.id);
    expect(restored?.submission.reportText).toBe('VERDICT: done');
    expect(restored?.verification?.verdict).toBe('UNSUPPORTED');
  });

  it('reverify re-runs matching and unknown ids fail honestly', () => {
    expect(reverifyCoderReport('crpt_missing')).toMatchObject({ ok: false });
    const result = submitCoderReport({ projectId: 'p1', reportText: 'r', claims: {} });
    if (!result.ok) throw new Error('submit failed');
    const again = reverifyCoderReport(result.submission.id);
    expect(again.ok).toBe(true);
  });

  it('rejects submissions without projectId or reportText; clear empties store+mirror', async () => {
    expect(submitCoderReport({ reportText: 'x' })).toMatchObject({ ok: false, error: 'projectId_required' });
    expect(submitCoderReport({ projectId: 'p1' })).toMatchObject({ ok: false, error: 'reportText_required' });
    submitCoderReport({ projectId: 'p1', reportText: 'r', claims: {} });
    expect(listCoderReports()).toHaveLength(1);
    expect(clearCoderReports()).toBe(1);
    await flushCoderReports();
    resetCoderReportsForTest(dir);
    expect(listCoderReports()).toHaveLength(0);
  });
});
