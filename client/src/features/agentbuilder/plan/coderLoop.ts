import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);
const textList = z.array(nonEmptyText);
const jsonRecordSchema = z.object({}).passthrough();

export const coderPacketSchema = z.object({
  id: nonEmptyText,
  projectId: nonEmptyText,
  repoPath: nonEmptyText,
  objective: nonEmptyText,
  planExcerpt: nonEmptyText,
  contextSummary: nonEmptyText,
  codeAnchors: textList,
  cbmQueries: textList,
  guardrails: textList,
  allowedFiles: textList,
  forbiddenWork: textList,
  proofRequired: textList,
  reportFormat: nonEmptyText,
  stopConditions: textList,
  writeMode: z.enum(['read-only', 'edit']).optional(),
}).strict();

const coderReportSchema = z.object({
  coderPacketId: nonEmptyText,
  status: z.enum(['succeeded', 'partial', 'blocked', 'failed']),
  summary: nonEmptyText,
  specComparison: z.array(z.object({
    requirement: nonEmptyText,
    status: z.enum(['satisfied', 'changed', 'incomplete', 'blocked']),
    evidence: nonEmptyText,
  }).strict()),
  filesChanged: textList,
  proofCommands: textList,
  proofResults: z.array(z.object({
    command: nonEmptyText,
    status: z.enum(['passed', 'failed', 'blocked']),
    output: z.string(),
  }).strict()),
  failedCommands: textList,
  blockers: textList,
  assumptions: textList,
  outOfScopeFindings: textList,
  nextRecommendedTask: z.string(),
  rawOutput: z.string(),
}).strict();

const coderRunResponseSchema = z.object({
  ok: z.boolean(),
  packet: coderPacketSchema,
  report: coderReportSchema,
  comparison: z.object({
    matchesPacket: z.boolean(),
    comparedRequirements: z.number(),
    unresolvedRequirements: z.array(z.string()),
    completedRequirements: z.array(z.string()),
    incompleteRequirements: z.array(z.string()),
    blockedRequirements: z.array(z.string()),
    changedRequirements: z.array(z.string()),
    outOfScopeFindings: z.array(z.string()),
    nextNarrowerFocus: z.string(),
  }),
  thinkGraphPersistence: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }).optional(),
}).passthrough();

const prepareActiveCoderPacketResponseSchema = z.object({
  ok: z.literal(true),
  contextPacket: jsonRecordSchema,
  packet: coderPacketSchema,
  plannerProvenance: z.object({
    source: z.literal('backend_planning_service'),
    provider: nonEmptyText,
    model: nonEmptyText,
    configSource: nonEmptyText,
    contextSources: textList,
  }).strict(),
}).passthrough();

export type CoderPacket = z.infer<typeof coderPacketSchema>;
export type CoderReport = z.infer<typeof coderReportSchema>;
export type CoderRunResponse = z.infer<typeof coderRunResponseSchema>;
export type PrepareActiveCoderPacketResponse = z.infer<
  typeof prepareActiveCoderPacketResponseSchema
>;

export function parseCoderPacketJson(raw: string): CoderPacket {
  return coderPacketSchema.parse(JSON.parse(raw));
}

export async function prepareActiveCoderPacket(
  input: {
    projectId: string;
    userInput: string;
    repoPath?: string | null;
    planFlowState?: Record<string, unknown>;
    selectedContext?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PrepareActiveCoderPacketResponse> {
  const response = await fetchImpl('/api/coder/planflow/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null);
  const parsed = prepareActiveCoderPacketResponseSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  const error =
    payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `active_coder_packet_prepare_invalid_response_${response.status}`;
  throw new Error(error);
}

export async function runLocalCoderPacket(
  packet: CoderPacket,
  fetchImpl: typeof fetch = fetch,
): Promise<CoderRunResponse> {
  const response = await fetchImpl('/api/coder/localcoder/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coderPacket: packet }),
  });
  const payload = await response.json().catch(() => null);
  const parsed = coderRunResponseSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  const error =
    payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `localcoder_run_invalid_response_${response.status}`;
  throw new Error(error);
}
