export type ResearchMode = 'web_research';

export type ResearchSearchDepth = 'basic' | 'advanced';

export type CandidateEdge = {
  entityA: string;
  relationshipType: string;
  entityB: string;
  confidence?: number | null;
  source?: 'thinkgraph' | 'fallback' | 'manual';
};

export type ThinkGraphTriplet = {
  entityA: string;
  relationshipType: string;
  entityB: string;
  confidence?: number | null;
  source?: 'thinkgraph' | 'fallback' | 'manual';
};

export type KnowGraphGapType =
  | 'missing_evidence'
  | 'weak_evidence'
  | 'conflict'
  | 'stale_evidence';

export type KnowGraphGapPriority = 'high' | 'medium' | 'low';

export type KnowGraphGap = {
  entityA: string;
  relationshipType: string;
  entityB: string;
  gapType: KnowGraphGapType;
  evidenceCount: number;
  contradictionCount: number;
  priority: KnowGraphGapPriority;
  reason: string;
  existingRelationTypes?: string[];
  lastEvidenceAt?: string | null;
};

export type ResearchIntent =
  | 'explain'
  | 'compare'
  | 'verify'
  | 'resolve_conflict'
  | 'deepen_evidence';

export type ResearchSearchTask = {
  query: string;
  intent: ResearchIntent;
  priority: KnowGraphGapPriority;
  gap: KnowGraphGap | null;
  triplet?: ThinkGraphTriplet | null;
};

export type ResearchTargetPacket = {
  projectId: string;
  turnId: string;
  query: string;
  priorityEntities: string[];
  priorityRelationships: string[];
  attentionEdges: CandidateEdge[];
  triplets: ThinkGraphTriplet[];
  gaps: KnowGraphGap[];
  searchTasks: ResearchSearchTask[];
  openQuestions: string[];
  maxResults: number;
  searchDepth: ResearchSearchDepth;
  mode: ResearchMode;
};

export type TavilySearchResult = {
  url: string;
  title: string;
  content?: string | null;
  rawContent?: string | null;
  snippet?: string | null;
  summary?: string | null;
  score?: number | null;
  publishedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type NormalizedResearchDocument = {
  project_id: string;
  document_id: string;
  source_url: string;
  title: string;
  snippet: string | null;
  summary: string | null;
  fetched_at: string;
  full_text: string | null;
  text: string;
  metadata: Record<string, unknown>;
};

export type ResearchIngestResult = {
  ok: boolean;
  project_id: string;
  turn_id: string;
  query: string;
  planned_task_count: number;
  gap_count: number;
  tool_name: string;
  search_result_count: number;
  ingested_document_count: number;
  document_ids: string[];
  upstream: any;
};
