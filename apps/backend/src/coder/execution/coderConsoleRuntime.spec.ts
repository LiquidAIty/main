import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runCoderConsoleSession, type ConsoleCoderDeps } from './coderConsoleRuntime';
import { runCoderSubagent } from './coderRouter';
import { createApprovedCoderRun, type CoderAdapterId } from './coderExecution';

// Transcript artifacts write under resolveRepoRoot()/coder-workspace/runs — point
// that at a temp dir so tests never touch the real tree.
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'coder-console-'));
beforeAll(() => vi.stubEnv('LIQUIDAITY_GRPC_CWD', tmpRoot));
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * A fake Console session/manager: no PTY, no process, no model. It proves the
 * WIRING (identity, per-authority structured parse, transcript artifact, honest
 * failure, NO headless fallback). Live PTY behavior is Sol's proof.
 */
class FakeSession {
  info: { id: string; state: string; exitCode: number | null; error: string | null };
  private listeners: Array<(e: { kind: string; info: unknown }) => void> = [];
  constructor(private readonly raw: string, id = 'occ_fake_1') {
    this.info = { id, state: 'starting', exitCode: null, error: null };
  }
  subscribe(listener: (e: { kind: string; info: unknown }) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  rawResultText(): string {
    return this.raw;
  }
  transcriptText(): string {
    return '<redacted transcript>';
  }
  exitWith(code: number): void {
    this.info.state = 'exited';
    this.info.exitCode = code;
    for (const l of [...this.listeners]) l({ kind: 'lifecycle', info: this.info });
  }
}

const MODEL = 'glm-5.2';

function managerFor(result: { ok: boolean; session?: FakeSession; error?: string }, capture?: { req?: { args?: string[] } }): ConsoleCoderDeps['manager'] {
  return { start: (req: { args?: string[] }) => { if (capture) capture.req = req; return result.ok ? { ok: true, session: result.session } : { ok: false, error: result.error ?? 'x', missing: [] }; } } as unknown as ConsoleCoderDeps['manager'];
}

function validReportJson(summary = 'audited') {
  return JSON.stringify({
    coderPacketId: 'coder_1',
    status: 'succeeded',
    summary,
    specComparison: [],
    filesChanged: [],
    proofCommands: [],
    proofResults: [],
    failedCommands: [],
    blockers: [],
    assumptions: [],
    outOfScopeFindings: [],
    nextRecommendedTask: '',
    rawOutput: '',
  });
}

function validAuditJson(conclusion = 'audit conclusion') {
  return JSON.stringify({
    conclusion,
    repositoryRoot: 'C:/Projects/main',
    repositoryIdentity: 'liquidaity',
    revision: 'c700add0',
    freshness: 'fresh',
    codeGraphQuery: 'runCoderSubagent',
    codeGraphNodeRefs: ['coderRouter.ts::runCoderSubagent'],
    files: ['apps/backend/src/coder/execution/coderRouter.ts'],
    symbols: ['runCoderSubagent'],
    findings: ['console is the only runtime'],
    unresolvedQuestions: [],
    risks: [],
    implementationBoundaries: ['read-only'],
    requiredTests: ['coderRouter.spec.ts'],
    viewContract: { projectId: 'p1', focusSymbols: ['runCoderSubagent'], focusPaths: ['apps/backend/src/coder/execution/coderRouter.ts'] },
    artifactRefs: [],
  });
}

function packet(authority?: 'direct_main_audit' | 'mag_one_execution') {
  return createApprovedCoderRun({
    parentRunId: 'parent_1',
    projectId: 'p1',
    deckId: 'deck_builder',
    cardId: 'card_local_coder',
    adapter: 'claude_code' as CoderAdapterId,
    invocationMode: 'harness_subagent',
    authority,
    repositoryRoot: 'C:/Projects/main',
    allowedPaths: ['.'],
    deniedPaths: ['.git'],
    rawRequest: 'audit it',
    approvedPrompt: 'audit the coder runtime',
    promptVersion: 1,
    workspaceGranted: true,
    liveRunApproved: true,
    proofRequirements: ['Return a validated result.'],
  } as Parameters<typeof createApprovedCoderRun>[0]);
}

describe('runCoderConsoleSession (Console PTY bridge)', () => {
  it('direct_main_audit returns a validated audit result + CodeGraphViewContract, report null, transcript persisted', async () => {
    const session = new FakeSession(validAuditJson('audited by console'));
    const p = packet('direct_main_audit');
    const capture: { req?: { args?: string[] } } = {};
    const promise = runCoderConsoleSession(p, { manager: managerFor({ ok: true, session }, capture), model: MODEL });
    session.exitWith(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.resultKind).toBe('audit');
    expect(result.auditResult?.conclusion).toBe('audited by console');
    expect(result.auditResult?.viewContract.focusSymbols).toContain('runCoderSubagent');
    expect(result.report).toBeNull();
    expect(result.childRunId).toBe(p.runId);
    expect(result.correlationId).toBe(p.correlationId);
    expect(result.transcriptArtifact).toMatch(/coder-workspace\/runs\/.*\/transcript\.txt$/);
    // Read-only audit argv: plan mode + scoped allowlist (codegraph doorway + reads
    // only, no shell) + strict scoped MCP config.
    const args = capture.req?.args ?? [];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__liquid_aity_codegraph__codegraph_status');
    expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('Bash');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Edit');
    expect(args).toContain('--strict-mcp-config');
  });

  it('mag_one_execution returns the validated CoderReport, auditResult null', async () => {
    const session = new FakeSession(validReportJson('executed'));
    const p = packet('mag_one_execution');
    const promise = runCoderConsoleSession(p, { manager: managerFor({ ok: true, session }), model: MODEL });
    session.exitWith(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.resultKind).toBe('coder_report');
    expect(result.report?.summary).toBe('executed');
    expect(result.auditResult).toBeNull();
  });

  it('propagates a non-zero exit as a failed run with no fabricated result', async () => {
    const session = new FakeSession(''); // no valid JSON on stdout
    const promise = runCoderConsoleSession(packet('mag_one_execution'), { manager: managerFor({ ok: true, session }), model: MODEL });
    session.exitWith(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.report).toBeNull();
    expect(result.error).toBe('console_coder_no_valid_result');
  });

  it('propagates a session start failure (runtime unavailable) fail-closed', async () => {
    const result = await runCoderConsoleSession(packet(), {
      manager: managerFor({ ok: false, error: 'console_runtime_unavailable' }),
      model: MODEL,
    });
    expect(result.ok).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.error).toBe('console_runtime_unavailable');
  });

  it('fails honestly (blocked) when no model is resolved — never spawns a doomed run', async () => {
    let started = false;
    const manager = { start: () => { started = true; return { ok: true, session: new FakeSession(validReportJson()) }; } } as unknown as ConsoleCoderDeps['manager'];
    const result = await runCoderConsoleSession(packet(), { manager });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('console_coder_model_unresolved');
    expect(started).toBe(false);
  });
});

describe('runCoderSubagent (canonical Console PTY runtime — no headless fallback)', () => {
  it('mag_one_execution: returns the CoderReport through parent/child identity', async () => {
    const session = new FakeSession(validReportJson('via router'));
    const promise = runCoderSubagent(
      { parentRunId: 'req_parent', projectId: 'p1', deckId: 'deck_builder', conversationId: 'c1', cardId: 'card_local_coder', adapter: 'claude_code', approvedPrompt: 'do it', authority: 'mag_one_execution', model: MODEL, provider: 'openrouter' },
      undefined,
      { manager: managerFor({ ok: true, session }) },
    );
    session.exitWith(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.parentRunId).toBe('req_parent');
    expect(result.childRunId).toMatch(/^coder_/);
    expect(result.resultKind).toBe('coder_report');
    expect((result.report as { summary?: string } | null)?.summary).toBe('via router');
    expect(result.exactCommand).toBeNull();
  });

  it('direct_main_audit: returns the audit result (with view contract) in report', async () => {
    const session = new FakeSession(validAuditJson('router audit'));
    const promise = runCoderSubagent(
      { parentRunId: 'rp', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'claude_code', approvedPrompt: 'audit', authority: 'direct_main_audit', model: MODEL },
      undefined,
      { manager: managerFor({ ok: true, session }) },
    );
    session.exitWith(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.resultKind).toBe('audit');
    expect((result.report as { conclusion?: string } | null)?.conclusion).toBe('router audit');
    expect(result.transcriptArtifact).toMatch(/transcript\.txt$/);
  });

  it('NEVER falls back to headless: a bogus adapter still runs via Console PTY and does not throw adapter_unsupported', async () => {
    const session = new FakeSession(validReportJson('console only'));
    const promise = runCoderSubagent(
      { parentRunId: 'rp', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'nope', approvedPrompt: 'x', authority: 'mag_one_execution', model: MODEL },
      undefined,
      { manager: managerFor({ ok: true, session }) },
    );
    session.exitWith(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect((result.report as { summary?: string } | null)?.summary).toBe('console only');
  });

  it('returns an honest failure when the Console runtime is unavailable (no hidden second coder)', async () => {
    const result = await runCoderSubagent(
      { parentRunId: 'rp', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'claude_code', approvedPrompt: 'x', model: MODEL },
      undefined,
      { manager: managerFor({ ok: false, error: 'console_runtime_unavailable' }) },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('console_runtime_unavailable');
  });

  it('rejects incomplete run identity (fail closed)', async () => {
    await expect(
      runCoderSubagent({ parentRunId: '', projectId: 'p1', deckId: 'd', conversationId: 'c', cardId: 'card', adapter: 'claude_code', approvedPrompt: 'x', model: MODEL }),
    ).rejects.toThrow('coder_router_identity_incomplete');
  });
});
