import { z } from 'zod';

import { fetchGraphObjectContext } from '../../../services/autogen/autogenOrchestratorClient';

const authoritySchema = z.enum(['thinkgraph', 'knowgraph', 'codegraph']);

export const graphObjectRefSchema = z.object({
  authority: authoritySchema,
  canonicalId: z.string().trim().min(1).max(512),
  selectedThrough: z.enum(['thinkgraph', 'knowgraph', 'codegraph', 'unified']),
  sourceAuthority: authoritySchema.optional(),
  projectionId: z.string().trim().min(1).max(256).optional(),
  graphViewId: z.string().trim().min(1).max(256).optional(),
  displayLabel: z.string().trim().min(1).max(240),
}).strict().superRefine((reference, context) => {
  if (reference.selectedThrough === 'unified' && reference.sourceAuthority !== reference.authority) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceAuthority'], message: 'unified_source_authority_required' });
  }
  if (reference.selectedThrough !== 'unified' && reference.sourceAuthority && reference.sourceAuthority !== reference.authority) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceAuthority'], message: 'source_authority_mismatch' });
  }
});

export type GraphObjectRef = z.infer<typeof graphObjectRefSchema>;

export function parseGraphObjectRefs(value: unknown): GraphObjectRef[] {
  if (value === undefined || value === null) return [];
  const references = z.array(graphObjectRefSchema).max(5).parse(value);
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.authority}:${reference.canonicalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resolveSelectedGraphObjectContext(args: {
  projectId: string;
  conversationId: string;
  references: GraphObjectRef[];
}): Promise<{ modelContext: string; resolved: unknown[]; measurements: unknown } | null> {
  if (args.references.length === 0) return null;
  const response = await fetchGraphObjectContext({
    projectId: args.projectId,
    conversationId: args.conversationId,
    references: args.references.map(({ displayLabel: _displayLabel, ...identity }) => identity),
  }) as { modelContext?: unknown; resolved?: unknown; measurements?: unknown };
  return {
    modelContext: String(response.modelContext || ''),
    resolved: Array.isArray(response.resolved) ? response.resolved : [],
    measurements: response.measurements ?? null,
  };
}
