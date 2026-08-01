import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  coderReportJsonSchema,
  coderAuditResultJsonSchema,
  type CoderReport,
  type CoderAuditResult,
} from '../../contracts/coderContracts';
import {
  openClaudeConsoleSessionManager,
  type OpenClaudeConsoleSession,
  type ConsoleOutputChunk,
  type StartConsoleSessionRequest,
  type StartConsoleSessionResult,
} from '../openclaude/console/consoleSession';
import {
  buildOpenClaudeSubagentArgs,
  parseOpenClaudeCoderReport,
  parseCoderAuditResult,
  type CoderAuthorityMode,
  type EffectiveCoderToolSnapshot,
} from './coderRuntimeContract';
import { resolveRepoRoot } from '../workspaceRoot';

/**
 * Direct OpenClaude Code PTY invocation.
 *
 * Runs Main's Coder child as the REAL OpenClaude CLI through the existing
 * `OpenClaudeConsoleSessionManager` — the same runtime the Coder Console renders
 * — so the process Main invokes is the process the user sees. It reuses the
 * shared OpenClaude argv builder + report parser (also used by the headless
 * LocalCoder job). The structured final result is parsed from the session's raw
 * stdout by authority mode: `direct_main_audit` → a validated audit result +
 * CodeGraphViewContract; `mag_one_execution` → the existing validated CoderReport.
 * The redacted terminal transcript is preserved as an artifact.
 *
 * This is the direct Main-to-terminal path — there is no headless fallback.
 * If the Console runtime cannot run (no model, runtime unavailable,
 * non-zero exit, or no valid result), the result is an honest failure. The live
 * equivalence proof (a real model run yielding a validated result) is deferred to live validation.
 */
export type ConsoleCoderDeps = {
  /** Injectable for tests; defaults to the process-wide Console manager. */
  manager?: { start(request: StartConsoleSessionRequest): StartConsoleSessionResult };
  /** Resolved from the Coder card (OpenClaude uses OpenRouter/OpenAI). */
  model?: string;
  provider?: string;
  signal?: AbortSignal;
  /** Announces the durable run/session identity immediately after the one
   * visible OpenClaude session starts, before waiting for terminal output. */
  onSessionStarted?: (started: ConsoleCoderStarted) => void;
  /** Injectable in focused tests; production uses the bounded environment/default value. */
  timeoutMs?: number;
};

/** Main's saved Coder invocation. This is an identity/prompt envelope for the
 * one existing OpenClaude Code terminal, not an adapter or runtime selector. */
export type OpenClaudeCodeTask = {
  runId?: string;
  parentRunId: string;
  correlationId?: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  approvedPrompt: string;
  authority?: CoderAuthorityMode;
  model?: string;
  provider?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  toolSnapshot?: EffectiveCoderToolSnapshot;
};

type OpenClaudeCodeRun = {
  runId: string;
  correlationId: string;
  promptHash: string;
  parentRunId: string;
  authority?: CoderAuthorityMode;
  repositoryRoot: string;
  approvedPrompt: string;
};

export type ConsoleCoderResultKind = 'audit' | 'coder_report';
export type ConsoleCoderTerminalState = 'completed' | 'failed' | 'cancelled' | 'timed_out';
export type StructuredResultValidationStatus = 'valid' | 'missing' | 'malformed' | 'not_attempted';

export type ConsoleCommandEvidence = {
  commandPath: string;
  runtimeSource: string;
  transportMode: string;
  provider: string | null;
  model: string | null;
};

export type ConsoleCoderStarted = {
  childRunId: string;
  parentRunId: string;
  correlationId: string;
  promptHash: string;
  sessionId: string;
  sessionState: string;
  executionTimeoutMs: number;
  commandEvidence: ConsoleCommandEvidence;
};

export type ConsoleCoderResult = {
  ok: boolean;
  childRunId: string;
  parentRunId: string;
  correlationId: string;
  promptHash: string;
  sessionId: string | null;
  sessionState: string;
  terminalState: ConsoleCoderTerminalState;
  processExitCode: number | null;
  stopReason: string | null;
  executionTimeoutMs: number;
  structuredEventCount: number;
  commandEvidence: ConsoleCommandEvidence | null;
  stdout: string | null;
  stderr: string | null;
  resultValidationStatus: StructuredResultValidationStatus;
  resultKind: ConsoleCoderResultKind;
  auditResult: CoderAuditResult | null;
  report: CoderReport | null;
  transcript: string;
  transcriptArtifact: string | null;
  artifactRefs: string[];
  error: string | null;
};

const DEFAULT_CONSOLE_EXECUTION_TIMEOUT_MS = 300_000;
const MAX_CONSOLE_EXECUTION_TIMEOUT_MS = 900_000;
const STOP_SETTLE_TIMEOUT_MS = 6_000;

function resultKindFor(run: OpenClaudeCodeRun): ConsoleCoderResultKind {
  return run.authority === 'direct_main_audit' ? 'audit' : 'coder_report';
}

function prepareOpenClaudeCodeRun(task: OpenClaudeCodeTask): OpenClaudeCodeRun {
  if (!task.parentRunId || !task.projectId || !task.deckId || !task.conversationId || !task.cardId) {
    throw new Error('openclaude_code_identity_incomplete');
  }
  const approvedPrompt = String(task.approvedPrompt || '');
  if (!approvedPrompt.trim()) throw new Error('openclaude_code_prompt_empty');
  return {
    runId: task.runId || `coder_${randomUUID()}`,
    correlationId: task.correlationId || `trace_${randomUUID()}`,
    promptHash: createHash('sha256').update(Buffer.from(approvedPrompt, 'utf8')).digest('hex'),
    parentRunId: task.parentRunId,
    authority: task.authority,
    repositoryRoot: resolveRepoRoot(),
    approvedPrompt,
  };
}

function resolveExecutionTimeoutMs(injected?: number): number {
  const raw = injected ?? Number(process.env.LIQUIDAITY_CODER_CONSOLE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || Number(raw) <= 0) return DEFAULT_CONSOLE_EXECUTION_TIMEOUT_MS;
  return Math.min(MAX_CONSOLE_EXECUTION_TIMEOUT_MS, Math.max(1, Math.trunc(Number(raw))));
}

function blocked(
  run: OpenClaudeCodeRun,
  sessionId: string | null,
  sessionState: string,
  error: string,
  timeoutMs: number,
  terminalState: ConsoleCoderTerminalState = 'failed',
): ConsoleCoderResult {
  return {
    ok: false,
    childRunId: run.runId,
    parentRunId: run.parentRunId,
    correlationId: run.correlationId,
    promptHash: run.promptHash,
    sessionId,
    sessionState,
    terminalState,
    processExitCode: null,
    stopReason: terminalState === 'cancelled' || terminalState === 'timed_out' ? error : null,
    executionTimeoutMs: timeoutMs,
    structuredEventCount: 0,
    commandEvidence: null,
    stdout: null,
    stderr: null,
    resultValidationStatus: 'not_attempted',
    resultKind: resultKindFor(run),
    auditResult: null,
    report: null,
    transcript: '',
    transcriptArtifact: null,
    artifactRefs: [],
    error,
  };
}

/** Write the composed MCP config for a run and return its absolute path, or null
 * on failure (the audit then fails honestly rather than running MCP-less). */
function writeRunMcpConfig(
  childRunId: string,
  mcpServers: Record<string, unknown>,
): { absolutePath: string; artifactRef: string } | null {
  try {
    const dir = path.join(resolveRepoRoot(), 'coder-workspace', 'runs', childRunId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers }), 'utf8');
    return {
      absolutePath: file,
      artifactRef: path.relative(resolveRepoRoot(), file).replace(/\\/g, '/'),
    };
  } catch {
    return null;
  }
}

/** Persist the redacted terminal transcript as a run artifact. Best-effort:
 * a write failure never breaks the run — it just yields a null artifact ref. */
function persistTranscript(childRunId: string, transcript: string): string | null {
  try {
    const root = resolveRepoRoot();
    const dir = path.join(root, 'coder-workspace', 'runs', childRunId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'transcript.txt');
    writeFileSync(file, transcript, 'utf8');
    return path.relative(root, file).replace(/\\/g, '/');
  } catch {
    return null;
  }
}

type ConsoleWaitOutcome = 'terminal' | 'cancelled' | 'timed_out';

/** Wait on the existing lifecycle stream. Cancellation/timeout stop the same
 * visible session, then retain its final bounded transcript when it settles. */
function awaitSessionExit(
  session: OpenClaudeConsoleSession,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ConsoleWaitOutcome> {
  return new Promise((resolve) => {
    if (session.info.state === 'exited' || session.info.state === 'failed') {
      resolve('terminal');
      return;
    }
    let settled = false;
    let requested: Exclude<ConsoleWaitOutcome, 'terminal'> | null = null;
    let executionTimer: NodeJS.Timeout | null = null;
    let stopSettleTimer: NodeJS.Timeout | null = null;
    const finish = (outcome: ConsoleWaitOutcome) => {
      if (settled) return;
      settled = true;
      if (executionTimer) clearTimeout(executionTimer);
      if (stopSettleTimer) clearTimeout(stopSettleTimer);
      signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      resolve(outcome);
    };
    const requestStop = (outcome: Exclude<ConsoleWaitOutcome, 'terminal'>) => {
      if (requested || settled) return;
      requested = outcome;
      const stopRequested = session.stop();
      if (!stopRequested) {
        finish(outcome);
        return;
      }
      stopSettleTimer = setTimeout(() => finish(outcome), STOP_SETTLE_TIMEOUT_MS);
    };
    const onAbort = () => requestStop('cancelled');
    const unsubscribe = session.subscribe((event) => {
      if (event.kind === 'lifecycle' && (event.info.state === 'exited' || event.info.state === 'failed')) {
        finish(requested ?? 'terminal');
      }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    executionTimer = setTimeout(() => requestStop('timed_out'), timeoutMs);
  });
}

function observedStream(chunks: ConsoleOutputChunk[], stream: 'stdout' | 'stderr'): string | null {
  const observed = chunks.filter((chunk) => chunk.stream === stream);
  return observed.length > 0 ? observed.map((chunk) => chunk.data).join('') : null;
}

export async function runOpenClaudeCodeTask(
  task: OpenClaudeCodeTask,
  deps: ConsoleCoderDeps = {},
): Promise<ConsoleCoderResult> {
  const run = prepareOpenClaudeCodeRun(task);
  const manager = deps.manager ?? openClaudeConsoleSessionManager;
  const timeoutMs = resolveExecutionTimeoutMs(task.timeoutMs ?? deps.timeoutMs);
  const model = String(task.model ?? deps.model ?? '').trim();
  if (task.signal?.aborted || deps.signal?.aborted) {
    return blocked(run, null, 'cancelled', 'console_coder_cancelled', timeoutMs, 'cancelled');
  }
  if (!model) {
    // Honest, loud failure — the OpenClaude runtime needs a model resolved from
    // the saved Coder card. No hidden fallback to a second coder.
    return blocked(run, null, 'blocked', 'console_coder_model_unresolved', timeoutMs);
  }

  const toolSnapshot = task.toolSnapshot;
  if (!toolSnapshot || toolSnapshot.authority !== run.authority) {
    return blocked(run, null, 'blocked', 'console_coder_tool_snapshot_unresolved', timeoutMs);
  }
  if (toolSnapshot.unresolved.length > 0) {
    return blocked(
      run,
      null,
      'blocked',
      `console_coder_saved_tools_unresolved:${toolSnapshot.unresolved.join(',')}`,
      timeoutMs,
    );
  }

  const isAudit = run.authority === 'direct_main_audit';
  // Both authorities use the exact preflighted snapshot. Strict MCP prevents
  // project/global inheritance; --tools bounds native tools for implementation
  // as well as audit.
  let mcpConfigArtifact: string | null = null;
  const mcpConfig = writeRunMcpConfig(run.runId, toolSnapshot.mcpServers);
  if (!mcpConfig) {
    return blocked(run, null, 'blocked', 'console_coder_mcp_config_write_failed', timeoutMs);
  }
  mcpConfigArtifact = mcpConfig.artifactRef;
  const mcpFlags = ['--mcp-config', mcpConfig.absolutePath, '--strict-mcp-config'];
  const args = buildOpenClaudeSubagentArgs({
    prompt: run.approvedPrompt,
    model,
    permissionMode: toolSnapshot.permissionMode,
    jsonSchema: isAudit ? coderAuditResultJsonSchema : coderReportJsonSchema,
    mcpFlags,
    allowedTools: toolSnapshot.allowedTools,
    disallowedTools: toolSnapshot.disallowedTools,
    nativeTools: toolSnapshot.nativeTools,
  });

  const started = manager.start({
    targetRoot: run.repositoryRoot,
    mode: 'task',
    model,
    provider: task.provider ?? deps.provider,
    prompt: run.approvedPrompt,
    args,
  });
  if (!started.ok) {
    return blocked(run, null, 'failed', started.error, timeoutMs);
  }

  const session = started.session;
  deps.onSessionStarted?.({
    childRunId: run.runId,
    parentRunId: run.parentRunId,
    correlationId: run.correlationId,
    promptHash: run.promptHash,
    sessionId: session.info.id,
    sessionState: session.info.state,
    executionTimeoutMs: timeoutMs,
    commandEvidence: {
      commandPath: session.info.commandPath,
      runtimeSource: session.info.runtimeSource,
      transportMode: session.info.transportMode,
      provider: session.info.provider,
      model: session.info.model,
    },
  });
  const waitOutcome = await awaitSessionExit(session, task.signal ?? deps.signal, timeoutMs);

  const transcript = session.transcriptText();
  const transcriptArtifact = persistTranscript(run.runId, transcript);
  const chunks = session.transcript();
  const raw = session.rawResultText();

  const auditResult = isAudit ? parseCoderAuditResult(raw).auditResult : null;
  const reportParse = isAudit ? null : parseOpenClaudeCoderReport(raw);
  const report = reportParse?.report ?? null;
  const structuredOk = isAudit ? auditResult !== null : report !== null;
  const resultValidationStatus: StructuredResultValidationStatus = structuredOk
    ? 'valid'
    : raw.trim()
      ? 'malformed'
      : 'missing';
  const processOk = session.info.state === 'exited' && session.info.exitCode === 0;
  const terminalState: ConsoleCoderTerminalState = waitOutcome === 'cancelled'
    ? 'cancelled'
    : waitOutcome === 'timed_out'
      ? 'timed_out'
      : processOk && structuredOk
        ? 'completed'
        : 'failed';
  const error = terminalState === 'completed'
    ? null
    : terminalState === 'cancelled'
      ? 'console_coder_cancelled'
      : terminalState === 'timed_out'
        ? 'console_coder_timed_out'
        : !processOk
          ? session.info.error ?? 'console_coder_process_failed'
          : resultValidationStatus === 'missing'
            ? 'console_coder_result_missing'
            : 'console_coder_result_malformed';
  const artifactRefs = [
    ...(mcpConfigArtifact ? [mcpConfigArtifact] : []),
    ...(transcriptArtifact ? [transcriptArtifact] : []),
    ...(auditResult?.artifactRefs ?? []),
  ];

  return {
    ok: terminalState === 'completed',
    childRunId: run.runId,
    parentRunId: run.parentRunId,
    correlationId: run.correlationId,
    promptHash: run.promptHash,
    sessionId: session.info.id,
    sessionState: session.info.state,
    terminalState,
    processExitCode: session.info.exitCode,
    stopReason: waitOutcome === 'terminal' ? null : error,
    executionTimeoutMs: timeoutMs,
    structuredEventCount: session.structuredEventCount(),
    commandEvidence: {
      commandPath: session.info.commandPath,
      runtimeSource: session.info.runtimeSource,
      transportMode: session.info.transportMode,
      provider: session.info.provider,
      model: session.info.model,
    },
    stdout: observedStream(chunks, 'stdout'),
    stderr: observedStream(chunks, 'stderr'),
    resultValidationStatus,
    resultKind: resultKindFor(run),
    auditResult,
    report,
    transcript,
    transcriptArtifact,
    artifactRefs,
    error,
  };
}
