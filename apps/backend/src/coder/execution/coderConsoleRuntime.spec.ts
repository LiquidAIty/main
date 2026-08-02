import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runOpenClaudeCodeTask, type ConsoleCoderDeps } from './coderConsoleRuntime';
import { resolveEffectiveCoderToolSnapshot } from './coderRuntimeContract';

// Transcript artifacts write under resolveRepoRoot()/coder-workspace/runs — point
// that at a temp dir so tests never touch the real tree.
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'coder-console-'));
beforeAll(() => {
  vi.stubEnv('LIQUIDAITY_GRPC_CWD', tmpRoot);
  const repoConfigPath = path.basename(process.cwd()).toLowerCase() === 'backend'
    ? path.resolve(process.cwd(), '..', '..', '.mcp.json')
    : path.join(process.cwd(), '.mcp.json');
  const config = JSON.parse(readFileSync(repoConfigPath, 'utf8')) as {
    mcpServers: Record<string, { env?: Record<string, string> }>;
  };
  config.mcpServers['codebase-memory'].env = {
    ...(config.mcpServers['codebase-memory'].env ?? {}),
    CODEBASE_ROOT: tmpRoot,
  };
  writeFileSync(path.join(tmpRoot, '.mcp.json'), JSON.stringify(config), 'utf8');
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * A fake Console session/manager: no PTY, no process, no model. It proves the
 * WIRING (identity, per-authority structured parse, transcript artifact, honest
 * failure, NO headless fallback). Live PTY behavior is proven only by a real model-backed run.
 */
class FakeSession {
  info: {
    id: string;
    state: string;
    exitCode: number | null;
    error: string | null;
    commandPath: string;
    runtimeSource: string;
    transportMode: string;
    provider: string | null;
    model: string | null;
  };
  private listeners: Array<(e: { kind: string; info: unknown }) => void> = [];
  stopCalls = 0;
  private eventCount = 1;
  constructor(private readonly raw: string, id = 'occ_fake_1') {
    this.info = {
      id,
      state: 'running',
      exitCode: null,
      error: null,
      commandPath: 'C:/openclaude/openclaude.exe',
      runtimeSource: 'installed',
      transportMode: 'pipe',
      provider: 'openrouter',
      model: MODEL,
    };
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
  transcript() {
    return this.raw
      ? [{ seq: 1, stream: 'stdout', data: this.raw, at: '2026-07-25T00:00:00.000Z' }]
      : [];
  }
  structuredEventCount(): number {
    return this.eventCount;
  }
  stop(): boolean {
    this.stopCalls += 1;
    this.exitWith(143);
    return true;
  }
  exitWith(code: number): void {
    if (this.info.state === 'exited') return;
    this.info.state = 'exited';
    this.info.exitCode = code;
    this.eventCount += 1;
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
    codeGraphQuery: 'runOpenClaudeCodeTask',
    codeGraphNodeRefs: ['coderConsoleRuntime.ts::runOpenClaudeCodeTask'],
    files: ['apps/backend/src/coder/execution/coderConsoleRuntime.ts'],
    symbols: ['runOpenClaudeCodeTask'],
    findings: ['console is the only runtime'],
    unresolvedQuestions: [],
    risks: [],
    implementationBoundaries: ['read-only'],
    requiredTests: ['coderConsoleRuntime.spec.ts'],
    projectionContract: { projectId: 'p1', focusSymbols: ['runOpenClaudeCodeTask'], focusPaths: ['apps/backend/src/coder/execution/coderConsoleRuntime.ts'] },
    artifactRefs: [],
  });
}

function task(authority?: 'direct_main_audit' | 'mag_one_execution') {
  const resolvedAuthority = authority ?? 'direct_main_audit';
  return {
    parentRunId: 'parent_1',
    projectId: 'p1',
    deckId: 'deck_builder',
    conversationId: 'main',
    cardId: 'card_local_coder',
    authority: resolvedAuthority,
    approvedPrompt: 'audit the coder runtime',
    model: MODEL,
    provider: 'openrouter',
    toolSnapshot: resolveEffectiveCoderToolSnapshot({
      authority: resolvedAuthority,
      savedTools: ['cbm.search_graph'],
      catalog: [{
        name: 'cbm.search_graph', description: 'Search CodeGraph', inputSchema: { type: 'object' },
        capability: {
          surface: 'knowledge', capabilityType: 'callable_tool', graphAuthority: 'cbm',
          authorityClass: 'repository_structure', runtimeCompatibility: ['local_coder'],
          cardAssignable: true, latency: 'fast', providerPossible: false, health: 'available',
          recommendedUse: 'Search graph', verification: 'live', approvalRequired: false, deprecated: false,
        },
      }],
      runId: 'coder_test',
    }),
  };
}

describe('runOpenClaudeCodeTask (visible Console PTY)', () => {
  it('direct_main_audit returns a validated audit result with code evidence, report null, transcript persisted', async () => {
    const session = new FakeSession(validAuditJson('audited by console'));
    const p = task('direct_main_audit');
    const capture: { req?: { args?: string[] } } = {};
    const promise = runOpenClaudeCodeTask(p, { manager: managerFor({ ok: true, session }, capture) });
    session.exitWith(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.resultKind).toBe('audit');
    expect(result.auditResult?.conclusion).toBe('audited by console');
    expect(result.auditResult?.projectionContract.focusSymbols).toContain('runOpenClaudeCodeTask');
    expect(result.report).toBeNull();
    expect(result.childRunId).toMatch(/^coder_/);
    expect(result.correlationId).toMatch(/^trace_/);
    expect(result.transcriptArtifact).toMatch(/coder-workspace\/runs\/.*\/transcript\.txt$/);
    expect(result.terminalState).toBe('completed');
    expect(result.processExitCode).toBe(0);
    expect(result.structuredEventCount).toBe(2);
    expect(result.commandEvidence?.commandPath).toBe('C:/openclaude/openclaude.exe');
    expect(result.stdout).toContain('audited by console');
    expect(result.stderr).toBeNull();
    expect(result.resultValidationStatus).toBe('valid');
    expect(result.artifactRefs).toContain(result.transcriptArtifact);
    // Read-only audit argv: plan mode + scoped allowlist (codegraph doorway + reads
    // only, no shell) + strict scoped MCP config.
    const args = capture.req?.args ?? [];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__codebase-memory__search_graph');
    expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('mcp__codebase-memory,');
    expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('Bash');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Edit');
    expect(args).toContain('--strict-mcp-config');
  });

  it('mag_one_execution returns the validated CoderReport, auditResult null', async () => {
    const session = new FakeSession(validReportJson('executed'));
    const p = task('mag_one_execution');
    const onSessionStarted = vi.fn();
    const promise = runOpenClaudeCodeTask(p, {
      manager: managerFor({ ok: true, session }),
      onSessionStarted,
    });
    expect(onSessionStarted).toHaveBeenCalledWith(expect.objectContaining({
      childRunId: expect.stringMatching(/^coder_/),
      parentRunId: 'parent_1',
      sessionId: 'occ_fake_1',
      sessionState: 'running',
      executionTimeoutMs: 300_000,
    }));
    session.exitWith(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.resultKind).toBe('coder_report');
    expect(result.report?.summary).toBe('executed');
    expect(result.auditResult).toBeNull();
  });

  it('propagates a non-zero exit as a failed run with no fabricated result', async () => {
    const session = new FakeSession(''); // no valid JSON on stdout
    const promise = runOpenClaudeCodeTask(task('mag_one_execution'), { manager: managerFor({ ok: true, session }) });
    session.exitWith(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.report).toBeNull();
    expect(result.terminalState).toBe('failed');
    expect(result.processExitCode).toBe(1);
    expect(result.resultValidationStatus).toBe('missing');
    expect(result.error).toBe('console_coder_process_failed');
  });

  it('propagates a session start failure (runtime unavailable) fail-closed', async () => {
    const result = await runOpenClaudeCodeTask(task(), {
      manager: managerFor({ ok: false, error: 'console_runtime_unavailable' }),
    });
    expect(result.ok).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.error).toBe('console_runtime_unavailable');
  });

  it('fails honestly (blocked) when no model is resolved — never spawns a doomed run', async () => {
    let started = false;
    const manager = { start: () => { started = true; return { ok: true, session: new FakeSession(validReportJson()) }; } } as unknown as ConsoleCoderDeps['manager'];
    const taskWithoutModel = { ...task(), model: '' };
    const result = await runOpenClaudeCodeTask(taskWithoutModel, { manager });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('console_coder_model_unresolved');
    expect(started).toBe(false);
  });

  it('cancels the existing visible session, retains transcript, and reports cancellation distinctly', async () => {
    const session = new FakeSession('partial output');
    const controller = new AbortController();
    const promise = runOpenClaudeCodeTask(task('mag_one_execution'), {
      manager: managerFor({ ok: true, session }),
      signal: controller.signal,
    });
    controller.abort();
    const result = await promise;
    expect(session.stopCalls).toBe(1);
    expect(result.terminalState).toBe('cancelled');
    expect(result.stopReason).toBe('console_coder_cancelled');
    expect(result.transcriptArtifact).toMatch(/transcript\.txt$/);
    expect(result.resultValidationStatus).toBe('malformed');
  });

  it('times out once, stops the existing visible session, and reports timed_out distinctly', async () => {
    const session = new FakeSession('still running');
    const result = await runOpenClaudeCodeTask(task('mag_one_execution'), {
      manager: managerFor({ ok: true, session }),
      timeoutMs: 5,
    });
    expect(session.stopCalls).toBe(1);
    expect(result.terminalState).toBe('timed_out');
    expect(result.stopReason).toBe('console_coder_timed_out');
    expect(result.executionTimeoutMs).toBe(5);
    expect(result.transcriptArtifact).toMatch(/transcript\.txt$/);
  });

  it.each([
    ['', 'missing', 'console_coder_result_missing'],
    ['not json', 'malformed', 'console_coder_result_malformed'],
  ])('distinguishes %s structured output after a clean process exit', async (raw, validation, error) => {
    const session = new FakeSession(raw);
    const promise = runOpenClaudeCodeTask(task('mag_one_execution'), {
      manager: managerFor({ ok: true, session }),
    });
    session.exitWith(0);
    const result = await promise;
    expect(result.terminalState).toBe('failed');
    expect(result.resultValidationStatus).toBe(validation);
    expect(result.error).toBe(error);
  });
  it('fails closed for incomplete saved-card identity before starting a terminal', async () => {
    const manager = managerFor({ ok: true, session: new FakeSession(validReportJson()) });
    await expect(runOpenClaudeCodeTask({ ...task(), parentRunId: '' }, { manager }))
      .rejects.toThrow('openclaude_code_identity_incomplete');
  });
});
