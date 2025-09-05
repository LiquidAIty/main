import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { dispatchTool } from '../dispatch/dispatcher';

const router = Router();

// POST / - Execute a tool call
router.post('/', async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
  try {
    const { kind, name, args } = req.body;
    
    if (!kind || !name) {
      res.status(400).json({ 
        error: 'Missing required fields: kind and name are required' 
      });
      return;
    }

    const result = await dispatchTool({ kind, name, args });
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
