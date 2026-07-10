import { resolveRepoRoot } from '../workspaceRoot';
import { submitCoderReport, type CoderReportVerification } from '../../services/coderReportEvidence';
import { claudeCodeAdapter, createApprovedCoderRun, type CoderExecutionAdapter, type CoderRunSnapshot } from './coderExecution';

export type RunCoderSubagentRequest = {
  parentRunId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  adapter: 'claude_code';
  approvedPrompt: string;
};

export type RunCoderSubagentResult = {
  ok: boolean;
  adapter: 'claude_code';
  parentRunId: string;
  childRunId: string;
  correlationId: string;
  promptHash: string;
  claudeSessionId: string;
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

function normalizedReport(run: CoderRunSnapshot): Record<string, unknown> | null {
  return run.report && typeof run.report === 'object' ? run.report : null;
}

export async function runCoderSubagent(
  request: RunCoderSubagentRequest,
  adapter: CoderExecutionAdapter = claudeCodeAdapter,
): Promise<RunCoderSubagentResult> {
  if (request.adapter !== 'claude_code' || adapter.id !== 'claude_code') throw new Error('coder_router_adapter_unsupported');
  if (!request.parentRunId || !request.projectId || !request.deckId || !request.conversationId || !request.cardId) throw new Error('coder_router_identity_incomplete');
  const packet = createApprovedCoderRun({
    parentRunId: request.parentRunId,
    projectId: request.projectId,
    deckId: request.deckId,
    cardId: request.cardId,
    invocationMode: 'harness_subagent',
    repositoryRoot: resolveRepoRoot(),
    allowedPaths: ['.'],
    deniedPaths: ['.git', '.env', 'coder-workspace'],
    rawRequest: request.approvedPrompt,
    approvedPrompt: request.approvedPrompt,
    promptVersion: 1,
    workspaceGranted: true,
    liveRunApproved: true,
    proofRequirements: ['Return the exact command, stdout, stderr, and exit status. Do not modify files.'],
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
    adapter: 'claude_code',
    jobId: packet.runId,
    reportText: JSON.stringify({ ...report, runId: packet.runId, parentRunId: request.parentRunId, promptHash: packet.promptHash }),
    claims: { traceIds: [packet.correlationId], filesChanged: [], tests: [], runtimeBehavior: success ? 'completed' : 'failed' },
  });
  return {
    ok: success,
    adapter: 'claude_code',
    parentRunId: request.parentRunId,
    childRunId: packet.runId,
    correlationId: packet.correlationId,
    promptHash: packet.promptHash,
    claudeSessionId: run.sessionId,
    processExitCode: run.exitCode,
    structuredEventCount: run.events.length,
    exactCommand,
    stdout,
    stderr,
    commandExitStatus,
    report,
    verification: submitted.ok ? submitted.verification : null,
    error: success ? null : run.error || `claude_code_run_${run.status}`,
  };
}
