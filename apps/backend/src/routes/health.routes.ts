import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { toolRegistry } from '../agents/registry';

export const healthRouter = Router();

healthRouter.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
  res.status(200).json({ status: 'ok' });
});

healthRouter.get('/tools', (_req: ExpressRequest, res: ExpressResponse) => {
  const toolStatuses = Object.entries(toolRegistry).map(([name, tool]) => ({
    name,
    status: 'stubbed'
  }));

  res.status(200).json({
    status: 'ok',
    tools: toolStatuses
  });
});
