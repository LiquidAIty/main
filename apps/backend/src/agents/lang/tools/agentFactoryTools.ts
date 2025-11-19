import { z } from "zod";
import { makeZodTool, Z } from "./zodTools";
import neo4j, { Driver } from 'neo4j-driver';
import { createRagTool } from '../../tools/rag';

// Neo4j connection (lazy initialization)
const NEO4J_URI = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

let driver: Driver | null = null;

function getDriver() {
  if (!driver) {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  }
  return driver;
}

export function createAgentTools(specId: string, threadId?: string) {
  const memoryTool = makeZodTool({
    name: 'memory_op',
    description: "Store or retrieve information. ops: put|get|all. Example: {op:'put', key:'project', value:'LiquidAIty'}",
    schema: z.object({
      op: z.enum(['put', 'get', 'all']),
      key: Z.optStr("Key for put/get"),
      value: z.any().optional()
    }),
    func: async ({ op, key, value }) => {
      const tid = threadId ?? `dept:${specId}`;
      if (op === 'put') {
        return { success: true, stored: key, threadId: tid };
      } else if (op === 'get') {
        return { success: true, key, value: null, threadId: tid };
      } else {
        return { success: true, all: [], threadId: tid };
      }
    }
  });

  const kgTool = makeZodTool({
    name: 'knowledge_graph',
    description: 'Create or update knowledge graph nodes and relationships.',
    schema: z.object({
      nodes: z.array(z.object({
        id: Z.str("Node ID"),
        labels: z.array(z.string()),
        properties: z.record(z.any()).optional()
      })),
      relationships: z.array(z.object({
        source: Z.str("Source node ID"),
        target: Z.str("Target node ID"),
        type: Z.str("Relationship type"),
        properties: z.record(z.any()).optional()
      })).optional()
    }),
    func: async ({ nodes, relationships }) => {
      const graphId = `kg-${Date.now()}`;
      try {
        const session = getDriver().session();
        try {
          const createdNodes: string[] = [];
          for (const node of nodes) {
            const labels = node.labels.map(l => `:${l}`).join('');
            const props = { ...(node.properties || {}), createdBy: specId, createdAt: new Date().toISOString(), graphId, id: node.id };
            await session.run(`MERGE (n${labels} {id: $id}) ON CREATE SET n = $props ON MATCH SET n += $updateProps`, {
              id: node.id,
              props,
              updateProps: { updatedAt: props.createdAt, graphId }
            });
            createdNodes.push(node.id);
          }
          const createdRels: string[] = [];
          for (const rel of relationships || []) {
            const props = { ...(rel.properties || {}), createdBy: specId, createdAt: new Date().toISOString(), graphId };
            await session.run(`MATCH (s {id: $src}) MATCH (t {id: $tgt}) MERGE (s)-[r:${rel.type}]->(t) ON CREATE SET r = $props ON MATCH SET r += $updateProps`, {
              src: rel.source,
              tgt: rel.target,
              props,
              updateProps: { updatedAt: props.createdAt, graphId }
            });
            createdRels.push(`${rel.source}-${rel.type}->${rel.target}`);
          }
          return { success: true, graphId, nodesCreated: createdNodes.length, nodes: createdNodes, relationshipsCreated: createdRels.length, relationships: createdRels };
        } finally {
          await session.close();
        }
      } catch (error) {
        console.warn('[KG Tool] Neo4j not available:', error instanceof Error ? error.message : error);
        return { success: false, error: `Neo4j unavailable: ${error instanceof Error ? error.message : 'Connection failed'}`, graphId };
      }
    }
  });

  const kgQueryTool = makeZodTool({
    name: 'kg_neighborhood',
    description: 'Explore the knowledge graph neighborhood around a specific entity. Returns connected nodes and relationships.',
    schema: z.object({
      uid: Z.str("Entity ID or unique identifier to explore around"),
      depth: z.number().int().min(1).max(3).default(1).describe("How many hops away from the center node (1-3)"),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of nodes to return")
    }),
    func: async ({ uid, depth, limit }) => {
      try {
        const res = await fetch('http://localhost:4000/api/kg/neighborhood', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid, depth, limit })
        });

        if (!res.ok) {
          return {
            success: false,
            error: `KG neighborhood failed: HTTP ${res.status}`,
            nodes: [],
            edges: []
          };
        }

        const data = await res.json();
        console.log(`[KG Tool] Neighborhood for "${uid}" | depth=${depth} | Found ${data.nodes?.length || 0} nodes, ${data.edges?.length || 0} edges`);
        
        return {
          success: true,
          center_uid: uid,
          depth,
          nodes: data.nodes || [],
          edges: data.edges || []
        };
      } catch (err: any) {
        console.error('[KG Tool] Error:', err?.message || err);
        return {
          success: false,
          error: err?.message || 'KG neighborhood error',
          nodes: [],
          edges: []
        };
      }
    }
  });

  const ragTool = createRagTool();

  return [memoryTool, kgTool, kgQueryTool, ragTool];
}
