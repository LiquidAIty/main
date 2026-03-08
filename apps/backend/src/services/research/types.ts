export type ResearchMode = 'web_research';

export type ResearchSearchDepth = 'basic' | 'advanced';

export type ResearchTargetPacket = {
  projectId: string;
  turnId: string;
  query: string;
  priorityEntities: string[];
  priorityRelationships: string[];
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
  tool_name: string;
  search_result_count: number;
  ingested_document_count: number;
  document_ids: string[];
  upstream: any;
};
