// apps/backend/src/main.ts

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';

// Routers
import routes from './routes';

const app = express();
const port = Number(process.env.PORT ?? 4000);

// Middleware
app.use(bodyParser.json());

// Root route
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'backend',
    routes: [
      '/api/health',
      '/api/sol/execute',
      '/api/sol/tools',
      '/api/sol/try',
      '/api/sol/run',
      '/api/sol/route',
      '/api/tools/:name',
      '/api/try/:name',
      '/api/mcp/catalog',
      '/api/mcp/catalog/:category',
      '/api/mcp/catalog/find?name=...'
    ],
  });
});

// Single mount point for all routes
app.use('/api', routes);

// Error handling middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', err);
  res.status(500).json({ error: msg });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
