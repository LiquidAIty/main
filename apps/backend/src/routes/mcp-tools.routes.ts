import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { MCPController } from '../agents/mcp-controller';
import { MCPToolRegistry } from '../agents/mcp-tool-registry';

const router = Router();
const mcpController = new MCPController();
const toolRegistry = new MCPToolRegistry();

// GET /api/mcp/available-tools - List all available MCP tools
router.get('/available-tools', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const tools = await mcpController.getAvailableTools();
    return res.json({ ok: true, tools });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/mcp/installed-tools - List installed MCP tools
router.get('/installed-tools', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const tools = toolRegistry.getInstalledTools();
    return res.json({ ok: true, tools });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/mcp/install-tool - Install MCP tool
router.post('/install-tool', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { toolId } = req.body;
    
    if (!toolId) {
      return res.status(400).json({ ok: false, error: 'Tool ID is required' });
    }

    const result = await mcpController.installTool(toolId);
    
    return res.json({ ok: result.success, message: result.message });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/mcp/uninstall-tool - Uninstall MCP tool
router.post('/uninstall-tool', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { toolId } = req.body;
    
    if (!toolId) {
      return res.status(400).json({ ok: false, error: 'Tool ID is required' });
    }

    const result = await mcpController.uninstallTool(toolId);
    
    return res.json({ ok: result.success, message: result.message });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/mcp/collect-youtube - Collect YouTube transcript
router.post('/collect-youtube', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { videoUrl } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({ ok: false, error: 'Video URL is required' });
    }

    const result = await mcpController.collectYouTubeData(videoUrl);
    
    return res.json({ ok: result.success, data: result.data, error: result.error });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/mcp/collect-news - Collect news articles
router.post('/collect-news', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ ok: false, error: 'Search query is required' });
    }

    const result = await mcpController.collectNewsData(query);
    
    return res.json({ ok: result.success, data: result.data, error: result.error });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/mcp/knowledge-graph - Get current knowledge graph
router.get('/knowledge-graph', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const nodes = await mcpController.getKnowledgeGraph();
    return res.json({ ok: true, nodes });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/mcp/build-knowledge-graph - Build knowledge graph from sources
router.post('/build-knowledge-graph', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { sources } = req.body;
    
    if (!sources || !Array.isArray(sources)) {
      return res.status(400).json({ ok: false, error: 'Sources array is required' });
    }

    const result = await mcpController.buildKnowledgeGraph(sources);
    
    return res.json({ ok: result.success, nodes: result.nodes, error: result.error });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/mcp/check-hallucination - Check content for hallucinations
router.post('/check-hallucination', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ ok: false, error: 'Content is required' });
    }

    const result = await mcpController.checkHallucination(content);
    
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
