export type GraphContextConfidenceLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'unknown';

export type GraphContextReference = {
  id: string;
  label: string;
  kind: string;
  summary?: string | null;
};

export type SelectedBoardContext = {
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  selectedCardId: string | null;
  selectedCardTitle: string | null;
  selectedObjectId: string | null;
  selectedObjectType: string | null;
  selectedObjectTitle: string | null;
  activeSurface: string | null;
  activeWorkbench: string | null;
  references: GraphContextReference[];
};

export type ThinkGraphContextPacket = {
  intent: string[];
  assumptions: string[];
  hypotheses: string[];
  uncertainties: string[];
  goals: string[];
  decisions: string[];
  outcomes: string[];
  reasoningNotes: string[];
  confidenceNotes: string[];
};

export type KnowGraphEntityContext = {
  id: string;
  label: string;
  type?: string | null;
  confidence?: GraphContextConfidenceLevel | null;
};

export type KnowGraphRelationContext = {
  fromId: string;
  toId: string;
  type: string;
  confidence?: GraphContextConfidenceLevel | null;
};

export type KnowGraphEvidenceContext = {
  id: string;
  title: string;
  snippet: string;
  sourceLabel: string;
  sourceUrl?: string | null;
  provenance?: string | null;
  confidence?: GraphContextConfidenceLevel | null;
  timestamp?: string | null;
};

export type KnowGraphSourceContext = {
  id: string;
  label: string;
  url?: string | null;
  kind?: string | null;
};

export type KnowGraphCitationContext = {
  id: string;
  label: string;
  sourceId?: string | null;
  excerpt?: string | null;
};

export type KnowGraphProvenanceContext = {
  id: string;
  label: string;
  sourceId?: string | null;
  confidence?: GraphContextConfidenceLevel | null;
  timestamp?: string | null;
};

export type KnowGraphContextPacket = {
  entities: KnowGraphEntityContext[];
  relations: KnowGraphRelationContext[];
  evidence: KnowGraphEvidenceContext[];
  sources: KnowGraphSourceContext[];
  citations: KnowGraphCitationContext[];
  provenance: KnowGraphProvenanceContext[];
  confidence: string[];
  timestamps: string[];
};

export type CodeGraphContextPacket = {
  relevantFiles: string[];
  relevantSymbols?: string[];
  codeAnchors?: string[];
  cbmQueries?: string[];
  components: string[];
  routes: string[];
  schemas: string[];
  tools: string[];
  agentCards: string[];
  promptTemplates: string[];
  implementationNotes: string[];
  freshness?: {
    status: 'fresh' | 'stale' | 'unavailable';
    diagnosticStatus?: 'ok' | 'stale' | 'unknown' | 'failed';
    project: string | null;
    nodes: number | null;
    edges: number | null;
    checkedAt: string;
    detail: string;
    indexedFileCount?: number | null;
    indexedChunkCount?: number | null;
    indexedRevision?: string | null;
    indexedAt?: string | null;
    sourceRoot?: string | null;
    filesystemFileCount?: number | null;
    missingFileCount?: number;
    missingFiles?: string[];
  };
  blocker?: string | null;
};

export type GraphContextComparisonItem = {
  label: string;
  detail: string;
};

export type GraphContextComparison = {
  congruence: GraphContextComparisonItem[];
  conflicts: GraphContextComparisonItem[];
  missingEvidence: GraphContextComparisonItem[];
  confidenceGaps: GraphContextComparisonItem[];
  staleContextWarnings: GraphContextComparisonItem[];
};

export type GraphContextProvenance = {
  generatedAt: string | null;
  sourceLabels: string[];
  debugNotes: string[];
  sourceDiagnostics: GraphContextSourceDiagnostic[];
  packetVersion: string;
};

export type GraphContextSourceDiagnostic = {
  source: 'graph_thinkgraph' | 'knowgraph' | 'codegraph_cbm';
  critical: boolean;
  status: 'ok' | 'empty' | 'blocked' | 'timed_out' | 'failed' | 'skipped';
  elapsedMs: number;
  evidenceCount: number;
  summary: string;
  blocker: string;
};

export type GraphContextPacket = {
  projectId: string | null;
  requestId: string | null;
  turnId: string | null;
  selectedBoardContext: SelectedBoardContext;
  thinkGraphContext: ThinkGraphContextPacket;
  knowGraphContext: KnowGraphContextPacket;
  codeGraphContext: CodeGraphContextPacket | null;
  comparison: GraphContextComparison;
  provenance: GraphContextProvenance;
};

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createEmptyGraphContextPacket(args?: {
  projectId?: string | null;
  requestId?: string | null;
  turnId?: string | null;
  generatedAt?: string | null;
}): GraphContextPacket {
  return {
    projectId: args?.projectId ?? null,
    requestId: args?.requestId ?? null,
    turnId: args?.turnId ?? null,
    selectedBoardContext: {
      selectedNodeIds: [],
      selectedEdgeIds: [],
      selectedCardId: null,
      selectedCardTitle: null,
      selectedObjectId: null,
      selectedObjectType: null,
      selectedObjectTitle: null,
      activeSurface: null,
      activeWorkbench: null,
      references: [],
    },
    thinkGraphContext: {
      intent: [],
      assumptions: [],
      hypotheses: [],
      uncertainties: [],
      goals: [],
      decisions: [],
      outcomes: [],
      reasoningNotes: [],
      confidenceNotes: [],
    },
    knowGraphContext: {
      entities: [],
      relations: [],
      evidence: [],
      sources: [],
      citations: [],
      provenance: [],
      confidence: [],
      timestamps: [],
    },
    codeGraphContext: null,
    comparison: {
      congruence: [],
      conflicts: [],
      missingEvidence: [],
      confidenceGaps: [],
      staleContextWarnings: [],
    },
    provenance: {
      generatedAt: args?.generatedAt ?? null,
      sourceLabels: [],
      debugNotes: [],
      sourceDiagnostics: [],
      packetVersion: 'stage0.v1',
    },
  };
}

export function mergeSelectedContextPacket(
  packet: GraphContextPacket,
  selectedBoardContext: Partial<SelectedBoardContext>,
): GraphContextPacket {
  return {
    ...packet,
    selectedBoardContext: {
      ...packet.selectedBoardContext,
      ...selectedBoardContext,
      selectedNodeIds: dedupeStrings([
        ...packet.selectedBoardContext.selectedNodeIds,
        ...(selectedBoardContext.selectedNodeIds || []),
      ]),
      selectedEdgeIds: dedupeStrings([
        ...packet.selectedBoardContext.selectedEdgeIds,
        ...(selectedBoardContext.selectedEdgeIds || []),
      ]),
      references: dedupeByKey(
        [
          ...packet.selectedBoardContext.references,
          ...(selectedBoardContext.references || []),
        ],
        (reference) => `${reference.kind}:${reference.id}:${reference.label}`,
      ),
    },
  };
}

export function compareThinkAndKnowContext(
  thinkGraphContext: ThinkGraphContextPacket,
  knowGraphContext: KnowGraphContextPacket,
): GraphContextComparison {
  const thinkTerms = new Set(
    dedupeStrings([
      ...thinkGraphContext.intent,
      ...thinkGraphContext.assumptions,
      ...thinkGraphContext.hypotheses,
      ...thinkGraphContext.goals,
      ...thinkGraphContext.decisions,
    ]).map((value) => value.toLowerCase()),
  );
  const knowTerms = new Set(
    dedupeStrings([
      ...knowGraphContext.entities.map((entity) => entity.label),
      ...knowGraphContext.evidence.map((evidence) => evidence.title),
      ...knowGraphContext.sources.map((source) => source.label),
    ]).map((value) => value.toLowerCase()),
  );

  const congruence = [...thinkTerms]
    .filter((term) => knowTerms.has(term))
    .map((term) => ({
      label: term,
      detail: 'Term appears in both ThinkGraph context and KnowGraph context.',
    }));

  const missingEvidence = [...thinkTerms]
    .filter((term) => !knowTerms.has(term))
    .map((term) => ({
      label: term,
      detail: 'ThinkGraph context mentions this item without matching KnowGraph evidence.',
    }));

  const staleContextWarnings = thinkGraphContext.outcomes
    .filter((outcome) => /stale|outdated|superseded/i.test(outcome))
    .map((outcome) => ({
      label: 'stale_context',
      detail: outcome,
    }));

  const confidenceGaps = knowGraphContext.provenance
    .filter((item) => !item.confidence || item.confidence === 'low' || item.confidence === 'unknown')
    .map((item) => ({
      label: item.label,
      detail: `KnowGraph provenance confidence is ${item.confidence || 'unknown'}.`,
    }));

  return {
    congruence,
    conflicts: [],
    missingEvidence,
    confidenceGaps,
    staleContextWarnings,
  };
}
