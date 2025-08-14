// apps/backend/src/main.ts

import 'dotenv/config';
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { healthRouter } from './routes/health.routes';
import { solRouter } from './routes/sol.routes';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3333;

// Middleware
app.use(bodyParser.json());

// Routes
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/health', healthRouter);
app.use('/agents/sol', solRouter);

// Error handling
app.use((err: unknown, _req: Request, res: Response, _next: any) => {
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  res.status(500).json({ error: errorMessage });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
