/**
 * Backend readiness gate for dev startup.
 *
 * Problem: Vite is ready in ~1.5s but the backend (nx clean → build → serve →
 * compile → boot) takes ~60-70s. During that window, boot-time fetches
 * (projects list, deck load, session history, harness events) hit ECONNREFUSED
 * and Vite logs every failed proxy attempt as a red `[vite] http proxy error`.
 *
 * This gate polls the backend's synchronous health root (`GET /api/health/`,
 * which returns `{status:'ok'}` the instant Express listens — before any DB /
 * Neo4j / ESN dependency) with bounded backoff, and resolves once it is up.
 * Callers await it before their first real fetch so requests only fire when
 * the backend can actually answer, eliminating the startup error spam WITHOUT
 * suppressing real outages: a non-ECONNREFUSED error (or a timeout after the
 * bounded window) still surfaces as a real failure.
 *
 * Truthful, not cosmetic:
 *  - ECONNREFUSED / network errors during the window → retry (backend starting).
 *  - Any HTTP response (even 5xx) → backend is listening → resolve immediately
 *    and let the caller's real request surface the actual error.
 *  - AbortSignal respected so effect cleanup cancels a pending wait.
 *  - No global proxy-error suppression, no hidden fallback, no fake success.
 */

const HEALTH_URL = '/api/health/';
const INITIAL_POLL_MS = 500;
const MAX_POLL_MS = 3_000;
const BACKOFF = 1.5;
const DEFAULT_TIMEOUT_MS = 60_000;

export type WaitForBackendOptions = {
  signal?: AbortSignal;
  /** Hard cap on how long to wait before resolving false. Defaults to 60s. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchHealth?: () => Promise<boolean>;
};

async function defaultFetchHealth(): Promise<boolean> {
  try {
    // cache:'no-store' so a stale 304 during boot can't fake readiness.
    const response = await fetch(HEALTH_URL, { cache: 'no-store' });
    // Any HTTP response means the backend is listening. The health root itself
    // returns 200 {status:'ok'}, but we resolve on any status so a 500 still
    // unblocks the caller to hit the real endpoint and surface the real error
    // rather than spinning here indefinitely on a half-alive server.
    return true;
  } catch {
    // ECONNREFUSED, DNS, net error → backend not listening yet → keep waiting.
    return false;
  }
}

/**
 * Resolves true once the backend responds to /api/health/, or false if the
 * bounded timeout elapses (caller should then proceed and surface the real
 * failure). Resolves immediately if the signal aborts.
 */
export async function waitForBackendReady(
  options: WaitForBackendOptions = {},
): Promise<boolean> {
  const { signal, fetchHealth = defaultFetchHealth } = options;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let delay = INITIAL_POLL_MS;

  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    const up = await fetchHealth();
    if (up) return true;
    if (signal?.aborted) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), delay);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    delay = Math.min(MAX_POLL_MS, Math.round(delay * BACKOFF));
  }
  return false;
}
