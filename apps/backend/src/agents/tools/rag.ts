import { z } from 'zod';
import { makeZodTool } from '../lang/tools/zodTools';

export function createRagTool() {
  return makeZodTool({
    name: 'rag_search',
    description: 'Search the knowledge base using weighted RAG (semantic + recency + signal). Returns top-k chunks.',
    schema: z.object({
      query: z.string().describe('Natural language query or topic to search for'),
      k: z.number().int().min(1).max(50).default(5).describe('Number of results (1-50)'),
      w_rec: z.number().min(0).max(1).default(0.1).describe('Weight for recency (0-1)'),
      w_sig: z.number().min(0).max(1).default(0.1).describe('Weight for signal/confidence (0-1)'),
      memory_scope: z.enum(['system', 'user', 'project', 'all']).default('all').describe('Memory scope filter'),
      project_id: z.string().optional().describe('Project ID for project-scoped queries'),
      user_id: z.string().optional().describe('User ID for user-scoped queries')
    }),
    func: async ({ query, k, w_rec, w_sig, memory_scope, project_id, user_id }) => {
      try {
        // TODO: Replace mock embedding with real embedding model (e.g., OpenAI text-embedding-3-small)
        const mockEmbedding = Array(1536).fill(0).map(() => Math.random() * 0.01);

        const res = await fetch('http://localhost:4000/api/rag/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embedding: mockEmbedding,
            k,
            w_rec,
            w_sig
          })
        });

        if (!res.ok) {
          return {
            success: false,
            error: `RAG search failed: HTTP ${res.status}`,
            items: []
          };
        }

        const data = await res.json();
        if (!data.ok) {
          return {
            success: false,
            error: data.error || 'Unknown RAG error',
            items: []
          };
        }

        type RagItem = {
          doc_id: string;
          chunk_id: string;
          score: number;
          cos_dist: number;
          chunk: string;
          src: string;
          created_at: string;
        };

        let items: RagItem[] = (data.rows || []).map((row: any) => ({
          doc_id: row.doc_id,
          chunk_id: row.chunk_id,
          score: row.score,
          cos_dist: row.cos_dist,
          chunk: row.chunk,
          src: row.src,
          created_at: row.created_at
        }));

        // Apply memory scoping filters
        if (memory_scope !== 'all') {
          const originalCount = items.length;
          if (memory_scope === 'system') {
            items = items.filter(item => item.doc_id?.startsWith('sys:'));
          } else if (memory_scope === 'user' && user_id) {
            items = items.filter(item => item.doc_id?.startsWith(`usr:${user_id}:`));
          } else if (memory_scope === 'project' && project_id) {
            items = items.filter(item => item.doc_id?.startsWith(`prj:${project_id}:`));
          }
          console.log(`[RAG Tool] Memory scope filter: ${originalCount} → ${items.length} items (scope: ${memory_scope})`);
        }

        console.log(`[RAG Tool] Query: "${query}" | k=${k} | scope=${memory_scope} | Found ${items.length} chunks`);
        return {
          success: true,
          query,
          k,
          weights: data.weights,
          items
        };
      } catch (err: any) {
        console.error('[RAG Tool] Error:', err?.message || err);
        return {
          success: false,
          error: err?.message || 'RAG tool error',
          items: []
        };
      }
    }
  });
}
