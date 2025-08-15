import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { toolRegistry } from '../agents/registry';

const router = Router();

router.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/tools', (_req: ExpressRequest, res: ExpressResponse) => {
  const tools = Array.from(toolRegistry.keys());
  res.status(200).json({ status: 'ok', tools });
});

export default router;
export { router as healthRouter };
