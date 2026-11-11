// Entity: WorldView
// Relationship: Serves the existing native provider middleware and public assets through one loopback production HTTP server.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import {
  createWorldViewHttpProviders,
  worldViewBrowserAccess,
} from '../../agent-products/gods-eye-view/vite.config.js';

const publicDirectory = fileURLToPath(new URL('../../agent-products/gods-eye-view/public/', import.meta.url));

export function createWorldViewServer() {
  const app = express();
  const server = createServer(app);
  const providers = createWorldViewHttpProviders();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const provider of providers) provider.dispose?.();
  };
  app.disable('x-powered-by');
  app.use(worldViewBrowserAccess);
  app.get(['/', '/health'], (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      service: 'worldview',
      providers: providers.map((provider) => provider.name),
    });
  });
  try {
    for (const provider of providers) provider.install(app, server);
  } catch (error) {
    dispose();
    throw error;
  }
  // Provider POST handlers own their raw body streams. Mount no body parser.
  app.use(express.static(publicDirectory, {
    dotfiles: 'deny',
    index: false,
    redirect: false,
    fallthrough: true,
    maxAge: '1h',
  }));
  app.use((_req, res) => res.status(404).json({ error: 'worldview_route_not_found' }));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error.status === 403 ? 403 : 500).json({ error: 'worldview_request_failed' });
  });
  server.on('close', dispose);
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.WORLDVIEW_PORT || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('WORLDVIEW_PORT must be an integer from 1 to 65535');
  }
  const server = createWorldViewServer();
  server.listen(port, '127.0.0.1', () => {
    console.info(`WorldView providers listening on http://127.0.0.1:${port}`);
  });
  const shutdown = () => {
    const forceClose = setTimeout(() => server.closeAllConnections(), 10_000);
    forceClose.unref();
    server.close((error) => {
      clearTimeout(forceClose);
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
