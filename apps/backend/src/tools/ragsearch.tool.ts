import type { ToolConfig } from "../types/tool.types";

export interface RagSearchParams {
  embedding: number[];
  k?: number;
  w_rec?: number;
  w_sig?: number;
}

export interface RagSearchResult {
  chunk_id: string;
  doc_id: string;
  src: string;
  chunk: string;
  model: string;
  score: number;
  cos_dist: number;
  l2_dist: number;
  scale: number;
  days_old: number;
  created_at: string;
}

export interface RagSearchResponse {
  ok: boolean;
  k: number;
  weights: {
    w_cos: number;
    w_rec: number;
    w_sig: number;
  };
  rows: RagSearchResult[];
}

/**
 * RAG Search Tool Configuration
 * Exposes weighted vector search with semantic, recency, and signal weights.
 * 
 * Weights:
 * - w_cos: semantic similarity (computed as 1 - w_rec - w_sig)
 * - w_rec: recency/freshness (0.0-0.5)
 * - w_sig: signal/importance (0.0-0.5)
 */
export const ragSearchTool: ToolConfig<RagSearchParams, RagSearchResponse> = {
  id: "rag_search",
  name: "RAG Search",
  description:
    "Search knowledge base with weighted vector similarity (semantic + recency + signal)",
  version: "1.0.0",

  params: {
    embedding: {
      type: "array",
      required: true,
      description: "Vector embedding (typically 1536-dim from OpenAI)",
    },
    k: {
      type: "number",
      required: false,
      description: "Number of top results (1-50, default 5)",
    },
    w_rec: {
      type: "number",
      required: false,
      description: "Recency weight (0.0-0.5, default 0.1)",
    },
    w_sig: {
      type: "number",
      required: false,
      description: "Signal weight (0.0-0.5, default 0.1)",
    },
  },

  request: {
    url: () => "/api/rag/search",
    method: "POST",
    headers: () => ({
      "Content-Type": "application/json",
    }),
    body: (params) => {
      const k = params.k ? Math.max(1, Math.min(50, Number(params.k) || 5)) : 5;
      const w_rec = params.w_rec ? Math.max(0, Number(params.w_rec) || 0.1) : 0.1;
      const w_sig = params.w_sig ? Math.max(0, Number(params.w_sig) || 0.1) : 0.1;

      return {
        embedding: params.embedding,
        k,
        w_rec,
        w_sig,
      };
    },
  },

  transformResponse: async (response): Promise<RagSearchResponse> => {
    const result = await response.json();
    return result;
  },

  outputs: {
    ok: {
      type: "boolean",
      description: "Whether the search succeeded",
    },
    k: {
      type: "number",
      description: "Number of results requested",
    },
    weights: {
      type: "object",
      description: "Final normalized weights used",
      properties: {
        w_cos: { type: "number", description: "Semantic weight" },
        w_rec: { type: "number", description: "Recency weight" },
        w_sig: { type: "number", description: "Signal weight" },
      },
    },
    rows: {
      type: "array",
      description: "Search results ranked by weighted score",
      items: {
        type: "object",
        properties: {
          chunk_id: { type: "string", description: "Unique chunk identifier" },
          doc_id: { type: "string", description: "Document identifier" },
          src: { type: "string", description: "Source URL or reference" },
          chunk: { type: "string", description: "Content snippet" },
          model: { type: "string", description: "Embedding model used" },
          score: { type: "number", description: "Final weighted score" },
          cos_dist: { type: "number", description: "Cosine distance" },
          l2_dist: { type: "number", description: "L2 distance" },
          scale: { type: "number", description: "Scale factor" },
          days_old: { type: "number", description: "Age in days" },
          created_at: { type: "string", description: "Creation timestamp" },
        },
      },
    },
  },
};
