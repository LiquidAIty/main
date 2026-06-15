import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);
const textList = z.array(nonEmptyText);
const contextRecord = z.record(z.unknown());
export const contextSourceStatusSchema = z.enum([
  'ok',
  'empty',
  'blocked',
  'timed_out',
  'failed',
  'skipped',
]);
export const contextSourceDiagnosticSchema = z.object({
  source: nonEmptyText,
  critical: z.boolean(),
  status: contextSourceStatusSchema,
  elapsedMs: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  summary: z.string(),
  blocker: z.string(),
}).strict();

export const coderContextPacketSchema = z.object({
  userInput: nonEmptyText,
  planFlowState: contextRecord,
  planExcerpt: nonEmptyText,
  thinkGraphContext: contextRecord,
  skillContext: contextRecord,
  codeGraphContext: contextRecord,
  cbmQueries: textList,
  codeAnchors: textList,
  sourceDiagnostics: z.array(contextSourceDiagnosticSchema).min(1),
  knowGraphContext: contextRecord.optional(),
  selectedContext: contextRecord.optional(),
  provenance: z.object({
    assembledAt: nonEmptyText,
    sources: textList,
    warnings: z.array(z.string()),
  }).strict(),
}).strict();

export const coderWriteModeSchema = z.enum(['read-only', 'edit']);

export const availableWorkflowOptionsSchema = z.enum([
  'plan_only',
  'draft_spec_for_approval',
  'run_read_only_coder_task',
  'report_blocker',
  'answer_general',
]);
export type AvailableWorkflowOptions = z.infer<typeof availableWorkflowOptionsSchema>;

export const magOnePlanningContextSchema = z.object({
  planFlowState: contextRecord,
  cbmInsight: contextRecord,
  skillGraphStatus: contextSourceStatusSchema,
  approvalDecision: z.enum(['approved', 'rejected', 'pending']),
  contextPacket: coderContextPacketSchema,
  workflowOptions: z.array(availableWorkflowOptionsSchema),
}).strict();

export type MagOnePlanningContext = z.infer<typeof magOnePlanningContextSchema>;

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
  // Declares whether the coder may edit files. Optional: when absent, the
  // adapter derives a conservative mode from the packet's no-edit language.
  writeMode: coderWriteModeSchema.optional(),
}).strict();

export const coderReportStatusSchema = z.enum([
  'succeeded',
  'partial',
  'blocked',
  'failed',
]);

export const specComparisonItemSchema = z.object({
  requirement: nonEmptyText,
  status: z.enum(['satisfied', 'changed', 'incomplete', 'blocked']),
  evidence: nonEmptyText,
}).strict();

export const proofResultSchema = z.object({
  command: nonEmptyText,
  status: z.enum(['passed', 'failed', 'blocked']),
  output: z.string(),
}).strict();

export const coderReportSchema = z.object({
  coderPacketId: nonEmptyText,
  status: coderReportStatusSchema,
  summary: nonEmptyText,
  specComparison: z.array(specComparisonItemSchema),
  filesChanged: textList,
  proofCommands: textList,
  proofResults: z.array(proofResultSchema),
  failedCommands: textList,
  blockers: textList,
  assumptions: textList,
  outOfScopeFindings: textList,
  nextRecommendedTask: z.string(),
  rawOutput: z.string(),
}).strict();

export type CoderContextPacket = z.infer<typeof coderContextPacketSchema>;
export type ContextSourceDiagnostic = z.infer<typeof contextSourceDiagnosticSchema>;
export type CoderPacket = z.infer<typeof coderPacketSchema>;
export type CoderReport = z.infer<typeof coderReportSchema>;

export const codingRunStatusSchema = z.enum([
  'requested',
  'planned',
  'awaiting_approval',
  'approved',
  'dispatched',
  'running',
  'completed',
  'failed',
  'blocked',
]);

export const codingRunLifecycleSchema = z.object({
  id: nonEmptyText,
  projectId: nonEmptyText,
  targetRoot: nonEmptyText,
  userGoal: nonEmptyText,
  generatedSpec: nonEmptyText,
  editMode: z.enum(['read_only', 'edit']),
  sessionId: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: codingRunStatusSchema,
  resultSummary: z.string(),
  proofCommands: z.array(z.string()),
  proofFiles: z.array(z.string()),
  validatedCoderReport: z.boolean(),
  coderReport: coderReportSchema.nullable(),
  blocker: z.string().nullable(),
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
  completedAt: z.string().nullable(),
  memoryRecordStatus: z.enum(['pending', 'recorded', 'skipped', 'failed']),
  memoryRecordDetail: z.string(),
}).strict();

export type CodingRunStatus = z.infer<typeof codingRunStatusSchema>;
export type CodingRunLifecycle = z.infer<typeof codingRunLifecycleSchema>;

export const coderPacketJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'projectId',
    'repoPath',
    'objective',
    'planExcerpt',
    'contextSummary',
    'codeAnchors',
    'cbmQueries',
    'guardrails',
    'allowedFiles',
    'forbiddenWork',
    'proofRequired',
    'reportFormat',
    'stopConditions',
    'writeMode',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    projectId: { type: 'string', minLength: 1 },
    repoPath: { type: 'string', minLength: 1 },
    objective: { type: 'string', minLength: 1 },
    planExcerpt: { type: 'string', minLength: 1 },
    contextSummary: { type: 'string', minLength: 1 },
    codeAnchors: { type: 'array', items: { type: 'string', minLength: 1 } },
    cbmQueries: { type: 'array', items: { type: 'string', minLength: 1 } },
    guardrails: { type: 'array', items: { type: 'string', minLength: 1 } },
    allowedFiles: { type: 'array', items: { type: 'string', minLength: 1 } },
    forbiddenWork: { type: 'array', items: { type: 'string', minLength: 1 } },
    proofRequired: { type: 'array', items: { type: 'string', minLength: 1 } },
    reportFormat: { type: 'string', minLength: 1 },
    stopConditions: { type: 'array', items: { type: 'string', minLength: 1 } },
    writeMode: { type: 'string', enum: coderWriteModeSchema.options },
  },
} as const;

export const coderReportJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'coderPacketId',
    'status',
    'summary',
    'specComparison',
    'filesChanged',
    'proofCommands',
    'proofResults',
    'failedCommands',
    'blockers',
    'assumptions',
    'outOfScopeFindings',
    'nextRecommendedTask',
    'rawOutput',
  ],
  properties: {
    coderPacketId: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: coderReportStatusSchema.options },
    summary: { type: 'string', minLength: 1 },
    specComparison: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement', 'status', 'evidence'],
        properties: {
          requirement: { type: 'string', minLength: 1 },
          status: {
            type: 'string',
            enum: ['satisfied', 'changed', 'incomplete', 'blocked'],
          },
          evidence: { type: 'string', minLength: 1 },
        },
      },
    },
    filesChanged: { type: 'array', items: { type: 'string', minLength: 1 } },
    proofCommands: { type: 'array', items: { type: 'string', minLength: 1 } },
    proofResults: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'status', 'output'],
        properties: {
          command: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['passed', 'failed', 'blocked'] },
          output: { type: 'string' },
        },
      },
    },
    failedCommands: { type: 'array', items: { type: 'string', minLength: 1 } },
    blockers: { type: 'array', items: { type: 'string', minLength: 1 } },
    assumptions: { type: 'array', items: { type: 'string', minLength: 1 } },
    outOfScopeFindings: { type: 'array', items: { type: 'string', minLength: 1 } },
    nextRecommendedTask: { type: 'string' },
    rawOutput: { type: 'string' },
  },
} as const;

export function parseCoderContextPacket(value: unknown): CoderContextPacket {
  return coderContextPacketSchema.parse(value);
}

export function parseCoderPacket(value: unknown): CoderPacket {
  return coderPacketSchema.parse(value);
}

export function parseCoderReport(value: unknown): CoderReport {
  return coderReportSchema.parse(value);
}

export function parseCodingRunLifecycle(value: unknown): CodingRunLifecycle {
  return codingRunLifecycleSchema.parse(value);
}

export function compareCoderReportToPacket(
  packet: CoderPacket,
  report: CoderReport,
): {
  matchesPacket: boolean;
  comparedRequirements: number;
  unresolvedRequirements: string[];
  completedRequirements: string[];
  incompleteRequirements: string[];
  blockedRequirements: string[];
  changedRequirements: string[];
  outOfScopeFindings: string[];
  nextNarrowerFocus: string;
} {
  const byStatus = (status: 'satisfied' | 'changed' | 'incomplete' | 'blocked') =>
    report.specComparison
      .filter((item) => item.status === status)
      .map((item) => item.requirement);
  const unresolvedRequirements = report.specComparison
    .filter((item) => item.status !== 'satisfied')
    .map((item) => item.requirement);
  const incompleteRequirements = byStatus('incomplete');
  const blockedRequirements = byStatus('blocked');
  const changedRequirements = byStatus('changed');
  return {
    matchesPacket:
      report.coderPacketId === packet.id &&
      report.status === 'succeeded' &&
      unresolvedRequirements.length === 0,
    comparedRequirements: report.specComparison.length,
    unresolvedRequirements,
    completedRequirements: byStatus('satisfied'),
    incompleteRequirements,
    blockedRequirements,
    changedRequirements,
    outOfScopeFindings: report.outOfScopeFindings,
    nextNarrowerFocus:
      report.nextRecommendedTask ||
      [...blockedRequirements, ...incompleteRequirements, ...changedRequirements][0] ||
      '',
  };
}
