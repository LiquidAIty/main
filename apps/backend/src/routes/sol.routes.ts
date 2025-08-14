import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { processRequest } from '../agents/sol';

export const solRouter = Router();

solRouter.post('/execute', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    await processRequest(req.body, req);
    res.status(202).json({ status: 'accepted' });
  } catch (error: any) {
    res.status(400).json({ status: 'error', message: error?.message || 'Unknown error' });
  }
});
