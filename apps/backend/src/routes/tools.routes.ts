import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { getTool } from '../agents/registry';

const router = Router();

// POST /:name - Execute tool by name
router.post('/:name', async (req: ExpressRequest, res: ExpressResponse) => {
  const name = String(req.params.name || '').trim();

  try {
    if (!name) {
      return res.status(404).json({ ok: false, error: 'tool not found: ' + name });
    }

    const tool = getTool(name);
    if (!tool || typeof tool.run !== 'function') {
      return res.status(404).json({ ok: false, error: 'tool not available' });
    }

    const params = (req.body && typeof req.body === 'object') ? req.body : {};
    const result = await tool.run(params ?? {});

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ ok: false, error: 'tool failure', message });
  }
});

// GET /try/:name - Test tool with query parameter
router.get('/try/:name', async (req: ExpressRequest, res: ExpressResponse) => {
  const name = String(req.params.name || '').trim();
  try {
    const tool = getTool(name);
    if (!tool || typeof tool.run !== 'function') {
      return res.status(404).json({ ok: false, error: 'tool not available' });
    }

    const q = (req.query as any)?.q ?? (req.query as any)?.prompt;
    if (typeof q !== 'string' || q.trim() === '') {
      return res.status(400).json({ ok: false, error: 'missing query ?q=' });
    }

    const result = await tool.run({ prompt: String(q ?? '') });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ ok: false, error: 'tool failure', message });
  }
});

export default router;
export { router as toolsRoutes };
