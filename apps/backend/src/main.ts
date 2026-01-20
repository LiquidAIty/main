import express from "express";
import dotenv from "dotenv";
import cookieParser = require("cookie-parser");
import routes from "./routes";
import { logModelConfiguration } from "./startup/modelConfig";

dotenv.config({ path: "apps/backend/.env" });

const app = express();

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  return next();
});

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser() as any);

// Debug logging for non-GET requests to /api/projects
app.use((req, _res, next) => {
  if (req.path.includes('/api/projects') && req.method !== 'GET') {
    console.log('[REQ]', req.method, req.path);
  }
  next();
});

// Ensure all responses are JSON
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  return next();
});

function logStartupBanner() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const model = process.env.OPENAI_MODEL || "gpt-5.1-chat-latest";
  const baseUrl = process.env.OPENAI_BASE_URL || "(default)";
  const apiKey = process.env.OPENAI_API_KEY || "";
  const redactedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "(not set)";

  // Parse DATABASE_URL to show connection details
  const dbUrl = process.env.DATABASE_URL || 'postgresql://liquidaity-user:***@localhost:5433/liquidaity';
  let dbHost = 'localhost';
  let dbPort = '5433';
  let dbName = 'liquidaity';
  let dbUser = 'liquidaity-user';
  try {
    const url = new URL(dbUrl);
    dbHost = url.hostname;
    dbPort = url.port || '5432';
    dbName = url.pathname.slice(1).split('?')[0];
    dbUser = url.username;
  } catch {
    // fallback already set
  }

  console.log("──────────────── SOL BACKEND START ────────────────");
  console.log(`NODE_ENV:         ${nodeEnv}`);
  console.log(`SOL model:        ${model}`);
  console.log(`OPENAI_BASE_URL:  ${baseUrl}`);
  console.log(`OPENAI_API_KEY:   ${redactedKey}`);
  console.log(`DB_HOST:          ${dbHost}`);
  console.log(`DB_PORT:          ${dbPort}`);
  console.log(`DB_NAME:          ${dbName}`);
  console.log(`DB_USER:          ${dbUser}`);
  console.log("───────────────────────────────────────────────────");
}

// Mount all routes under /api
app.use("/api", routes);

// Add final error middleware to surface stack as JSON (must be after routes)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.error(`[ERROR] ${requestId}`, {
    method: req.method,
    path: req.path,
    status: 500,
    message: err?.message,
    name: err?.name,
    stack: err?.stack,
  });
  res.status(500).json({ 
    ok: false, 
    error: { 
      message: err?.message || 'Internal server error', 
      name: err?.name || 'Error' 
    },
    requestId 
  });
});

const PORT = Number(process.env.PORT || 4000);
logStartupBanner();
void logModelConfiguration();
app.listen(PORT, () => console.log("[BOOT] listening on :" + PORT));
