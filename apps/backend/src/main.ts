// apps/backend/src/main.ts

import 'dotenv/config';
import express, { Request, Response } from 'express';

import dbRouter from './routes/db.routes';
import cacheRouter from './routes/cache.routes';

const app = express();
const port = Number(process.env.PORT) || 3000;

// Middleware
app.use(express.json());

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Sprint 2 Endpoints
app.use('/db-health', dbRouter);
app.use('/cache-ping', cacheRouter);

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/health`);
});
