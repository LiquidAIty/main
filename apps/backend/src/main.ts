import express from "express";
import dotenv from "dotenv";
import type { Server } from "node:http";
import cookieParser = require("cookie-parser");
import routes from "./routes";
import { logModelConfiguration } from "./startup/modelConfig";
import { getDevTestJsonBodyLimit } from "./services/devTest";
import { getAllowedCorsOrigins } from "./security/requestAccess";

dotenv.config({ path: "apps/backend/.env" });

const app = express();
app.set('etag', false);

const allowedCorsOrigins = new Set(getAllowedCorsOrigins());

// CORS middleware
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  }
  if (!allowedCorsOrigins.has(origin)) {
    return res.status(403).json({ ok: false, error: 'cors_origin_not_allowed' });
  }
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Bootstrap-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use(express.json({ limit: getDevTestJsonBodyLimit() }));
app.use(cookieParser() as any);

// Disable caching for API responses to avoid 304/empty body JSON issues
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  return next();
});

// Debug logging for non-GET requests to active project/deck routes.
app.use((req, _res, next) => {
  if ((req.path.includes('/api/v2/projects') || req.path.includes('/api/v3/projects')) && req.method !== 'GET') {
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

  console.log("────────────── LIQUIDAITY BACKEND START ─────────────");
  console.log(`NODE_ENV:         ${nodeEnv}`);
  console.log(`Runtime model:    ${model}`);
  console.log(`OPENAI_BASE_URL:  ${baseUrl}`);
  console.log(`OPENAI_API_KEY:   ${redactedKey}`);
  console.log(`DB_HOST:          ${dbHost}`);
  console.log(`DB_PORT:          ${dbPort}`);
  console.log(`DB_NAME:          ${dbName}`);
  console.log(`DB_USER:          ${dbUser}`);
  console.log("───────────────────────────────────────────────────");
}

declare global {
  // Preserve a single backend listener across in-process watch reloads.
  var __liquidaityBackendServer__: Server | undefined;
  var __liquidaityBackendShutdownHooksInstalled__: boolean | undefined;
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function formatListenError(error: unknown, port: number): string {
  const err = error as NodeJS.ErrnoException | undefined;
  if (err?.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Another backend process is already listening on this port. Stop the existing process or restart with a different PORT.`;
  }
  if (err?.code === 'EACCES') {
    return `Port ${port} requires elevated privileges or is blocked by system policy.`;
  }
  return err?.message || `Failed to listen on port ${port}.`;
}

function listenOnPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onListening = () => {
      cleanup();
      console.log("[BOOT] listening on :" + port);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
  });
}

function installShutdownHooks() {
  if (globalThis.__liquidaityBackendShutdownHooksInstalled__) {
    return;
  }
  globalThis.__liquidaityBackendShutdownHooksInstalled__ = true;

  const shutdown = async () => {
    const activeServer = globalThis.__liquidaityBackendServer__;
    if (!activeServer) return;
    try {
      await closeServer(activeServer);
    } catch {
      // ignore shutdown close errors
    } finally {
      if (globalThis.__liquidaityBackendServer__ === activeServer) {
        globalThis.__liquidaityBackendServer__ = undefined;
      }
    }
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

async function startServer() {
  const existingServer = globalThis.__liquidaityBackendServer__;
  if (existingServer) {
    await closeServer(existingServer).catch(() => undefined);
    if (globalThis.__liquidaityBackendServer__ === existingServer) {
      globalThis.__liquidaityBackendServer__ = undefined;
    }
  }

  logStartupBanner();
  void logModelConfiguration();

  let server: Server;
  try {
    server = await listenOnPort(PORT);
  } catch (error) {
    console.error("[BOOT] " + formatListenError(error, PORT));
    const err = error as NodeJS.ErrnoException | undefined;
    if (err?.code !== 'EADDRINUSE') {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  server.on('close', () => {
    if (globalThis.__liquidaityBackendServer__ === server) {
      globalThis.__liquidaityBackendServer__ = undefined;
    }
  });
  globalThis.__liquidaityBackendServer__ = server;
  installShutdownHooks();
}

// Mount all routes under /api
app.use("/api", routes);

// Add final error middleware to surface stack as JSON (must be after routes)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const isJsonParseError =
    err?.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && typeof err?.message === 'string' && /json/i.test(err.message));
  if (isJsonParseError) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_json',
    });
  }

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.error(`[ERROR] ${requestId}`, {
    method: req.method,
    path: req.path,
    status: 500,
    message: err?.message,
    name: err?.name,
    stack: err?.stack,
  });
  return res.status(500).json({ 
    ok: false, 
    error: { 
      message: err?.message || 'Internal server error', 
      name: err?.name || 'Error' 
    },
    requestId 
  });
});

const PORT = Number(process.env.PORT || 4000);
void startServer();
