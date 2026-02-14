import { Pool } from 'pg';

type PgError = Error & { code?: string };

type PoolWithQuery = Pool & { query: (...args: any[]) => Promise<any> };

const g = globalThis as any;

function isTransient(err: PgError): boolean {
  const code = err?.code || '';
  const msg = (err?.message || '').toLowerCase();
  return (
    code === '57P01' ||
    code === '57P02' ||
    code === '08006' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    msg.includes('connection terminated unexpectedly') ||
    msg.includes('connection terminated')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wrapQuery(pool: PoolWithQuery) {
  const orig = pool.query.bind(pool);
  pool.query = async (...args: any[]) => {
    try {
      return await orig(...args);
    } catch (err: any) {
      if (isTransient(err)) {
        await sleep(250);
        return await orig(...args);
      }
      throw err;
    }
  };
}

if (!g.__LIQ_PG_POOL__) {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5433),
    database: process.env.POSTGRES_DB || 'liquidaity',
    user: process.env.POSTGRES_USER || 'liquidaity-user',
    password: process.env.POSTGRES_PASSWORD || 'LiquidAIty',
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    keepAlive: true,
  }) as PoolWithQuery;

  pool.on('error', (err) => {
    console.error('[PG_POOL_ERROR]', err);
  });

  wrapQuery(pool);

  g.__LIQ_PG_POOL__ = pool;
}

if (!g.__LIQ_PG_SHUTDOWN_HOOKS__) {
  const shutdown = async () => {
    try {
      const pool = g.__LIQ_PG_POOL__ as Pool | undefined;
      if (pool && !pool.ended) {
        await pool.end();
      }
    } catch (err) {
      console.error('[PG_POOL_SHUTDOWN_ERROR]', err);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  g.__LIQ_PG_SHUTDOWN_HOOKS__ = true;
}

export const pool: PoolWithQuery = g.__LIQ_PG_POOL__;
