import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { processRequest } from '../agents/sol';

const router = Router();

router.post('/execute', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    await processRequest(req.body, req);
    res.status(202).json({ status: 'accepted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ status: 'error', message });
  }
});

export default router;
export { router as solRouter };
