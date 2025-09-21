/**
 * Vector Embedding Service
 * Handles document embedding using OpenAI or other embedding models
 */

import { DocumentType } from '../models/ontology';

/**
 * Embedding model options
 */
export enum EmbeddingModel {
  OPENAI_ADA = 'text-embedding-ada-002',
  OPENAI_3_SMALL = 'text-embedding-3-small',
  OPENAI_3_LARGE = 'text-embedding-3-large',
  COHERE_EMBED = 'cohere-embed-english-v3.0',
  HUGGINGFACE_MPNET = 'sentence-transformers/all-mpnet-base-v2',
  HUGGINGFACE_MINILM = 'sentence-transformers/all-MiniLM-L6-v2'
}

/**
 * Embedding request parameters
 */
export interface EmbeddingRequest {
  text: string;
  model?: EmbeddingModel;
  truncate?: boolean;
  maxTokens?: number;
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  tokenCount?: number;
  truncated?: boolean;
}

/**
 * Document embedding request
 */
export interface DocumentEmbeddingRequest {
  id: string;
  title: string;
  text: string;
  type: DocumentType;
  timestamp: string;
  source: string;
  url?: string;
  model?: EmbeddingModel;
}

/**
 * Document with embedding
 */
export interface DocumentWithEmbedding {
  id: string;
  title: string;
  text: string;
  type: DocumentType;
  timestamp: string;
  source: string;
  url?: string;
  embedding: number[];
  model: string;
}

/**
 * Get embedding for text
 */
export async function getEmbedding(
  request: EmbeddingRequest
): Promise<EmbeddingResponse> {
  const model = request.model || EmbeddingModel.OPENAI_3_SMALL;
  const truncate = request.truncate !== undefined ? request.truncate : true;
  const maxTokens = request.maxTokens || 8192;
  
  try {
    const response = await fetch('/api/embedding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        model,
        truncate,
        maxTokens
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    return {
      embedding: data.embedding,
      model: data.model,
      tokenCount: data.tokenCount,
      truncated: data.truncated
    };
  } catch (error) {
    console.error('Error getting embedding:', error);
    throw error;
  }
}

/**
 * Get embedding for document
 */
export async function getDocumentEmbedding(
  request: DocumentEmbeddingRequest
): Promise<DocumentWithEmbedding> {
  // Combine title and text for better embedding
  const combinedText = `${request.title}\n\n${request.text}`;
  
  try {
    const embeddingResponse = await getEmbedding({
      text: combinedText,
      model: request.model
    });
    
    return {
      id: request.id,
      title: request.title,
      text: request.text,
      type: request.type,
      timestamp: request.timestamp,
      source: request.source,
      url: request.url,
      embedding: embeddingResponse.embedding,
      model: embeddingResponse.model
    };
  } catch (error) {
    console.error('Error getting document embedding:', error);
    throw error;
  }
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimensions');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (normA * normB);
}

/**
 * Find similar documents by embedding
 */
export async function findSimilarDocuments(
  embedding: number[],
  limit: number = 10
): Promise<Array<{ id: string; title: string; score: number }>> {
  try {
    const response = await fetch('/api/kg/similar-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embedding,
        limit
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    return data.results;
  } catch (error) {
    console.error('Error finding similar documents:', error);
    throw error;
  }
}

/**
 * Mock embedding function for testing without API calls
 */
export function mockEmbedding(text: string, dimensions: number = 1536): number[] {
  // Create a deterministic but random-looking embedding based on the text
  const hash = hashString(text);
  const embedding = new Array(dimensions).fill(0);
  
  for (let i = 0; i < dimensions; i++) {
    // Use a simple PRNG with the hash and dimension as seed
    const seed = hash + i;
    embedding[i] = pseudoRandom(seed) * 2 - 1; // Range: -1 to 1
  }
  
  // Normalize the embedding
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / norm);
}

/**
 * Simple string hash function
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Simple pseudorandom number generator
 */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
