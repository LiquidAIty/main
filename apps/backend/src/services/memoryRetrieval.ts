import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export interface ProjectContext {
  rag_chunks: Array<{
    chunk_id: string;
    snippet: string;
    src: string;
    score: number;
  }>;
  kg_facts: string[];
}

/**
 * Retrieve project context from RAG chunks and KG facts
 * Returns top matching chunks and recent KG facts for the project
 */
export async function getProjectContext(
  projectId: string,
  userText: string
): Promise<ProjectContext> {
  const context: ProjectContext = {
    rag_chunks: [],
    kg_facts: [],
  };

  try {
    // Get RAG chunks (top 5-10 best matching)
    // Note: This assumes you have an embedding function available
    // For now, we'll do a simple text search as fallback
    const ragQuery = `
      SELECT 
        chunk_id,
        LEFT(chunk, 200) as snippet,
        src,
        0.5 as score
      FROM ag_catalog.rag_chunks
      WHERE project_id = $1
        AND chunk ILIKE $2
      ORDER BY created_at DESC
      LIMIT 10
    `;
    
    const ragResult = await pool.query(ragQuery, [
      projectId,
      `%${userText.slice(0, 50)}%`
    ]);
    
    context.rag_chunks = ragResult.rows.map(row => ({
      chunk_id: row.chunk_id,
      snippet: row.snippet,
      src: row.src || 'unknown',
      score: parseFloat(row.score) || 0.5,
    }));
  } catch (err) {
    console.warn('[MEMORY] RAG retrieval failed:', err);
  }

  try {
    // Get KG facts (recent entities + relationships)
    // TODO: Implement actual KG query using Apache AGE
    // Example query would be:
    // MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId })
    // RETURN a.name as from_name, r.rtype as rel_type, b.name as to_name
    // LIMIT 50
    
    // For now, construct simple facts
    const facts: string[] = [];
    
    // Simplified: just note that KG exists
    facts.push(`Knowledge graph contains entities and relationships for project ${projectId}`);
    
    context.kg_facts = facts;
  } catch (err) {
    console.warn('[MEMORY] KG retrieval failed:', err);
  }

  return context;
}

/**
 * Format project context into a compact prompt block
 */
export function formatContextForPrompt(context: ProjectContext): string {
  const sections: string[] = [];
  
  if (context.rag_chunks.length > 0) {
    const chunks = context.rag_chunks
      .map((c, i) => `${i + 1}. [${c.src}] ${c.snippet}`)
      .join('\n');
    sections.push(`## Relevant Notes (RAG)\n${chunks}`);
  }
  
  if (context.kg_facts.length > 0) {
    const facts = context.kg_facts
      .map((f, i) => `${i + 1}. ${f}`)
      .join('\n');
    sections.push(`## Known Facts (KG)\n${facts}`);
  }
  
  if (sections.length === 0) {
    return '';
  }
  
  return `# Project Context\n\n${sections.join('\n\n')}\n\n---\n\n`;
}
