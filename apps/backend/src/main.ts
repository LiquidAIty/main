// apps/backend/src/main.ts

import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import solRoutes from './routes/sol.routes';
import { agentRoutes } from './routes/agent.routes';
import threadsRouter from './routes/threads.routes';
import mcpRouter from './routes/mcp.routes';
import healthRouter from './routes/health.routes';
import uiToolsRouter from './routes/ui.tools.routes';
import uiGraphRouter from './routes/ui.graph.routes';
import streamRouter from './routes/stream.routes';
import { unifiedToolsRoutes } from './routes/u.tools.routes';
import { unifiedPlaybookRoutes } from './routes/u.playbooks.routes';

// Load .env deterministically from repo root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();

// Log API key prefix to verify new key is loaded
const mask = (s?: string) => (s ? s.slice(0, 10) + '…' : '(unset)');
console.log('[ENV] OPENAI_API_KEY =', mask(process.env.OPENAI_API_KEY));
console.log('[ENV] OPENAI_ORG     =', process.env.OPENAI_ORG || '(unset)');
console.log('[ENV] NODE_ENV       =', process.env.NODE_ENV || '(unset)');
console.log('[ENV] OPENAI_PROJECT =', process.env.OPENAI_PROJECT || '(unset)');

const allowList = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const corsMw = cors({
  origin: (origin, cb) => {
    if (!origin || allowList.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  credentials: true
});

const limiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_MAX ?? 120),
  standardHeaders: true,
  legacyHeaders: false
});

// apply **before** routes
app.use(corsMw);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

app.use('/api/agent', limiter as any);
app.use('/threads', limiter as any);

// Root route
app.get('/', (_req, res) => res.send('Backend OK. See /health.'));

// Health check + metrics
app.use('/', healthRouter);

// API routes
app.use('/api/sol', solRoutes);
app.use('/api/agent', agentRoutes);
app.use('/', threadsRouter); // LangGraph threads API
app.use('/', mcpRouter); // MCP tools API
app.use('/', uiToolsRouter);
app.use('/', uiGraphRouter);
app.use('/', streamRouter);
app.use('/api', unifiedToolsRoutes);
app.use('/api', unifiedPlaybookRoutes);

const port = Number(process.env.PORT) || 4000;
if (!port) throw new Error('PORT is not defined');

export function startServer() {
  const server = app.listen(port, () => {
    console.log(`[BOOT] Backend server running at http://localhost:${port}`);
    console.log(`[BOOT] Health check: http://localhost:${port}/health`);
    console.log(`[BOOT] CORS origins: ${allowList.join(', ') || 'none'}`);
    console.log(`[BOOT] OpenAI key: ${process.env.OPENAI_API_KEY ? 'Set' : 'Missing'}`);
  });
  return server;
}

const isMainModule = typeof require !== 'undefined' && require.main === module;
if (isMainModule) {
  startServer();
}

export { app };
export default app;
