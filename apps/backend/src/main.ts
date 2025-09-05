// apps/backend/src/main.ts

import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import solRoutes from './routes/sol.routes';
import { agentRoutes } from './routes/agent.routes';

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

// apply **before** routes
app.use(corsMw);
// make sure any path responds to OPTIONS - Express handles this automatically via app.use(corsMw)

app.use(express.json());

// Root route
app.get('/', (_req, res) => res.send('Backend OK. See /health.'));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
app.use('/api/sol', solRoutes);
app.use('/api/agent', agentRoutes);

const port = Number(process.env.PORT) || 4000;
if (!port) throw new Error('PORT is not defined');

app.listen(port, () => {
  console.log(`[BOOT] Backend server running at http://localhost:${port}`);
  console.log(`[BOOT] Health check: http://localhost:${port}/health`);
  console.log(`[BOOT] CORS origins: ${allowList.join(', ') || 'none'}`);
  console.log(`[BOOT] OpenAI key: ${process.env.OPENAI_API_KEY ? 'Set' : 'Missing'}`);
});

export default app;
