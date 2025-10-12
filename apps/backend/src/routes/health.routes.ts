import { Router } from "express";
import { pingNeo4j } from "../connectors/neo4j";
import { pingEsn } from "../connectors/esn";
import { getMcpTools } from "../agents/mcp/mcpClient";

const router = Router();

router.get("/health", async (_req, res) => {
  const out: { ok: boolean; neo4j?: string; esn?: string; mcp?: { count: number; error?: string } } = { ok: true };

  try {
    out.neo4j = await pingNeo4j();
  } catch {
    out.neo4j = "down";
    out.ok = false;
  }

  try {
    out.esn = await pingEsn();
  } catch {
    out.esn = "down";
    out.ok = false;
  }

  try {
    const tools = await getMcpTools();
    out.mcp = { count: Array.isArray(tools) ? tools.length : 0 };
  } catch {
    out.mcp = { count: 0, error: "load-failed" };
  }

  res.json(out);
});

export default router;
