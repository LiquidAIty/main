/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: WorldSignals
 * Relationship: WorldSignals reports whether its backend and embedded client bundle are available, preserving disabled, offline, and error states for the UI.
 */

import { Router } from 'express';
import { resolveEmbedBundleFreshness } from '../services/worldsignalsEmbedFreshness';

const router = Router();
const WORLD_SIGNALS_BACKEND_URL = process.env.WORLDSIGNALS_BACKEND_URL || 'http://127.0.0.1:8000';

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok;
  } catch {
    return false;
  }
}

router.get('/health', async (_req, res) => {
  try {
    const enabled = String(process.env.WORLDSIGNALS_ENABLED || 'true').toLowerCase() !== 'false';
    if (!enabled) {
      return res.json({
        enabled: false,
        status: 'offline',
        backend: { reachable: false, url: WORLD_SIGNALS_BACKEND_URL },
      });
    }

    const backend = await reachable(`${WORLD_SIGNALS_BACKEND_URL}/api/health`);
    const embedBundle = resolveEmbedBundleFreshness();
    return res.json({
      enabled: true,
      status: backend ? 'ok' : 'offline',
      backend: { reachable: backend, url: WORLD_SIGNALS_BACKEND_URL },
      embedBundle: { status: embedBundle.status, message: embedBundle.message },
      ...(backend ? {} : { error: 'worldsignals_backend_unavailable' }),
    });
  } catch (error) {
    return res.status(503).json({
      enabled: true,
      status: 'error',
      backend: { reachable: false, url: WORLD_SIGNALS_BACKEND_URL },
      error: error instanceof Error ? error.message : 'worldsignals_health_unavailable',
    });
  }
});

export default router;
