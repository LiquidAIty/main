import { z } from "zod";
import { makeZodTool, Z } from "./zodTools";

export const knowledgeGraphTool = makeZodTool({
  name: "knowledge_graph",
  description: "Upsert nodes/edges in the knowledge graph.",
  schema: z.object({
    nodes: Z.strArr("Node ids/labels"),
    edges: z.array(z.object({
      from: Z.str("Source"),
      to: Z.str("Target"),
      type: Z.str("Edge type")
    })).default([])
  }),
  func: async ({ nodes, edges }) => {
    // TODO: replace with real service call
    return { ok: true, upserted: { nodes, edges } };
  }
});

export const knowledgeGraphQueryTool = makeZodTool({
  name: "knowledge_graph_query",
  description: "Query the knowledge graph.",
  schema: z.object({
    query: Z.str("Query or pattern"),
    limit: z.number().int().min(1).max(1000).default(50)
  }),
  func: async ({ query, limit }) => {
    // TODO: replace with real query
    return { rows: [], query, limit };
  }
});
