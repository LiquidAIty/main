import { Router } from 'express';
import { redis } from '../services/cache';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    if (!redis) {
      res.status(503).json({ 
        status: 'cache error',
        error: 'Redis not configured'
      });
      return;
    }
    
    await redis.ping();
    res.json({ status: 'cache ok' });
    return;
  } catch (error) {
    console.error('Cache health check failed:', error);
    res.status(500).json({ 
      status: 'cache error',
      error: error instanceof Error ? error.message : 'Unknown cache error'
    });
    return;
  }
});

export default router;
export { router as cacheRouter };
