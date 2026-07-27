import { requestPythonRailsJson } from '../../services/autogen/autogenOrchestratorClient';

export type HermesInvestigationContext = {
  projectId: string;
  conversationId: string;
  focusNodeIds: string[];
  requestedOutcome: string | null;
  goalId?: string;
  goalText?: string;
  thinkGraphBranch?: string[];
  codeGraphRefs?: string[];
  knowGraphRefs?: string[];
};

export type HermesReportWriteInput = {
  parentRunId: string;
  reportMarkdown: string;
  summary: string;
  thinkGraphNodeIds?: unknown;
  knowGraphRefs?: unknown;
  codeGraphRefs?: unknown;
};

export type HermesReportArtifact = {
  reportId: string;
  assignmentId: string;
  instructionId: string;
  projectId: string;
  conversationId: string;
  parentRunId: string;
  nativeSessionId: string | null;
  status: 'completed';
  summary: string | null;
  reportMarkdown: string;
  contextReferences: Array<{
    referenceId: string;
    referenceType: string;
    required: boolean;
  }>;
  artifacts: Array<Record<string, unknown>>;
};

const HERMES_CARD_ID = 'card_hermes_steward';
const PARENT_RUN_ID = /^req_[a-z0-9-]+$/i;

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field}_string_required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field}_required`);
  if (normalized.length > maxLength) throw new Error(`${field}_too_long`);
  return normalized;
}

function refs(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field}_array_required`);
  if (value.length > 128) throw new Error(`${field}_too_many`);
  return [...new Set(value.map((entry) => requiredText(entry, field, 512)))];
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
}

/** Server-minted project identity is always present for the native doorway.
 * Optional focus values remain native Hermes working-context hints. */
export function parseHermesInvestigationContext(
  value: unknown,
  projectId: string,
  conversationId: string,
): HermesInvestigationContext {
  if (value === undefined) {
    return { projectId, conversationId, focusNodeIds: [], requestedOutcome: null };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('investigation_context_object_required');
  }
  const candidate = value as Record<string, unknown>;
  const context: HermesInvestigationContext = {
    projectId,
    conversationId,
    focusNodeIds: refs(candidate.focusNodeIds, 'investigation_focus_node_ids'),
    requestedOutcome: optionalText(
      candidate.requestedOutcome,
      'investigation_requested_outcome',
      2_000,
    ),
  };
  const goalId = optionalText(candidate.goalId, 'investigation_goal_id', 256);
  if (goalId) context.goalId = goalId;
  const goalText = optionalText(candidate.goalText, 'investigation_goal_text', 2_000);
  if (goalText) context.goalText = goalText;
  const thinkGraphBranch = refs(candidate.thinkGraphBranch, 'investigation_thinkgraph_branch');
  if (thinkGraphBranch.length) context.thinkGraphBranch = thinkGraphBranch;
  const codeGraphRefs = refs(candidate.codeGraphRefs, 'investigation_codegraph_refs');
  if (codeGraphRefs.length) context.codeGraphRefs = codeGraphRefs;
  const knowGraphRefs = refs(candidate.knowGraphRefs, 'investigation_knowgraph_refs');
  if (knowGraphRefs.length) context.knowGraphRefs = knowGraphRefs;
  return context;
}

/** Persist one exact terminal report through Python AgentGraph authority. */
export async function writeHermesReport(
  input: HermesReportWriteInput,
): Promise<Record<string, unknown>> {
  const parentRunId = requiredText(input.parentRunId, 'parentRunId', 128);
  if (!PARENT_RUN_ID.test(parentRunId)) throw new Error('hermes_report_parent_run_id_invalid');
  const response = await requestPythonRailsJson('/agentgraph/hermes/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentRunId,
      receiverCardId: HERMES_CARD_ID,
      reportMarkdown: requiredText(input.reportMarkdown, 'reportMarkdown', 120_000),
      summary: requiredText(input.summary, 'summary', 2_000),
      thinkGraphNodeIds: refs(input.thinkGraphNodeIds, 'thinkGraphNodeIds'),
      knowGraphRefs: refs(input.knowGraphRefs, 'knowGraphRefs'),
      codeGraphRefs: refs(input.codeGraphRefs, 'codeGraphRefs'),
    }),
  });
  return response as Record<string, unknown>;
}

/** Retrieve only the result linked to this exact parent run. */
export async function readHermesReport(
  parentRunId: string,
): Promise<HermesReportArtifact | null> {
  const normalized = requiredText(parentRunId, 'parentRunId', 128);
  if (!PARENT_RUN_ID.test(normalized)) throw new Error('hermes_report_parent_run_id_invalid');
  try {
    const response = (await requestPythonRailsJson(
      `/agentgraph/hermes/reports/${encodeURIComponent(normalized)}?receiverCardId=${encodeURIComponent(HERMES_CARD_ID)}`,
      { method: 'GET' },
    )) as { report?: HermesReportArtifact };
    return response.report ?? null;
  } catch (error) {
    if (String(error).includes('thinkgraph_http_404:hermes_report_not_found')) return null;
    throw error;
  }
}
