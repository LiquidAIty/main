export type SeedSourceKind = 'code' | 'codex_report' | 'design_chat' | 'manual_seed';

export type SeedStatus = 'current' | 'planned' | 'historical' | 'provisional';

export type SeedEntityKind =
  | 'Surface'
  | 'Rule'
  | 'SystemConcept'
  | 'ProductPrimitive'
  | 'InteractionModel'
  | 'File'
  | 'Component'
  | 'Route'
  | 'RuntimeFunction'
  | 'StateOwner'
  | 'Module'
  | 'TypeContract'
  | 'Agent'
  | 'AgentRole'
  | 'AgentTool'
  | 'MemoryScope'
  | 'VisibilityTier'
  | 'SurfaceBehavior'
  | 'InteractionRule'
  | 'FocusRule'
  | 'Mode'
  | 'PlanPattern'
  | 'PlanNodeType'
  | 'PlanEdgeType'
  | 'ApprovalGate'
  | 'CurrentTruth'
  | 'Constraint'
  | 'DesignDecision'
  | 'Baseline'
  | 'FutureDirection'
  | 'Framework'
  | 'Dependency'
  | 'Library'
  | 'RuntimePlatform';

export type SeedEntity = {
  id: string;
  kind: SeedEntityKind;
  name: string;
  summary?: string;
  status?: SeedStatus;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type SeedRelationship = {
  id: string;
  from: string;
  to: string;
  type: string;
  summary?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type SeedTruthScope = 'platform' | 'surface' | 'agent' | 'runtime' | 'ui' | 'knowledge';

export type SeedTruth = {
  id: string;
  statement: string;
  scope?: SeedTruthScope;
  status?: SeedStatus;
  confidence?: number;
  sourceRef?: string;
  sourceKind?: SeedSourceKind;
};

export type SeedPattern = {
  id: string;
  name: string;
  summary?: string;
  nodeTypes: string[];
  edgeTypes: string[];
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type SeedProvenance = {
  id: string;
  sourceKind: SeedSourceKind;
  sourceRef: string;
  summary?: string;
  confidence?: number;
  capturedAt?: string;
  metadata?: Record<string, unknown>;
};

export type ProjectKnowledgeSeed = {
  schemaVersion: 'project_knowledge_seed/v1';
  projectId: string;
  generatedAt: string;
  entities: SeedEntity[];
  relationships: SeedRelationship[];
  truths: SeedTruth[];
  patterns: SeedPattern[];
  provenance: SeedProvenance[];
};
