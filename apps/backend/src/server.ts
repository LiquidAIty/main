/**
 * LiquidAIty Backend Server
 */

import express from 'express';
import dotenv from 'dotenv';
import knowledgeGraphRouter from './api/kg/knowledge-graph.js';
import reportController from './api/reports/reportController.js';
import solRouter from './api/sol/sol.js';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  return next();
});

// API routes
app.use('/api/kg', knowledgeGraphRouter);
app.use('/api/reports', reportController);
app.use('/api/sol', solRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  return res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(port, () => {
  console.log(`LiquidAIty backend server running on port ${port}`);
  console.log(`Health check available at http://localhost:${port}/health`);
  console.log(`Knowledge Graph API available at http://localhost:${port}/api/kg`);
  console.log(`Reports API available at http://localhost:${port}/api/reports`);
  console.log(`SOL API available at http://localhost:${port}/api/sol`);
});

export default app;
