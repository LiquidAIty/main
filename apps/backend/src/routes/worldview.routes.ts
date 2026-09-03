import { Router } from 'express';

const DEFAULT_GLOBE_URL = 'http://127.0.0.1:4174';

type FetchLike = typeof fetch;

export function resolveWorldviewGlobeUrl(
  value = process.env.WORLDVIEW_GLOBE_URL || DEFAULT_GLOBE_URL,
): URL {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('worldview_globe_url_must_be_loopback_http');
  }
  return url;
}

export function createWorldviewRouter({ fetcher = fetch }: { fetcher?: FetchLike } = {}) {
  const router = Router();

  router.get('/readiness', async (_req, res) => {
    let globeUrl: URL;
    try {
      globeUrl = resolveWorldviewGlobeUrl();
    } catch (error) {
      return res.status(503).json({
        status: 'offline',
        diagnostics: error instanceof Error ? error.message : 'worldview_globe_url_invalid',
      });
    }
    try {
      const response = await fetcher(globeUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) throw new Error(`worldview_globe_http_${response.status}`);
      return res.json({
        status: 'ready',
        adapter: {
          kind: 'python',
          contractVersion: 'card-subsystem.v1',
          presentationOrigin: globeUrl.origin,
        },
        lifecycle: {
          ownership: 'supervised-upstream',
          automaticStart: false,
        },
        nativeAgents: {
          realtimeVoice: {
            policy: 'user-initiated',
            active: null,
            runtimeState: 'ui-handshake-required',
          },
        },
        diagnostics: null,
      });
    } catch (error) {
      return res.status(503).json({
        status: 'offline',
        adapter: {
          kind: 'python',
          contractVersion: 'card-subsystem.v1',
          presentationOrigin: globeUrl.origin,
        },
        lifecycle: { ownership: 'supervised-upstream', automaticStart: false },
        nativeAgents: {
          realtimeVoice: { policy: 'user-initiated', active: null },
        },
        diagnostics: error instanceof Error ? error.message : 'worldview_globe_unavailable',
      });
    }
  });

  return router;
}

export default createWorldviewRouter();
