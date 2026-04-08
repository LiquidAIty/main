import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { getTool } from '../agents/registry';

const router = Router();

// POST /tools/openai
router.post('/tools/openai', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const tool = getTool('openai');
    if (!tool || typeof tool.run !== 'function') {
      return res.status(404).json({ ok: false, error: 'openai tool not available' });
    }
    const result = await tool.run(req.body ?? {});
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ ok: false, tool: 'openai', message });
  }
});

export default router;
export { router as openaiRouter };
