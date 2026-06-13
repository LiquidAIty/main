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
  nextRecommendedTask: z.string(),
  rawOutput: z.string(),
}).strict();

export type CoderPacket = z.infer<typeof coderPacketSchema>;
export type CoderReport = z.infer<typeof coderReportSchema>;

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

export function compareCoderReportToPacket(
  packet: CoderPacket,
  report: CoderReport,
): {
  matchesPacket: boolean;
  comparedRequirements: number;
  unresolvedRequirements: string[];
} {
  const unresolvedRequirements = report.specComparison
    .filter((item) => item.status !== 'satisfied')
    .map((item) => item.requirement);
  return {
    matchesPacket:
      report.coderPacketId === packet.id &&
      report.status === 'succeeded' &&
      unresolvedRequirements.length === 0,
    comparedRequirements: report.specComparison.length,
    unresolvedRequirements,
  };
}
