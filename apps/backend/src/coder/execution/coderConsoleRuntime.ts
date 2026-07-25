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
  buildCoderMcpServers,
  parseOpenClaudeCoderReport,
  parseCoderAuditResult,
  resolveConsolePermissionMode,
  resolveConsoleAuditTools,
} from './coderRuntimeContract';
import { resolveRepoRoot } from '../workspaceRoot';
import type { CoderRunPacket } from './coderExecution';

/**
 * Console PTY subagent bridge (dossier §3, Phase 4/5).
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
 * This is the ONLY `run_coder_subagent` execution path — there is no headless
 * fallback. If the Console runtime cannot run (no model, runtime unavailable,
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
  /** Injectable in focused tests; production uses the bounded environment/default value. */
  timeoutMs?: number;
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

export type ConsoleCoderResult = {
  ok: boolean;
  childRunId: string;
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

function resultKindFor(packet: CoderRunPacket): ConsoleCoderResultKind {
  return packet.authority === 'direct_main_audit' ? 'audit' : 'coder_report';
}

function resolveExecutionTimeoutMs(injected?: number): number {
  const raw = injected ?? Number(process.env.LIQUIDAITY_CODER_CONSOLE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || Number(raw) <= 0) return DEFAULT_CONSOLE_EXECUTION_TIMEOUT_MS;
  return Math.min(MAX_CONSOLE_EXECUTION_TIMEOUT_MS, Math.max(1, Math.trunc(Number(raw))));
}

function blocked(
  packet: CoderRunPacket,
  sessionId: string | null,
  sessionState: string,
  error: string,
  timeoutMs: number,
  terminalState: ConsoleCoderTerminalState = 'failed',
): ConsoleCoderResult {
  return {
    ok: false,
    childRunId: packet.runId,
    correlationId: packet.correlationId,
    promptHash: packet.promptHash,
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
    resultKind: resultKindFor(packet),
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

export async function runCoderConsoleSession(
  packet: CoderRunPacket,
  deps: ConsoleCoderDeps = {},
): Promise<ConsoleCoderResult> {
  const manager = deps.manager ?? openClaudeConsoleSessionManager;
  const timeoutMs = resolveExecutionTimeoutMs(deps.timeoutMs);
  const model = String(deps.model ?? '').trim();
  if (deps.signal?.aborted) {
    return blocked(packet, null, 'cancelled', 'console_coder_cancelled', timeoutMs, 'cancelled');
  }
  if (!model) {
    // Honest, loud failure — the OpenClaude runtime needs a model resolved from
    // the saved Coder card. No hidden fallback to a second coder.
    return blocked(packet, null, 'blocked', 'console_coder_model_unresolved', timeoutMs);
  }

  const isAudit = packet.authority === 'direct_main_audit';
  // direct_main_audit: scoped codegraph doorway + native reads only, read-only
  // (plan) mode, all mutation/shell denied. mag_one_execution: implementation
  // authority (acceptEdits), no allowlist, structured CoderReport.
  let mcpFlags: string[] | undefined;
  let mcpConfigArtifact: string | null = null;
  let auditTools: { allowedTools: string[]; disallowedTools: string[] } | null = null;
  if (isAudit) {
    const servers = buildCoderMcpServers({ runId: packet.runId, includeCodeGraph: true });
    const mcpConfig = writeRunMcpConfig(packet.runId, servers);
    if (!mcpConfig) {
      return blocked(packet, null, 'blocked', 'console_coder_mcp_config_write_failed', timeoutMs);
    }
    mcpConfigArtifact = mcpConfig.artifactRef;
    mcpFlags = ['--mcp-config', mcpConfig.absolutePath, '--strict-mcp-config'];
    auditTools = resolveConsoleAuditTools();
  }
  const args = buildOpenClaudeSubagentArgs({
    prompt: packet.approvedPrompt,
    model,
    permissionMode: resolveConsolePermissionMode(packet.authority),
    jsonSchema: isAudit ? coderAuditResultJsonSchema : coderReportJsonSchema,
    mcpFlags,
    allowedTools: auditTools?.allowedTools,
    disallowedTools: auditTools?.disallowedTools,
  });

  const started = manager.start({
    targetRoot: packet.repositoryRoot,
    mode: 'task',
    model,
    provider: deps.provider,
    prompt: packet.approvedPrompt,
    args,
  });
  if (!started.ok) {
    return blocked(packet, null, 'failed', started.error, timeoutMs);
  }

  const session = started.session;
  const waitOutcome = await awaitSessionExit(session, deps.signal, timeoutMs);

  const transcript = session.transcriptText();
  const transcriptArtifact = persistTranscript(packet.runId, transcript);
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
    childRunId: packet.runId,
    correlationId: packet.correlationId,
    promptHash: packet.promptHash,
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
    resultKind: isAudit ? 'audit' : 'coder_report',
    auditResult,
    report,
    transcript,
    transcriptArtifact,
    artifactRefs,
    error,
  };
}
