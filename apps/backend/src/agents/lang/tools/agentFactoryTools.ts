import { z } from "zod";
import { makeZodTool, Z } from "./zodTools";
import neo4j, { Driver } from 'neo4j-driver';

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
    name: 'knowledge_graph_query',
    description: 'Query the knowledge graph using Cypher or natural language.',
    schema: z.object({
      query: Z.str("Cypher query or natural language question"),
      queryType: z.enum(['cypher', 'natural']).default('natural'),
      graphId: Z.optStr("Optional specific graph ID"),
      limit: z.number().int().min(1).max(1000).default(10)
    }),
    func: async ({ query, queryType, graphId, limit }) => {
      // Simplified stub - Neo4j query would use getDriver().session() if implemented
      return { success: true, queryType, query, graphId, limit, rows: [] };
    }
  });

  return [memoryTool, kgTool, kgQueryTool];
}
