// apps/backend/src/app.ts
import express from 'express';
import dotenv from 'dotenv';

// 1) Load .env from apps/backend/.env
dotenv.config();

import dbRouter from './routes/db.routes';
import cacheRouter from './routes/cache.routes';

const app = express();
app.use(express.json());

// 2) Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 3) Mount Sprint 2 routes
app.use('/db-health', dbRouter);
app.use('/cache-ping', cacheRouter);

// 4) Start server
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/health`);
});

export default app;
