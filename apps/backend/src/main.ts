// apps/backend/src/main.ts

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';

// Routers
import healthRouter from './routes/health.routes';
import dbRouter from './routes/db.routes';
import cacheRouter from './routes/cache.routes';
import solRouter from './routes/sol.routes';

const app = express();
const port = Number(process.env.PORT ?? 4000);

// Middleware
app.use(bodyParser.json());

// Root route
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'backend',
    routes: ['/health', '/health/tools', '/db', '/cache', '/sol/execute'],
  });
});

// Mount routers
app.use('/health', healthRouter);
app.use('/db', dbRouter);
app.use('/cache', cacheRouter);
app.use('/sol', solRouter);

// Error handling middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', err);
  res.status(500).json({ error: msg });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
