import '../config/env';
import { Pool } from 'pg';

type PgError = Error & { code?: string };

type PoolFacade = Pool & {
  query: (...args: any[]) => Promise<any>;
  connect: (...args: any[]) => Promise<any>;
  end: () => Promise<void>;
};

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
    msg.includes('cannot use a pool after calling end on the pool') ||
    msg.includes('connection terminated unexpectedly') ||
    msg.includes('connection terminated')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPool(): Pool {
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
  });

  pool.on('error', (err) => {
    console.error('[PG_POOL_ERROR]', err);
  });

  return pool;
}

function getActivePool(): Pool {
  const activePool = g.__LIQ_PG_POOL__ as Pool | undefined;
  if (!activePool || activePool.ended) {
    g.__LIQ_PG_POOL__ = createPool();
  }
  return g.__LIQ_PG_POOL__ as Pool;
}

async function disposePool(targetPool?: Pool): Promise<void> {
  if (!targetPool) return;
  if (g.__LIQ_PG_POOL__ === targetPool) {
    g.__LIQ_PG_POOL__ = undefined;
  }
  if (!targetPool.ended) {
    await targetPool.end();
  }
}

async function withFreshPool<T>(op: (activePool: Pool) => Promise<T>): Promise<T> {
  const activePool = getActivePool();
  try {
    return await op(activePool);
  } catch (err: any) {
    if (!isTransient(err) && !activePool.ended) {
      throw err;
    }
    await disposePool(activePool).catch(() => undefined);
    await sleep(250);
    return await op(getActivePool());
  }
}

if (!g.__LIQ_PG_SHUTDOWN_HOOKS__) {
  const shutdown = async () => {
    try {
      await disposePool(g.__LIQ_PG_POOL__ as Pool | undefined);
    } catch (err) {
      console.error('[PG_POOL_SHUTDOWN_ERROR]', err);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  g.__LIQ_PG_SHUTDOWN_HOOKS__ = true;
}

export const pool: PoolFacade = new Proxy({} as PoolFacade, {
  get(_target, prop) {
    if (prop === 'query') {
      return async (...args: any[]) =>
        withFreshPool((activePool) => {
          const query = activePool.query.bind(activePool) as (...queryArgs: any[]) => Promise<any>;
          return query(...args);
        });
    }
    if (prop === 'connect') {
      return async () => withFreshPool((activePool) => activePool.connect());
    }
    if (prop === 'end') {
      return async () => {
        await disposePool(g.__LIQ_PG_POOL__ as Pool | undefined);
      };
    }

    const activePool = getActivePool() as any;
    const value = activePool[prop as keyof Pool];
    return typeof value === 'function' ? value.bind(activePool) : value;
  },
});
