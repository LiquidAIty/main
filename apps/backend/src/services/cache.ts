import Redis from 'ioredis';

const url = process.env.REDIS_URL;

export const redis = url ? new Redis(url) : null;

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (redis) {
    await redis.disconnect();
  }
});

process.on('SIGINT', async () => {
  if (redis) {
    await redis.disconnect();
  }
});
