export type GraphAuthority = 'thinkgraph' | 'knowgraph' | 'codegraph';
export type GraphViewStatus = 'candidate' | 'attached' | 'active' | 'consumed' | 'returned' | 'superseded' | 'failed';

export type GraphViewRecord = {
  canonicalId: string;
  summary: string;
  selectionReason: string;
  relevance?: number;
  rank?: number;
  provenanceRefs: string[];
  estimatedCharacters: number;
  estimatedTokens: number;
};

export type GraphViewRelationship = {
  id: string;
  source: string;
  target: string;
  type: string;
};

export type GraphView = {
  schemaVersion: 'graph-view.v1';
  viewId: string;
  authority: GraphAuthority;
  status: GraphViewStatus;
  projectId: string;
  conversationId: string;
  goalId?: string;
  episodeId?: string;
  jobId?: string;
  runId?: string;
  invocationId?: string;
  producingRole: string;
  receivingRole: string;
  rootCanonicalNodeIds: string[];
  includedCanonicalNodeIds: string[];
  records: GraphViewRecord[];
  includedRelationships: GraphViewRelationship[];
  query: string;
  filter: { nodeTypes: string[]; trustStates: string[] };
  hopDepth: number;
  provenanceRefs: string[];
  note?: string;
  parentViewId?: string;
  omittedNeighborCount: number;
  createdAt: string;
  updatedAt: string;
  runtime?: {
    provider: string;
    model: string;
    role: string;
    invocationId: string;
    attachedAt: string;
    includedRecords: number;
    excludedRecords: number;
    contextCharacters: number;
    estimatedTokens: number;
  };
};

const AUTHORITIES = new Set<GraphAuthority>(['thinkgraph', 'knowgraph', 'codegraph']);
const STATUSES = new Set<GraphViewStatus>(['candidate', 'attached', 'active', 'consumed', 'returned', 'superseded', 'failed']);
const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const optionalText = (value: unknown, max: number): string | undefined => text(value, max) || undefined;
const stringList = (value: unknown, maxItems: number, maxLength: number): string[] => Array.isArray(value)
  ? [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(0, maxItems)
  : [];

export function parseGraphViews(
  value: unknown,
  trusted: { projectId: string; conversationId: string },
  forceStatus?: GraphViewStatus,
): GraphView[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('graph_views_must_be_an_array');
  return value.slice(0, 6).map((raw, viewIndex) => {
    if (!raw || typeof raw !== 'object') throw new Error(`graph_view_${viewIndex}_invalid`);
    const input = raw as Record<string, unknown>;
    const authority = text(input.authority, 32) as GraphAuthority;
    if (!AUTHORITIES.has(authority)) throw new Error(`graph_view_${viewIndex}_authority_invalid`);
    const records = (Array.isArray(input.records) ? input.records.slice(0, 80) : []).map((rawRecord, recordIndex): GraphViewRecord => {
      if (!rawRecord || typeof rawRecord !== 'object') throw new Error(`graph_view_${viewIndex}_record_${recordIndex}_invalid`);
      const record = rawRecord as Record<string, unknown>;
      const canonicalId = text(record.canonicalId, 320);
      const summary = text(record.summary, 480);
      const selectionReason = text(record.selectionReason, 240);
      if (!canonicalId || !summary || !selectionReason) throw new Error(`graph_view_${viewIndex}_record_${recordIndex}_incomplete`);
      return {
        canonicalId,
        summary,
        selectionReason,
        ...(Number.isFinite(record.relevance) ? { relevance: Number(record.relevance) } : {}),
        ...(Number.isFinite(record.rank) ? { rank: Math.max(1, Math.trunc(Number(record.rank))) } : {}),
        provenanceRefs: stringList(record.provenanceRefs, 12, 320),
        estimatedCharacters: summary.length,
        estimatedTokens: Math.max(1, Math.ceil(summary.length / 4)),
      };
    });
    const includedCanonicalNodeIds = stringList(input.includedCanonicalNodeIds, 80, 320);
    if (records.some((record) => !includedCanonicalNodeIds.includes(record.canonicalId))) throw new Error(`graph_view_${viewIndex}_record_not_included`);
    const includedRelationships = (Array.isArray(input.includedRelationships) ? input.includedRelationships.slice(0, 160) : []).flatMap((rawRelationship) => {
      if (!rawRelationship || typeof rawRelationship !== 'object') return [];
      const relation = rawRelationship as Record<string, unknown>;
      const source = text(relation.source, 320);
      const target = text(relation.target, 320);
      const type = text(relation.type, 120);
      if (!source || !target || !type || !includedCanonicalNodeIds.includes(source) || !includedCanonicalNodeIds.includes(target)) return [];
      return [{ id: text(relation.id, 320) || `${source}:${type}:${target}`, source, target, type }];
    });
    const filterInput = input.filter && typeof input.filter === 'object' ? input.filter as Record<string, unknown> : {};
    const proposedStatus = text(input.status, 32) as GraphViewStatus;
    const status = forceStatus || (STATUSES.has(proposedStatus) ? proposedStatus : 'candidate');
    const now = new Date().toISOString();
    return {
      schemaVersion: 'graph-view.v1',
      viewId: text(input.viewId, 200) || `${authority}:${status}:${viewIndex + 1}`,
      authority,
      status,
      projectId: trusted.projectId,
      conversationId: trusted.conversationId,
      ...(optionalText(input.goalId, 160) ? { goalId: optionalText(input.goalId, 160) } : {}),
      ...(optionalText(input.episodeId, 160) ? { episodeId: optionalText(input.episodeId, 160) } : {}),
      ...(optionalText(input.jobId, 160) ? { jobId: optionalText(input.jobId, 160) } : {}),
      ...(optionalText(input.runId, 160) ? { runId: optionalText(input.runId, 160) } : {}),
      ...(optionalText(input.invocationId, 160) ? { invocationId: optionalText(input.invocationId, 160) } : {}),
      producingRole: text(input.producingRole, 100) || 'main_chat',
      receivingRole: text(input.receivingRole, 100) || 'main_chat',
      rootCanonicalNodeIds: stringList(input.rootCanonicalNodeIds, 20, 320),
      includedCanonicalNodeIds,
      records,
      includedRelationships,
      query: text(input.query, 600),
      filter: {
        nodeTypes: stringList(filterInput.nodeTypes, 30, 120),
        trustStates: stringList(filterInput.trustStates, 20, 120),
      },
      hopDepth: Math.min(6, Math.max(0, Math.trunc(Number(input.hopDepth) || 0))),
      provenanceRefs: stringList(input.provenanceRefs, 40, 320),
      ...(optionalText(input.note, 600) ? { note: optionalText(input.note, 600) } : {}),
      ...(optionalText(input.parentViewId, 200) ? { parentViewId: optionalText(input.parentViewId, 200) } : {}),
      omittedNeighborCount: Math.max(0, Math.trunc(Number(input.omittedNeighborCount) || 0)),
      createdAt: optionalText(input.createdAt, 80) || now,
      updatedAt: now,
    };
  });
}

export const parseCandidateGraphViews = (value: unknown, trusted: { projectId: string; conversationId: string }) =>
  parseGraphViews(value, trusted, 'candidate');

export function attachGraphViewsToRuntime(
  candidates: GraphView[],
  runtime: { provider: string; model: string; role: string; invocationId: string; attachedAt?: string },
  delivered?: {
    /** Characters of the compact server-rendered context the model actually
     * received for these views. The views' own JSON never enters the prompt,
     * so measuring JSON.stringify(view) here would be dishonest. */
    contextCharacters: number;
  },
): GraphView[] {
  const attachedAt = runtime.attachedAt || new Date().toISOString();
  const contextCharacters = Math.max(0, Math.trunc(delivered?.contextCharacters ?? 0));
  return candidates.map((candidate) => ({
    ...candidate,
    status: 'active',
    invocationId: runtime.invocationId,
    updatedAt: attachedAt,
    runtime: {
      provider: runtime.provider,
      model: runtime.model,
      role: runtime.role,
      invocationId: runtime.invocationId,
      attachedAt,
      includedRecords: candidate.records.length,
      excludedRecords: candidate.omittedNeighborCount,
      contextCharacters,
      estimatedTokens: contextCharacters > 0 ? Math.max(1, Math.ceil(contextCharacters / 4)) : 0,
    },
  }));
}

export function completeGraphViews(active: GraphView[], failed = false): GraphView[] {
  const updatedAt = new Date().toISOString();
  return active.map((view) => ({ ...view, status: failed ? 'failed' : 'consumed', updatedAt }));
}
