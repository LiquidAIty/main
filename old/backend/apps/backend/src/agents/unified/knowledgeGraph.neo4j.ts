import neo4j from "neo4j-driver";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

const NEO4J_URI = process.env.NEO4J_URI ?? "";
const NEO4J_USER = process.env.NEO4J_USER ?? "";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "";

const driver = NEO4J_URI && NEO4J_USER
  ? neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
  : null;

const safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "");
const labelsStr = (labels: string[]) => labels.map((label) => `:${safe(label)}`).join("");

const UpsertSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    labels: z.array(z.string()).default([]),
    props: z.record(z.any()).default({}),
  })).default([]),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    type: z.string(),
    props: z.record(z.any()).default({}),
  })).default([]),
});

export const knowledgeGraphTool = new DynamicStructuredTool({
  name: "knowledge_graph",
  description: "Upsert nodes & edges into Neo4j",
  schema: UpsertSchema,
  func: async ({ nodes, edges }) => {
    if (!driver) {
      return JSON.stringify({ ok: false, data: null, error: "Neo4j not configured", meta: null });
    }
    const session = driver.session();
    try {
      for (const node of nodes) {
        await session.run(
          `MERGE (x${labelsStr(node.labels)} {id:$id}) SET x += $props`,
          { id: node.id, props: node.props ?? {} }
        );
      }
      for (const edge of edges) {
        const type = safe(edge.type ?? "RELATES_TO");
        await session.run(
          `MATCH (a{id:$from}),(b{id:$to}) MERGE (a)-[r:${type}]->(b) SET r += $props`,
          { from: edge.from, to: edge.to, props: edge.props ?? {} }
        );
      }
      return JSON.stringify({
        ok: true,
        data: { upserted: { nodes: nodes.length, edges: edges.length } },
        error: null,
        meta: null,
      });
    } finally {
      await session.close();
    }
  },
});

const QuerySchema = z.object({
  cypher: z.string(),
  params: z.record(z.any()).default({}),
});

export const knowledgeGraphQueryTool = new DynamicStructuredTool({
  name: "knowledge_graph_query",
  description: "Read-only Cypher; returns rows",
  schema: QuerySchema,
  func: async ({ cypher, params }) => {
    if (!driver) {
      return JSON.stringify({ ok: false, data: null, error: "Neo4j not configured", meta: null });
    }
    const session = driver.session();
    try {
      const res = await session.run(cypher, params ?? {});
      return JSON.stringify({
        ok: true,
        data: { rows: res.records.map((record) => record.toObject()) },
        error: null,
        meta: null,
      });
    } finally {
      await session.close();
    }
  },
});

export const isNeo4jReady = () => Boolean(driver);
