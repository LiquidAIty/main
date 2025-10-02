import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { toolRegistry } from '../agents/registry';

const router = Router();

/**
 * Health check endpoint
 * @route GET /health
 * @returns {object} 200 - Health status information
 */
router.get('/health', (_req: ExpressRequest, res: ExpressResponse) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      api: 'healthy',
      database: process.env.DATABASE_URL ? 'connected' : 'not_configured',
      pythonModels: process.env.PYTHON_MODELS_URL ? 'configured' : 'not_configured'
    }
  };
  
  res.status(200).json(healthData);
});

router.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/tools', (_req: ExpressRequest, res: ExpressResponse) => {
  const tools = Array.from(toolRegistry.keys());
  res.status(200).json({ status: 'ok', tools });
});

export default router;
export { router as healthRouter };
