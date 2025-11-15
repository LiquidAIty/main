#!/usr/bin/env node
import { Pool } from "pg";
import { StdioServerTransport, Server } from "@modelcontextprotocol/sdk/server/index.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

const server = new Server({ name: "rag-search", version: "1.0.0" }, { capabilities: { tools: {} } });

server.tool({
  name: "db.rag_search",
  description: "Weighted RAG over Postgres (cosine + recency + signal).",
  inputSchema: {
    type: "object",
    properties: {
      embedding: { type: "array", items: { type: "number" }, minItems: 1 },
      k: { type: "integer", minimum: 1, maximum: 50, default: 5 },
      w_rec: { type: "number", minimum: 0, default: 0.1 },
      w_sig: { type: "number", minimum: 0, default: 0.1 }
    },
    required: ["embedding"]
  }
}, async (args) => {
  const { embedding, k = 5, w_rec = 0.1, w_sig = 0.1 } = args;
  const kk = Math.max(1, Math.min(50, Number(k) || 5));
  const wRec = Math.max(0, Number(w_rec) || 0);
  const wSig = Math.max(0, Number(w_sig) || 0);
  const wCos = Math.max(0, 1 - (wRec + wSig));
  const sql = `
    SELECT chunk_id, doc_id, src, chunk, model, score, cos_dist, l2_dist, scale, days_old, created_at
    FROM api.rag_topk_weighted($1::vector, $2::int, $3::real, $4::real, $5::real)
    ORDER BY score DESC LIMIT $2
  `;
  const { rows } = await pool.query(sql, [JSON.stringify(embedding), kk, wCos, wRec, wSig]);
  return { ok: true, k: kk, weights: { w_cos: wCos, w_rec: wRec, w_sig: wSig }, rows };
});

await server.connect(new StdioServerTransport());
