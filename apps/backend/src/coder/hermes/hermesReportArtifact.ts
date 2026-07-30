import { requestPythonRailsJson } from '../../services/autogen/autogenOrchestratorClient';

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
