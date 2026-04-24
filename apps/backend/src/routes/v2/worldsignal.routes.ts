import { Router } from 'express';
import { ensureWorldsignalSidecarRunning } from '../../services/worldsignalSidecar';

const router = Router();
const WORLDSIGNAL_HEALTH_URL = 'http://127.0.0.1:3117/api/health';
const WORLDSIGNAL_TIMEOUT_MS = 2500;

type WorldsignalHealthResponse = {
  enabled: true;
  reachable: boolean;
  status: 'ok' | 'offline' | 'error';
  error?: string;
};

type WorldsignalDataResponse = {
  enabled: true;
  reachable: boolean;
  status: 'ok' | 'offline' | 'error';
  data?: unknown;
  error?: string;
};

const WORLDSIGNAL_DATA_URL = 'http://127.0.0.1:3117/api/data';

function isOfflineError(err: any): boolean {
  const code = String(err?.code || err?.cause?.code || '').toUpperCase();
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ETIMEDOUT' ||
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError'
  );
}

async function fetchJson(url: string, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
}

router.get('/health', async (_req, res) => {
  const base: WorldsignalHealthResponse = {
    enabled: true,
    reachable: false,
    status: 'offline',
  };

  try {
    await ensureWorldsignalSidecarRunning();
    let response: Response;
    try {
      response = await fetchJson(WORLDSIGNAL_HEALTH_URL, WORLDSIGNAL_TIMEOUT_MS);
    } catch (err: any) {
      if (!isOfflineError(err)) throw err;
      await ensureWorldsignalSidecarRunning();
      response = await fetchJson(WORLDSIGNAL_HEALTH_URL, WORLDSIGNAL_TIMEOUT_MS);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const payload: WorldsignalHealthResponse = {
        ...base,
        reachable: true,
        status: 'error',
        error: `http_${response.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
      };
      return res.json(payload);
    }

    return res.json({
      enabled: true,
      reachable: true,
      status: 'ok',
    } satisfies WorldsignalHealthResponse);
  } catch (err: any) {
    const message = String(err?.message || err || 'worldsignal_unreachable');
    const isOffline = isOfflineError(err);

    const payload: WorldsignalHealthResponse = {
      ...base,
      status: isOffline ? 'offline' : 'error',
      error: message,
    };
    return res.json(payload);
  }
});

router.get('/data', async (_req, res) => {
  const base: WorldsignalDataResponse = {
    enabled: true,
    reachable: false,
    status: 'offline',
  };

  try {
    await ensureWorldsignalSidecarRunning();
    let response: Response;
    try {
      response = await fetchJson(WORLDSIGNAL_DATA_URL, WORLDSIGNAL_TIMEOUT_MS);
    } catch (err: any) {
      if (!isOfflineError(err)) throw err;
      await ensureWorldsignalSidecarRunning();
      response = await fetchJson(WORLDSIGNAL_DATA_URL, WORLDSIGNAL_TIMEOUT_MS);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const payload: WorldsignalDataResponse = {
        ...base,
        reachable: true,
        status: response.status === 503 ? 'offline' : 'error',
        error: `http_${response.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
      };
      return res.json(payload);
    }

    const proxied = await response.json().catch(() => null);
    return res.json({
      enabled: true,
      reachable: true,
      status: 'ok',
      data: proxied,
    } satisfies WorldsignalDataResponse);
  } catch (err: any) {
    const message = String(err?.message || err || 'worldsignal_unreachable');
    const isOffline = isOfflineError(err);

    return res.json({
      ...base,
      status: isOffline ? 'offline' : 'error',
      error: message,
    } satisfies WorldsignalDataResponse);
  }
});

export default router;
