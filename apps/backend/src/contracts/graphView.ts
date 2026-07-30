export type GraphViewStatus =
  | 'candidate'
  | 'attached'
  | 'active'
  | 'consumed'
  | 'returned'
  | 'superseded'
  | 'failed';

export type GraphReferenceType =
  | 'artifact'
  | 'codegraph'
  | 'conversation_message'
  | 'database'
  | 'knowgraph'
  | 'native_session'
  | 'query_execution'
  | 'registered_query'
  | 'thinkgraph'
  | 'worldsignals';

export type GraphViewReference = {
  referenceId: string;
  referenceType: GraphReferenceType;
  required: boolean;
};

/** A bounded AgentGraph view of stable references.
 * Canonical graph records and artifacts never cross TypeScript in this object. */
export type GraphViewIdentity = {
  schemaVersion: 'graph-view.v1';
  viewId: string;
  authority: 'agentgraph';
  status: GraphViewStatus;
  projectId: string;
  conversationId: string;
  correlationId?: string;
  displayLabel: string;
  producingRole: string;
  receivingRole: string;
  references: GraphViewReference[];
  parentViewId?: string;
  note?: string;
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
  runtime?: {
    provider: string;
    model: string;
    role: string;
    invocationId: string;
    attachedAt: string;
    includedReferences: number;
    contextCharacters: number;
    estimatedTokens: number;
  };
};

const STATUSES = new Set<GraphViewStatus>([
  'candidate',
  'attached',
  'active',
  'consumed',
  'returned',
  'superseded',
  'failed',
]);
const REFERENCE_TYPES = new Set<GraphReferenceType>([
  'artifact',
  'codegraph',
  'conversation_message',
  'database',
  'knowgraph',
  'native_session',
  'query_execution',
  'registered_query',
  'thinkgraph',
  'worldsignals',
]);
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const optionalText = (value: unknown, max: number): string | undefined =>
  text(value, max) || undefined;

export function parseGraphViewIdentities(
  value: unknown,
  trusted: { projectId: string; conversationId: string },
): GraphViewIdentity[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('graph_view_identities_must_be_an_array');
  if (value.length > 16) throw new Error('graph_view_identity_limit_exceeded');
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`graph_view_identity_${index}_invalid`);
    const input = raw as Record<string, unknown>;
    const viewId = text(input.viewId, 256);
    const status = text(input.status, 32) as GraphViewStatus;
    const projectId = text(input.projectId, 256);
    const conversationId = text(input.conversationId, 256);
    const producingRole = text(input.producingRole, 128);
    const receivingRole = text(input.receivingRole, 128);
    const displayLabel = text(input.displayLabel, 200);
    if (
      !viewId
      || input.authority !== 'agentgraph'
      || !STATUSES.has(status)
      || !producingRole
      || !receivingRole
      || !displayLabel
    ) {
      throw new Error(`graph_view_identity_${index}_incomplete`);
    }
    if (projectId !== trusted.projectId || conversationId !== trusted.conversationId) {
      throw new Error(`graph_view_scope_mismatch: ${viewId}`);
    }
    const rawReferences = Array.isArray(input.references) ? input.references : [];
    if (rawReferences.length > 128) throw new Error(`graph_view_reference_limit_exceeded: ${viewId}`);
    const seen = new Set<string>();
    const references = rawReferences.map((rawReference, referenceIndex): GraphViewReference => {
      if (!rawReference || typeof rawReference !== 'object') {
        throw new Error(`graph_view_${index}_reference_${referenceIndex}_invalid`);
      }
      const reference = rawReference as Record<string, unknown>;
      const referenceId = text(reference.referenceId, 256);
      const referenceType = text(reference.referenceType, 64) as GraphReferenceType;
      if (!referenceId || !REFERENCE_TYPES.has(referenceType)) {
        throw new Error(`graph_view_${index}_reference_${referenceIndex}_invalid`);
      }
      const identity = `${referenceType}:${referenceId}`;
      if (seen.has(identity)) throw new Error(`graph_view_reference_duplicate: ${identity}`);
      seen.add(identity);
      return { referenceId, referenceType, required: reference.required === true };
    });
    const now = new Date().toISOString();
    return {
      schemaVersion: 'graph-view.v1',
      viewId,
      authority: 'agentgraph',
      status,
      projectId,
      conversationId,
      ...(optionalText(input.correlationId, 256) ? { correlationId: optionalText(input.correlationId, 256) } : {}),
      displayLabel,
      producingRole,
      receivingRole,
      references,
      ...(optionalText(input.parentViewId, 256) ? { parentViewId: optionalText(input.parentViewId, 256) } : {}),
      ...(optionalText(input.note, 2_000) ? { note: optionalText(input.note, 2_000) } : {}),
      referenceCount: references.length,
      createdAt: text(input.createdAt, 80) || now,
      updatedAt: text(input.updatedAt, 80) || now,
    };
  });
}

export function attachGraphViewsToRuntime<T extends GraphViewIdentity>(
  candidates: T[],
  runtime: { provider: string; model: string; role: string; invocationId: string; attachedAt?: string },
  delivered?: { contextCharacters: number },
): Array<T & { status: 'active'; runtime: NonNullable<GraphViewIdentity['runtime']> }> {
  const attachedAt = runtime.attachedAt || new Date().toISOString();
  const contextCharacters = Math.max(0, Math.trunc(delivered?.contextCharacters ?? 0));
  return candidates.map((candidate) => ({
    ...candidate,
    status: 'active',
    correlationId: runtime.invocationId,
    updatedAt: attachedAt,
    runtime: {
      provider: runtime.provider,
      model: runtime.model,
      role: runtime.role,
      invocationId: runtime.invocationId,
      attachedAt,
      includedReferences: candidate.references.length,
      contextCharacters,
      estimatedTokens: contextCharacters > 0 ? Math.max(1, Math.ceil(contextCharacters / 4)) : 0,
    },
  })) as Array<T & { status: 'active'; runtime: NonNullable<GraphViewIdentity['runtime']> }>;
}

export function completeGraphViews<T extends GraphViewIdentity>(active: T[], failed = false): T[] {
  const updatedAt = new Date().toISOString();
  return active.map((view) => ({
    ...view,
    status: failed ? 'failed' : 'consumed',
    updatedAt,
  })) as T[];
}
