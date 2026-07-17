import { Router } from 'express';
import {
  ensureWorldsignalSidecarRunning,
  worldSignalsRuntimeUrls,
} from '../services/worldsignalSidecar';
import { resolveEmbedBundleFreshness } from '../services/worldsignalsEmbedFreshness';

const router = Router();

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok;
  } catch {
    return false;
  }
}

router.get('/health', async (_req, res) => {
  const enabled = String(process.env.WORLDSIGNALS_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    return res.json({
      enabled: false,
      status: 'offline',
      backend: { reachable: false, url: worldSignalsRuntimeUrls.backend },
    });
  }

  await ensureWorldsignalSidecarRunning();
  const backend = await reachable(`${worldSignalsRuntimeUrls.backend}/api/health`);
  // WS-7: report the embed bundle's freshness honestly (missing / stale / fresh)
  // so a vendor source edit that was never rebuilt is visible, not silently served.
  const embedBundle = resolveEmbedBundleFreshness();
  return res.json({
    enabled: true,
    status: backend ? 'ok' : 'offline',
    backend: { reachable: backend, url: worldSignalsRuntimeUrls.backend },
    embedBundle: { status: embedBundle.status, message: embedBundle.message },
    ...(backend ? {} : { error: 'worldsignals_backend_unavailable' }),
  });
});

export default router;
