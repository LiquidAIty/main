export type GraphContextConfidenceLevel =
  | "low"
  | "medium"
  | "high"
  | "unknown";

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
  components: string[];
  routes: string[];
  schemas: string[];
  tools: string[];
  agentCards: string[];
  promptTemplates: string[];
  implementationNotes: string[];
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
  packetVersion: string;
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
    const normalized = String(value || "").trim();
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
      packetVersion: "stage0.v1",
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
      detail: "Term appears in both ThinkGraph context and KnowGraph context.",
    }));

  const missingEvidence = [...thinkTerms]
    .filter((term) => !knowTerms.has(term))
    .map((term) => ({
      label: term,
      detail: "ThinkGraph context mentions this item without matching KnowGraph evidence.",
    }));

  const staleContextWarnings = thinkGraphContext.outcomes
    .filter((outcome) => /stale|outdated|superseded/i.test(outcome))
    .map((outcome) => ({
      label: "stale_context",
      detail: outcome,
    }));

  const confidenceGaps = knowGraphContext.provenance
    .filter((item) => !item.confidence || item.confidence === "low" || item.confidence === "unknown")
    .map((item) => ({
      label: item.label,
      detail: `KnowGraph provenance confidence is ${item.confidence || "unknown"}.`,
    }));

  return {
    congruence,
    conflicts: [],
    missingEvidence,
    confidenceGaps,
    staleContextWarnings,
  };
}

export function summarizeGraphContextForPrompt(packet: GraphContextPacket): string {
  const sections: string[] = [];

  if (packet.thinkGraphContext.intent.length > 0) {
    sections.push(`ThinkGraph intent: ${packet.thinkGraphContext.intent.join("; ")}`);
  }
  if (packet.thinkGraphContext.assumptions.length > 0) {
    sections.push(`ThinkGraph assumptions: ${packet.thinkGraphContext.assumptions.join("; ")}`);
  }
  if (packet.knowGraphContext.evidence.length > 0) {
    sections.push(
      `KnowGraph evidence: ${packet.knowGraphContext.evidence
        .map((item) => `${item.title} [source=${item.sourceLabel}]`)
        .join("; ")}`,
    );
  }
  if (packet.knowGraphContext.provenance.length > 0) {
    sections.push(
      `KnowGraph provenance: ${packet.knowGraphContext.provenance
        .map((item) => `${item.label} [confidence=${item.confidence || "unknown"}]`)
        .join("; ")}`,
    );
  }
  if (packet.codeGraphContext) {
    if (packet.codeGraphContext.relevantFiles.length > 0) {
      sections.push(`CodeGraph files: ${packet.codeGraphContext.relevantFiles.join("; ")}`);
    }
    if (packet.codeGraphContext.components.length > 0) {
      sections.push(`CodeGraph components: ${packet.codeGraphContext.components.join("; ")}`);
    }
  }
  if (packet.comparison.conflicts.length > 0) {
    sections.push(
      `Context conflicts: ${packet.comparison.conflicts
        .map((item) => `${item.label}: ${item.detail}`)
        .join("; ")}`,
    );
  }
  if (packet.comparison.missingEvidence.length > 0) {
    sections.push(
      `Missing evidence: ${packet.comparison.missingEvidence
        .map((item) => item.label)
        .join("; ")}`,
    );
  }
  if (packet.comparison.confidenceGaps.length > 0) {
    sections.push(
      `Confidence gaps: ${packet.comparison.confidenceGaps
        .map((item) => `${item.label}: ${item.detail}`)
        .join("; ")}`,
    );
  }
  if (packet.provenance.sourceLabels.length > 0) {
    sections.push(`Context sources: ${packet.provenance.sourceLabels.join("; ")}`);
  }

  return sections.join("\n");
}
