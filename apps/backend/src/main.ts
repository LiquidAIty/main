// apps/backend/src/main.ts

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import solRoutes from './routes/sol.routes';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Simple health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// Mount SOL routes under /api/sol
app.use('/api/sol', solRoutes);

// Error handling middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    ok: false,
    executed: false,
    results: { __final__: msg },
    combined: msg
  });
});

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
});
