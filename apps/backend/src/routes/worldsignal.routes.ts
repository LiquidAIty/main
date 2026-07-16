import { Router } from 'express';
import {
  ensureWorldsignalSidecarRunning,
  worldSignalsRuntimeUrls,
} from '../services/worldsignalSidecar';

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
  return res.json({
    enabled: true,
    status: backend ? 'ok' : 'offline',
    backend: { reachable: backend, url: worldSignalsRuntimeUrls.backend },
    ...(backend ? {} : { error: 'worldsignals_backend_unavailable' }),
  });
});

export default router;
