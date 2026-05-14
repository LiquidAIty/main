export type KnowledgeEntity = {
  id: string;
  label: string;
  type: string;
  degree?: number | null;
  confidence?: number | null;
  summary?: string | null;
};

export type KnowledgeRelationship = {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence?: number | null;
  summary?: string | null;
  evidence_chunk_ids?: string[] | null;
  source_document_ids?: string[] | null;
};
