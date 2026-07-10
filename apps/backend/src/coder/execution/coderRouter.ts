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

export type RunCoderSubagentRequest = {
  parentRunId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  adapter: string;
  approvedPrompt: string;
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
  verification: CoderReportVerification | null;
  error: string | null;
};

export type CoderRouterObserver = (stage: string, detail: Record<string, unknown>) => void;

// The registry IS the routing: explicit id → adapter, nothing inferred,
// no fallback between stacks. New coder CLIs register here.
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

export async function runCoderSubagent(
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
  recordAgentEvent({ stage: 'card_call', status: 'started', mode: 'real_model_call', caller: 'coder_router', projectId: request.projectId, deckId: request.deckId, conversationId: request.conversationId, correlationId: packet.correlationId, cardId: request.cardId, inputSummary: `adapter=${adapterId}`, metadata: { lifecycle: 'child_run_created', parentRunId: request.parentRunId, childRunId: packet.runId, adapter: adapterId, promptHash: packet.promptHash } });
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
  recordAgentEvent({ stage: 'card_call', status: success ? 'completed' : 'failed', mode: 'real_model_call', caller: 'coder_router', projectId: request.projectId, deckId: request.deckId, conversationId: request.conversationId, correlationId: packet.correlationId, cardId: request.cardId, outputSummary: `adapter=${adapterId} exit=${run.exitCode} report=${report ? 'present' : 'missing'}`, errorSummary: success ? null : run.error || `${adapterId}_run_${run.status}`, metadata: { lifecycle: 'result_returned', parentRunId: request.parentRunId, childRunId: packet.runId, adapter: adapterId, sessionId: run.sessionId, processId: run.processId, promptHash: packet.promptHash, structuredEventCount: run.events.length } });
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
