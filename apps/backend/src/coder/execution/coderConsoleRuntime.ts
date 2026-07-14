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
 * equivalence proof (a real model run yielding a validated result) is Sol's.
 */
export type ConsoleCoderDeps = {
  /** Injectable for tests; defaults to the process-wide Console manager. */
  manager?: { start(request: StartConsoleSessionRequest): StartConsoleSessionResult };
  /** Resolved from the Coder card (OpenClaude uses OpenRouter/OpenAI). */
  model?: string;
  provider?: string;
};

export type ConsoleCoderResultKind = 'audit' | 'coder_report';

export type ConsoleCoderResult = {
  ok: boolean;
  childRunId: string;
  correlationId: string;
  promptHash: string;
  sessionId: string | null;
  sessionState: string;
  resultKind: ConsoleCoderResultKind;
  auditResult: CoderAuditResult | null;
  report: CoderReport | null;
  transcript: string;
  transcriptArtifact: string | null;
  error: string | null;
};

function resultKindFor(packet: CoderRunPacket): ConsoleCoderResultKind {
  return packet.authority === 'direct_main_audit' ? 'audit' : 'coder_report';
}

function blocked(packet: CoderRunPacket, sessionId: string | null, sessionState: string, error: string): ConsoleCoderResult {
  return {
    ok: false,
    childRunId: packet.runId,
    correlationId: packet.correlationId,
    promptHash: packet.promptHash,
    sessionId,
    sessionState,
    resultKind: resultKindFor(packet),
    auditResult: null,
    report: null,
    transcript: '',
    transcriptArtifact: null,
    error,
  };
}

/** Write the composed MCP config for a run and return its absolute path, or null
 * on failure (the audit then fails honestly rather than running MCP-less). */
function writeRunMcpConfig(childRunId: string, mcpServers: Record<string, unknown>): string | null {
  try {
    const dir = path.join(resolveRepoRoot(), 'coder-workspace', 'runs', childRunId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers }), 'utf8');
    return file;
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

/** Resolve once the session reaches a terminal lifecycle state. */
function awaitSessionExit(session: OpenClaudeConsoleSession): Promise<void> {
  return new Promise((resolve) => {
    if (session.info.state === 'exited' || session.info.state === 'failed') {
      resolve();
      return;
    }
    const unsubscribe = session.subscribe((event) => {
      if (event.kind === 'lifecycle' && (event.info.state === 'exited' || event.info.state === 'failed')) {
        unsubscribe();
        resolve();
      }
    });
  });
}

export async function runCoderConsoleSession(
  packet: CoderRunPacket,
  deps: ConsoleCoderDeps = {},
): Promise<ConsoleCoderResult> {
  const manager = deps.manager ?? openClaudeConsoleSessionManager;
  const model = String(deps.model ?? '').trim();
  if (!model) {
    // Honest, loud failure — the OpenClaude runtime needs a model resolved from
    // the saved Coder card. No hidden fallback to a second coder.
    return blocked(packet, null, 'blocked', 'console_coder_model_unresolved');
  }

  const isAudit = packet.authority === 'direct_main_audit';
  // direct_main_audit: scoped codegraph doorway + native reads only, read-only
  // (plan) mode, all mutation/shell denied. mag_one_execution: implementation
  // authority (acceptEdits), no allowlist, structured CoderReport.
  let mcpFlags: string[] | undefined;
  let auditTools: { allowedTools: string[]; disallowedTools: string[] } | null = null;
  if (isAudit) {
    const servers = buildCoderMcpServers({ runId: packet.runId, includeDevHarness: false, includeCodeGraph: true });
    const mcpConfigPath = writeRunMcpConfig(packet.runId, servers);
    if (!mcpConfigPath) {
      return blocked(packet, null, 'blocked', 'console_coder_mcp_config_write_failed');
    }
    mcpFlags = ['--mcp-config', mcpConfigPath, '--strict-mcp-config'];
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
    return blocked(packet, null, 'failed', started.error);
  }

  const session = started.session;
  await awaitSessionExit(session);

  const transcript = session.transcriptText();
  const transcriptArtifact = persistTranscript(packet.runId, transcript);
  const raw = session.rawResultText();

  const auditResult = isAudit ? parseCoderAuditResult(raw).auditResult : null;
  const report = isAudit ? null : parseOpenClaudeCoderReport(raw).report;
  const structuredOk = isAudit ? auditResult !== null : report !== null;
  const ok = session.info.state === 'exited' && session.info.exitCode === 0 && structuredOk;

  return {
    ok,
    childRunId: packet.runId,
    correlationId: packet.correlationId,
    promptHash: packet.promptHash,
    sessionId: session.info.id,
    sessionState: session.info.state,
    resultKind: isAudit ? 'audit' : 'coder_report',
    auditResult,
    report,
    transcript,
    transcriptArtifact,
    error: ok ? null : session.info.error ?? 'console_coder_no_valid_result',
  };
}
