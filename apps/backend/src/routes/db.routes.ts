import { Router } from 'express';
import { prisma } from '../services/database';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'db ok' });
    return;
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(500).json({ 
      status: 'db error',
      error: error instanceof Error ? error.message : 'Unknown database error'
    });
    return;
  }
});

export default router;
export { router as dbRouter };
