import { Router } from "express";
import { getMcpTools } from "../agents/mcp/mcpClient";
import { knowledgeGraphTool, knowledgeGraphQueryTool } from "../agents/lang/tools/knowledgeGraphTools";

const router = Router();

const LOCAL_TOOLS = [knowledgeGraphTool, knowledgeGraphQueryTool].filter(Boolean);
const toEntry = (tool: any) => ({
  name: tool?.name ?? "",
  description: tool?.description ?? ""
});

router.get("/ui/tools", async (_req, res) => {
  const mcp = await getMcpTools().catch(() => []);
  const local = LOCAL_TOOLS.map(toEntry);
  const mcpEntries = (mcp as any[]).map(toEntry);
  res.json({ local, mcp: mcpEntries });
});

export default router;
