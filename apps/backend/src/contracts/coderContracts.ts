import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);
const textList = z.array(nonEmptyText);

export const coderWriteModeSchema = z.enum(['read-only', 'edit']);

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
  // Trusted runtime model selection injected by the configured-card path.
  // The model-facing run_local_coder tool does not expose these controls.
  modelProvider: z.enum(['openai', 'openrouter']).optional(),
  providerModelId: nonEmptyText.optional(),
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

export type CoderPacket = z.infer<typeof coderPacketSchema>;
export type CoderReport = z.infer<typeof coderReportSchema>;

// ── direct_main_audit structured result ──────────────────────────────────────
// A read-only audit returns a concise conclusion + a FILTERED CodeGraph view
// (CodeGraphViewContract fields mirrored from client/src/components/codegraph/types.ts)
// + evidence — NOT a CoderReport. The view only references canonical CodeGraph node
// IDs / files / symbols; Coder annotations stay in the audit body, never rewriting facts.
export const codeGraphViewContractSchema = z.object({
  projectId: z.string().nullable().optional(),
  focusPaths: z.array(z.string()).optional(),
  focusSymbols: z.array(z.string()).optional(),
  nodeLabelAllowlist: z.array(z.string()).optional(),
  edgeTypeAllowlist: z.array(z.string()).optional(),
  showLabels: z.boolean().optional(),
  maxNodes: z.number().optional(),
}).strict();

export const coderAuditResultSchema = z.object({
  conclusion: nonEmptyText,
  repositoryRoot: z.string(),
  repositoryIdentity: z.string(),
  revision: z.string(),
  freshness: z.string(),
  codeGraphQuery: z.string(),
  codeGraphNodeRefs: z.array(z.string()),
  files: z.array(z.string()),
  symbols: z.array(z.string()),
  findings: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  risks: z.array(z.string()),
  implementationBoundaries: z.array(z.string()),
  requiredTests: z.array(z.string()),
  viewContract: codeGraphViewContractSchema,
  artifactRefs: z.array(z.string()),
}).strict();

export type CodeGraphViewContractResult = z.infer<typeof codeGraphViewContractSchema>;
export type CoderAuditResult = z.infer<typeof coderAuditResultSchema>;

export const coderAuditResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'conclusion', 'repositoryRoot', 'repositoryIdentity', 'revision', 'freshness',
    'codeGraphQuery', 'codeGraphNodeRefs', 'files', 'symbols', 'findings',
    'unresolvedQuestions', 'risks', 'implementationBoundaries', 'requiredTests',
    'viewContract', 'artifactRefs',
  ],
  properties: {
    conclusion: { type: 'string', minLength: 1 },
    repositoryRoot: { type: 'string' },
    repositoryIdentity: { type: 'string' },
    revision: { type: 'string' },
    freshness: { type: 'string' },
    codeGraphQuery: { type: 'string' },
    codeGraphNodeRefs: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    symbols: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'string' } },
    unresolvedQuestions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    implementationBoundaries: { type: 'array', items: { type: 'string' } },
    requiredTests: { type: 'array', items: { type: 'string' } },
    viewContract: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: ['string', 'null'] },
        focusPaths: { type: 'array', items: { type: 'string' } },
        focusSymbols: { type: 'array', items: { type: 'string' } },
        nodeLabelAllowlist: { type: 'array', items: { type: 'string' } },
        edgeTypeAllowlist: { type: 'array', items: { type: 'string' } },
        showLabels: { type: 'boolean' },
        maxNodes: { type: 'number' },
      },
    },
    artifactRefs: { type: 'array', items: { type: 'string' } },
  },
} as const;

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
}).strict();

export type CodingRunStatus = z.infer<typeof codingRunStatusSchema>;
export type CodingRunLifecycle = z.infer<typeof codingRunLifecycleSchema>;

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
