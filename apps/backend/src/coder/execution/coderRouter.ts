import { resolveRepoRoot } from '../workspaceRoot';
import { submitCoderReport, type CoderReportVerification } from '../../services/coderReportEvidence';
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

// The registry IS the routing: explicit id → adapter, nothing inferred,
// no fallback between stacks. New coder CLIs register here.
const ADAPTERS: Record<CoderAdapterId, CoderExecutionAdapter> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
};

function normalizedReport(run: CoderRunSnapshot): Record<string, unknown> | null {
  return run.report && typeof run.report === 'object' ? run.report : null;
}

export async function runCoderSubagent(
  request: RunCoderSubagentRequest,
  adapterOverride?: CoderExecutionAdapter,
): Promise<RunCoderSubagentResult> {
  if (!(CODER_ADAPTER_IDS as readonly string[]).includes(request.adapter)) throw new Error('coder_router_adapter_unsupported');
  const adapterId = request.adapter as CoderAdapterId;
  const adapter = adapterOverride ?? ADAPTERS[adapterId];
  if (adapter.id !== adapterId) throw new Error('coder_router_adapter_mismatch');
  if (!request.parentRunId || !request.projectId || !request.deckId || !request.conversationId || !request.cardId) throw new Error('coder_router_identity_incomplete');
  if (!adapterOverride) {
    const availability = adapter.availability();
    if (!availability.available) throw new Error(`coder_router_adapter_unavailable: ${availability.error || adapterId}`);
  }
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
  adapter.prepare(packet);
  adapter.start(packet.runId);
  const run = await adapter.wait(packet.runId);
  const report = normalizedReport(run);
  const exactCommand = typeof report?.exactCommand === 'string' ? report.exactCommand : null;
  const stdout = typeof report?.stdout === 'string' ? report.stdout : '';
  const stderr = typeof report?.stderr === 'string' ? report.stderr : '';
  const commandExitStatus = typeof report?.exitStatus === 'number' ? report.exitStatus : null;
  const success = run.status === 'completed' && run.exitCode === 0 && report !== null && commandExitStatus === 0;
  const submitted = submitCoderReport({
    projectId: request.projectId,
    deckId: request.deckId,
    executionMode: 'external_coder',
    adapter: adapterId,
    jobId: packet.runId,
    reportText: JSON.stringify({ ...report, runId: packet.runId, parentRunId: request.parentRunId, promptHash: packet.promptHash }),
    claims: { traceIds: [packet.correlationId], filesChanged: [], tests: [], runtimeBehavior: success ? 'completed' : 'failed' },
  });
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
