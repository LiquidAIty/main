import { resolveRepoRoot } from '../workspaceRoot';
import {
  createApprovedCoderRun,
  type CoderAdapterId,
} from './coderExecution';
import type { CoderAuthorityMode } from './coderRuntimeContract';
import {
  runCoderConsoleSession,
  type ConsoleCoderDeps,
  type ConsoleCoderTerminalState,
  type ConsoleCommandEvidence,
  type StructuredResultValidationStatus,
} from './coderConsoleRuntime';

export const DIRECT_VISIBLE_CODER_ADAPTER = 'claude_code' as const;

export type RunCoderSubagentRequest = {
  parentRunId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  adapter: string;
  approvedPrompt: string;
  authority?: CoderAuthorityMode;
  model?: string;
  provider?: string;
  signal?: AbortSignal;
};

export type RunCoderSubagentResult = {
  ok: boolean;
  adapter: CoderAdapterId;
  parentRunId: string;
  childRunId: string;
  correlationId: string;
  promptHash: string;
  sessionId: string;
  terminalState: ConsoleCoderTerminalState;
  processExitCode: number | null;
  stopReason: string | null;
  executionTimeoutMs: number;
  structuredEventCount: number;
  commandEvidence: ConsoleCommandEvidence | null;
  exactCommand: string | null;
  stdout: string | null;
  stderr: string | null;
  commandExitStatus: number | null;
  resultValidationStatus: StructuredResultValidationStatus;
  report: Record<string, unknown> | null;
  resultKind?: 'audit' | 'coder_report';
  transcriptArtifact?: string | null;
  artifactRefs: string[];
  verification: null;
  error: string | null;
};

export type CoderRouterObserver = (stage: string, detail: Record<string, unknown>) => void;

/**
 * Canonical Coder runtime. Main's child run is the visible OpenClaude Console
 * PTY session; there is no headless inspection socket or hidden fallback.
 */
export async function runCoderSubagent(
  request: RunCoderSubagentRequest,
  observer: CoderRouterObserver = () => undefined,
  consoleDeps?: ConsoleCoderDeps,
): Promise<RunCoderSubagentResult> {
  if (!request.parentRunId || !request.projectId || !request.deckId || !request.conversationId || !request.cardId) {
    throw new Error('coder_router_identity_incomplete');
  }
  if (request.adapter !== DIRECT_VISIBLE_CODER_ADAPTER) {
    throw new Error(`coder_adapter_unsupported: ${request.adapter || 'missing'}`);
  }
  const adapterId: CoderAdapterId = DIRECT_VISIBLE_CODER_ADAPTER;
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
  observer('child_run_created', {
    childRunId: packet.runId,
    correlationId: packet.correlationId,
    promptHash: packet.promptHash,
  });
  const consoleResult = await runCoderConsoleSession(packet, {
    model: request.model,
    provider: request.provider,
    manager: consoleDeps?.manager,
    signal: request.signal ?? consoleDeps?.signal,
    timeoutMs: consoleDeps?.timeoutMs,
  });
  observer('console_session_completed', {
    sessionId: consoleResult.sessionId,
    sessionState: consoleResult.sessionState,
    ok: consoleResult.ok,
  });
  return {
    ok: consoleResult.ok,
    adapter: adapterId,
    parentRunId: request.parentRunId,
    childRunId: consoleResult.childRunId,
    correlationId: consoleResult.correlationId,
    promptHash: consoleResult.promptHash,
    sessionId: consoleResult.sessionId ?? '',
    terminalState: consoleResult.terminalState,
    processExitCode: consoleResult.processExitCode,
    stopReason: consoleResult.stopReason,
    executionTimeoutMs: consoleResult.executionTimeoutMs,
    structuredEventCount: consoleResult.structuredEventCount,
    commandEvidence: consoleResult.commandEvidence,
    exactCommand: null,
    stdout: consoleResult.stdout,
    stderr: consoleResult.stderr,
    commandExitStatus: consoleResult.processExitCode,
    resultValidationStatus: consoleResult.resultValidationStatus,
    report: (consoleResult.auditResult ?? consoleResult.report) as Record<string, unknown> | null,
    resultKind: consoleResult.resultKind,
    transcriptArtifact: consoleResult.transcriptArtifact,
    artifactRefs: consoleResult.artifactRefs,
    verification: null,
    error: consoleResult.error,
  };
}
