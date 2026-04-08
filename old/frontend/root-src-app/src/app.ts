// apps/backend/src/app.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// 1) Load .env from apps/backend/.env
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 2) Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 4) Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;
