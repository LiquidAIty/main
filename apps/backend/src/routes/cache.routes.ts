import { Router } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const router = Router();

router.get('/', async (_req, res) => {
  try {
    await redis.ping();
    res.send('PONG');
  } catch {
    res.status(500).send('cache error');
  }
});

export default router;
