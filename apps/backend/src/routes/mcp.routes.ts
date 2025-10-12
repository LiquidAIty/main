import { Router } from 'express';
import { getMcpTools, refreshMcpTools } from '../agents/mcp/mcpClient';

const router = Router();

// GET /mcp/tools - List available MCP tools
router.get("/mcp/tools", async (_req, res) => {
  try {
    const tools = await getMcpTools();
    res.json({ count: tools.length, names: tools.map(t => t.name) });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to load MCP tools" });
  }
});

// POST /mcp/refresh - Reload MCP tools
router.post("/mcp/refresh", async (_req, res) => {
  try {
    const n = await refreshMcpTools();
    res.json({ ok: true, reloaded: n });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to refresh MCP tools" });
  }
});

export default router;
