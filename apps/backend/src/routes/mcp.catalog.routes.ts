import { Router, Request, Response } from 'express';
import { 
  type McpCategory,
  type McpServerRef,
  listMcpServers,
  findMcpByName,
} from '../agents/tools/mcp';

const router = Router();

// GET /mcp/catalog -> { categories: string[], total: number }
router.get('/catalog', (_req: Request, res: Response) => {
  const categories = Object.keys(listAllByCategory());
  const total = listAll().length;
  res.status(200).json({ categories, total });
});

// GET /mcp/catalog/:category -> { category, servers: McpServerRef[] }
router.get('/catalog/:category', (req: Request, res: Response) => {
  const category = req.params.category as McpCategory;
  const servers: McpServerRef[] = listMcpServers(category) || [];
  res.status(200).json({ category, servers });
});

// GET /mcp/catalog/find?name=... -> McpServerRef | { error: 'not found' }
router.get('/catalog/find', (req: Request, res: Response) => {
  const name = (req.query.name ?? '').toString().trim();
  if (!name) return res.status(400).json({ error: 'missing query param: name' });
  const found = findMcpByName(name);
  if (!found) return res.status(404).json({ error: 'not found' });
  return res.status(200).json(found);
});

export default router;

// Helpers (typed) to avoid implicit any
function listAllByCategory(): Record<string, McpServerRef[]> {
  const categories = ['google','memory','n8n','openai','python','rag','scraper','ui','mcp'] as McpCategory[];
  const out: Record<string, McpServerRef[]> = {};
  for (const c of categories) out[c] = listMcpServers(c) || [];
  return out;
}

function listAll(): McpServerRef[] {
  return Object.values(listAllByCategory()).flat();
}
