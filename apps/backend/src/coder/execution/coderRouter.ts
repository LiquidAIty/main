import { resolveRepoRoot } from '../workspaceRoot';
import { submitCoderReport, type CoderReportVerification } from '../../services/coderReportEvidence';
import { recordAgentEvent } from '../../services/agentTelemetry';
import {
  CODER_ADAPTER_IDS,
  claudeCodeAdapter,
  codexAdapter,
  createApprovedCoderRun,
  type CoderAdapterId,
  type CoderExecutionAdapter,
  type CoderRunSnapshot,
} from './coderExecution';
import type { CoderAuthorityMode } from './coderRuntimeContract';
import { runCoderConsoleSession, type ConsoleCoderDeps } from './coderConsoleRuntime';

export type RunCoderSubagentRequest = {
  parentRunId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  /** Echoed on the result for provenance; it does NOT select the runtime — the
   * canonical Coder runtime is always the visible OpenClaude Console PTY. */
  adapter: string;
  approvedPrompt: string;
  /**
   * Caller-supplied Coder authority (dossier §3.3). Maps onto the OpenClaude
   * permission mode: direct_main_audit → read-only (`plan`), mag_one_execution →
   * `acceptEdits`. Unset defaults to read-only.
   */
  authority?: CoderAuthorityMode;
  /** OpenClaude provider/model for the Console runtime (server-resolved from the card). */
  model?: string;
  provider?: string;
};

export type RunCoderSubagentResult = {
  ok: boolean;
  adapter: CoderAdapterId;
  parentRunId: string;
  childRunId: string;
  correlationId: string;
  promptHash: string;
  sessionId: string;
  processExitCode: number | null;
  structuredEventCount: number;
  exactCommand: string | null;
  stdout: string;
  stderr: string;
  commandExitStatus: number | null;
  report: Record<string, unknown> | null;
  /** Which structured shape `report` holds on the console path: an audit result
   * (direct_main_audit, carries a CodeGraphViewContract) or a CoderReport. */
  resultKind?: 'audit' | 'coder_report';
  /** Relative path to the persisted terminal transcript artifact (console path). */
  transcriptArtifact?: string | null;
  verification: CoderReportVerification | null;
  error: string | null;
};

export type CoderRouterObserver = (stage: string, detail: Record<string, unknown>) => void;

/**
 * CANONICAL Coder runtime: Main's `run_coder_subagent` child runs as the VISIBLE
 * OpenClaude Console PTY session — the exact process the Coder Console renders.
 * There is no headless fallback and no runtime selector: if the Console runtime
 * cannot run, the result is an honest failure (never a hidden second coder).
 *
 * The `exactCommand/stdout/stderr/commandExitStatus` result fields are populated
 * only by the isolated dev-only headless reality-test (`runHeadlessCoderReality`);
 * the canonical console path carries its structured result in `report`.
 */
export async function runCoderSubagent(
  request: RunCoderSubagentRequest,
  observer: CoderRouterObserver = () => undefined,
  consoleDeps?: ConsoleCoderDeps,
): Promise<RunCoderSubagentResult> {
  if (!request.parentRunId || !request.projectId || !request.deckId || !request.conversationId || !request.cardId) {
    throw new Error('coder_router_identity_incomplete');
  }
  // `adapter` is provenance only — the runtime is always the Console PTY.
  const adapterId: CoderAdapterId = (CODER_ADAPTER_IDS as readonly string[]).includes(request.adapter)
    ? (request.adapter as CoderAdapterId)
    : 'claude_code';
  observer('coder_console_runtime', { authority: request.authority ?? null });
  const packet = createApprovedCoderRun({
    parentRunId: request.parentRunId,
    projectId: request.projectId,
    deckId: request.deckId,
    cardId: request.cardId,
    adapter: adapterId,
    invocationMode: 'harness_subagent',
    authority: request.authority,
    repositoryRoot: resolveRepoRoot(),
    allowedPaths: ['.'],
    deniedPaths: ['.git', '.env', 'coder-workspace'],
    rawRequest: request.approvedPrompt,
    approvedPrompt: request.approvedPrompt,
    promptVersion: 1,
    workspaceGranted: true,
    liveRunApproved: true,
    proofRequirements: ['Return a validated CoderReport as the final structured result.'],
  });
  observer('child_run_created', { childRunId: packet.runId, correlationId: packet.correlationId, promptHash: packet.promptHash });
  recordAgentEvent({ stage: 'card_call', status: 'started', mode: 'real_model_call', caller: 'coder_router', projectId: request.projectId, deckId: request.deckId, conversationId: request.conversationId, correlationId: packet.correlationId, cardId: request.cardId, inputSummary: `runtime=console authority=${request.authority ?? 'default'}`, metadata: { lifecycle: 'child_run_created', parentRunId: request.parentRunId, childRunId: packet.runId, runtime: 'console_pty', promptHash: packet.promptHash } });
  const consoleResult = await runCoderConsoleSession(packet, {
    model: request.model,
    provider: request.provider,
    manager: consoleDeps?.manager,
  });
  observer('console_session_completed', { sessionId: consoleResult.sessionId, sessionState: consoleResult.sessionState, ok: consoleResult.ok });
  recordAgentEvent({ stage: 'card_call', status: consoleResult.ok ? 'completed' : 'failed', mode: 'real_model_call', caller: 'coder_router', projectId: request.projectId, deckId: request.deckId, conversationId: request.conversationId, correlationId: packet.correlationId, cardId: request.cardId, outputSummary: `runtime=console session=${consoleResult.sessionId ?? 'none'} report=${consoleResult.report ? 'present' : 'missing'}`, errorSummary: consoleResult.ok ? null : consoleResult.error, metadata: { lifecycle: 'result_returned', parentRunId: request.parentRunId, childRunId: packet.runId, runtime: 'console_pty', sessionId: consoleResult.sessionId } });
  return {
    ok: consoleResult.ok,
    adapter: adapterId,
    parentRunId: request.parentRunId,
    childRunId: consoleResult.childRunId,
    correlationId: consoleResult.correlationId,
    promptHash: consoleResult.promptHash,
    sessionId: consoleResult.sessionId ?? '',
    processExitCode: null,
    structuredEventCount: 0,
    exactCommand: null,
    stdout: '',
    stderr: '',
    commandExitStatus: null,
    report: (consoleResult.auditResult ?? consoleResult.report) as Record<string, unknown> | null,
    resultKind: consoleResult.resultKind,
    transcriptArtifact: consoleResult.transcriptArtifact,
    verification: null,
    error: consoleResult.error,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ONLY EXTERNAL CODING-AGENT INSPECTION SOCKET (isolated adapter registry).
//
// These BYOC `claude`/`codex` adapters + `runHeadlessCoderReality` exist ONLY so
// an outside coding agent (Claude/Codex/etc.) can deliberately plug into the
// running stack — through admin/dev access, gated by isDevTestModeEnabled (403 in
// production) via `agentRuntimeReality.ts` — to exercise real agent endpoints,
// inspect pipeline flow from inside, and return diagnostic evidence.
//
// It is explicitly NOT: the Harness, the product Coder runtime, a Main subagent,
// a Mag One worker, a Coder fallback, or a user-facing feature. The canonical
// Main → Coder path (`runCoderSubagent`) NEVER reaches this — it is the visible
// OpenClaude Console PTY only. Preserve this socket; do not migrate it into the
// PTY runtime and do not remove it as "duplicate Coder code".
// ─────────────────────────────────────────────────────────────────────────────

// The registry IS the routing: explicit id → adapter, nothing inferred, no
// fallback between stacks.
const ADAPTERS: Record<CoderAdapterId, CoderExecutionAdapter> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
};

export function describeCoderAdapters() {
  return CODER_ADAPTER_IDS.map((id) => ({ id, ...ADAPTERS[id].availability() }));
}

export function inspectCoderRun(adapter: CoderAdapterId, runId: string): CoderRunSnapshot | null { return ADAPTERS[adapter].inspect(runId); }
export function cancelCoderRun(adapter: CoderAdapterId, runId: string): CoderRunSnapshot { return ADAPTERS[adapter].cancel(runId); }

function normalizedReport(run: CoderRunSnapshot): Record<string, unknown> | null {
  return run.report && typeof run.report === 'object' ? run.report : null;
}

/**
 * ADMIN-ONLY inspection-socket execution: runs one BYOC `claude`/`codex` adapter
 * so an external coding agent can probe the live stack (see the banner above).
 * Kept isolated from `runCoderSubagent` on purpose — it is not a product Coder
 * runtime and not a fallback. Only `agentRuntimeReality.ts` calls this.
 */
export async function runHeadlessCoderReality(
  request: RunCoderSubagentRequest,
  adapterOverride?: CoderExecutionAdapter,
  observer: CoderRouterObserver = () => undefined,
): Promise<RunCoderSubagentResult> {
  if (!(CODER_ADAPTER_IDS as readonly string[]).includes(request.adapter)) throw new Error('coder_router_adapter_unsupported');
  const adapterId = request.adapter as CoderAdapterId;
  const adapter = adapterOverride ?? ADAPTERS[adapterId];
  if (adapter.id !== adapterId) throw new Error('coder_router_adapter_mismatch');
  if (!request.parentRunId || !request.projectId || !request.deckId || !request.conversationId || !request.cardId) throw new Error('coder_router_identity_incomplete');
  const availability = adapter.availability();
  observer('adapter_availability_checked', availability);
  if (!availability.available) throw new Error(`coder_router_adapter_unavailable: ${availability.error || adapterId}`);
  observer('adapter_selected', { adapter: adapterId });
  const packet = createApprovedCoderRun({
    parentRunId: request.parentRunId,
    projectId: request.projectId,
    deckId: request.deckId,
    cardId: request.cardId,
    adapter: adapterId,
    invocationMode: 'harness_subagent',
    authority: request.authority,
    repositoryRoot: resolveRepoRoot(),
    allowedPaths: ['.'],
    deniedPaths: ['.git', '.env', 'coder-workspace'],
    rawRequest: request.approvedPrompt,
    approvedPrompt: request.approvedPrompt,
    promptVersion: 1,
    workspaceGranted: true,
    liveRunApproved: true,
    proofRequirements: ['Return the exact command, stdout, stderr, and exit status.'],
  });
  observer('child_run_created', { childRunId: packet.runId, correlationId: packet.correlationId, promptHash: packet.promptHash });
  recordAgentEvent({ stage: 'card_call', status: 'started', mode: 'real_model_call', caller: 'coder_reality_test', projectId: request.projectId, deckId: request.deckId, conversationId: request.conversationId, correlationId: packet.correlationId, cardId: request.cardId, inputSummary: `adapter=${adapterId}`, metadata: { lifecycle: 'child_run_created', parentRunId: request.parentRunId, childRunId: packet.runId, adapter: adapterId, promptHash: packet.promptHash } });
  adapter.prepare(packet);
  const started = adapter.start(packet.runId);
  observer('process_started', { processId: started.processId, sessionId: started.sessionId });
  const run = await adapter.wait(packet.runId);
  observer('process_completed', { status: run.status, exitCode: run.exitCode, sessionId: run.sessionId, structuredEventCount: run.events.length });
  const report = normalizedReport(run);
  const exactCommand = typeof report?.exactCommand === 'string' ? report.exactCommand : null;
  const stdout = typeof report?.stdout === 'string' ? report.stdout : '';
  const stderr = typeof report?.stderr === 'string' ? report.stderr : '';
  const commandExitStatus = typeof report?.exitStatus === 'number' ? report.exitStatus : null;
  const filesChanged = Array.isArray(report?.filesChanged) ? report.filesChanged.map(String) : [];
  const success = run.status === 'completed' && run.exitCode === 0 && report !== null && commandExitStatus === 0;
  recordAgentEvent({ stage: 'card_call', status: success ? 'completed' : 'failed', mode: 'real_model_call', caller: 'coder_reality_test', projectId: request.projectId, deckId: request.deckId, conversationId: request.conversationId, correlationId: packet.correlationId, cardId: request.cardId, outputSummary: `adapter=${adapterId} exit=${run.exitCode} report=${report ? 'present' : 'missing'}`, errorSummary: success ? null : run.error || `${adapterId}_run_${run.status}`, metadata: { lifecycle: 'result_returned', parentRunId: request.parentRunId, childRunId: packet.runId, adapter: adapterId, sessionId: run.sessionId, processId: run.processId, promptHash: packet.promptHash, structuredEventCount: run.events.length } });
  const submitted = submitCoderReport({
    projectId: request.projectId,
    deckId: request.deckId,
    executionMode: 'external_coder',
    adapter: adapterId,
    jobId: packet.runId,
    reportText: JSON.stringify({ ...report, runId: packet.runId, parentRunId: request.parentRunId, promptHash: packet.promptHash }),
    claims: { traceIds: [packet.correlationId], filesChanged, tests: exactCommand ? [exactCommand] : [], cardCalls: [request.cardId], runtimeBehavior: success ? 'completed' : 'failed' },
  });
  observer('evidence_verification_completed', { verdict: submitted.ok ? submitted.verification.verdict : 'submission_failed' });
  return {
    ok: success,
    adapter: adapterId,
    parentRunId: request.parentRunId,
    childRunId: packet.runId,
    correlationId: packet.correlationId,
    promptHash: packet.promptHash,
    sessionId: run.sessionId,
    processExitCode: run.exitCode,
    structuredEventCount: run.events.length,
    exactCommand,
    stdout,
    stderr,
    commandExitStatus,
    report,
    verification: submitted.ok ? submitted.verification : null,
    error: success ? null : run.error || `${adapterId}_run_${run.status}`,
  };
}
