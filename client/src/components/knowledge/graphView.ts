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
  includedRelationships: Array<{ id: string; source: string; target: string; type: string }>;
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

export function graphViewEstimate(views: GraphView[]): { records: number; characters: number; tokens: number } {
  return views.reduce((total, view) => ({
    records: total.records + view.records.length,
    characters: total.characters + view.records.reduce((sum, record) => sum + record.estimatedCharacters, 0),
    tokens: total.tokens + view.records.reduce((sum, record) => sum + record.estimatedTokens, 0),
  }), { records: 0, characters: 0, tokens: 0 });
}
