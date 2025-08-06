// apps/backend/src/main.ts

import 'dotenv/config';
import express, { Request, Response } from 'express';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/health`);
});
