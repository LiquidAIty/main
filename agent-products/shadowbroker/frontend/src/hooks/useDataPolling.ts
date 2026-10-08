import { useEffect, useRef } from "react";
import { API_BASE } from "@/lib/api";
import { mergeData, setBackendStatus as setStoreBackendStatus } from "./useDataStore";
import { appendLiveDataBoundsParams, liveDataBoundsKey } from "@/lib/liveDataViewport";
import { VIEWPORT_COMMITTED_EVENT } from "@/components/map/hooks/useViewportBounds";

export type BackendStatus = 'connecting' | 'connected' | 'disconnected';

// ---------------------------------------------------------------------------
// Polling pause/resume — used by Time Machine snapshot playback
// ---------------------------------------------------------------------------
let _pollingPaused = false;
let _fastEtagRef: { current: string | null } | null = null;
let _slowEtagRef: { current: string | null } | null = null;

/** Pause live data polling (snapshot mode). */
export function pausePolling() {
  _pollingPaused = true;
}

/** Resume live data polling and invalidate ETags for a full refresh. */
export function resumePolling() {
  _pollingPaused = false;
  // Invalidate ETags so the next poll gets fresh data (not 304)
  if (_fastEtagRef) _fastEtagRef.current = null;
  if (_slowEtagRef) _slowEtagRef.current = null;
}

/** Resume live mode and fetch both live tiers immediately instead of waiting for the next poll tick. */
export async function forceRefreshLiveData(): Promise<void> {
  _pollingPaused = false;
  if (_fastEtagRef) _fastEtagRef.current = null;
  if (_slowEtagRef) _slowEtagRef.current = null;

  try {
    const [fastRes, slowRes] = await Promise.all([
      fetch(appendLiveDataBoundsParams(`${API_BASE}/api/live-data/fast`)),
      fetch(appendLiveDataBoundsParams(`${API_BASE}/api/live-data/slow`)),
    ]);

    if (fastRes.ok) {
      if (_fastEtagRef) _fastEtagRef.current = fastRes.headers.get('etag') || null;
      mergeData(await fastRes.json());
    }
    if (slowRes.ok) {
      if (_slowEtagRef) _slowEtagRef.current = slowRes.headers.get('etag') || null;
      mergeData(await slowRes.json());
    }
    if (fastRes.ok || slowRes.ok) {
      setStoreBackendStatus('connected');
    }
  } catch (e) {
    console.error("Failed forcing live data refresh", e);
    setStoreBackendStatus('disconnected');
  }
}
type FastDataProbe = {
  commercial_flights?: unknown[];
  military_flights?: unknown[];
  tracked_flights?: unknown[];
  ships?: unknown[];
  sigint?: unknown[];
  cctv?: unknown[];
  news?: unknown[];
  threat_level?: unknown;
};

function hasMeaningfulFastData(json: FastDataProbe): boolean {
  return (
    (json.commercial_flights?.length || 0) > 100 ||
    (json.military_flights?.length || 0) > 25 ||
    (json.tracked_flights?.length || 0) > 10 ||
    (json.ships?.length || 0) > 100 ||
    (json.sigint?.length || 0) > 100 ||
    (json.cctv?.length || 0) > 100
  );
}

/**
 * Event name dispatched by page.tsx when a layer toggle changes.
 * useDataPolling listens for this to immediately refetch slow-tier data
 * so toggled layers (power plants, GDELT, etc.) appear without the usual
 * 120-second wait.
 */
export const LAYER_TOGGLE_EVENT = 'sb:layer-toggle';

/** Debounce rapid pans; min gap keeps viewport refetches under the 120/min rate limit. */
const VIEWPORT_FAST_REFETCH_DEBOUNCE_MS = 400;
const VIEWPORT_FAST_REFETCH_MIN_INTERVAL_MS = 2500;

/**
 * Polls the backend for fast and slow data tiers.
 *
 * Issue #288: heavy, density-driven layers (vessels, aircraft, gdelt
 * events, fires, sigint, …) are bbox-scoped to the visible map area via
 * `appendLiveDataBoundsParams`. Static reference layers (datacenters,
 * military bases, power plants, satellites, weather, news, …) are NOT
 * filtered backend-side, so panning never reveals an "empty world" of
 * infrastructure. World-zoomed views skip bbox params entirely and hit
 * the shared ETag cache exactly like the pre-#288 behaviour.
 *
 * Viewport commits trigger a debounced fast-tier refetch so regional pans
 * refill aircraft/ships without waiting for the 15s poll cadence.
 *
 * The AIS stream viewport POST (/api/viewport) is still handled separately
 * by useViewportBounds to limit upstream AIS ingestion.
 */
export function useDataPolling() {
  const fastEtag = useRef<string | null>(null);
  const slowEtag = useRef<string | null>(null);

  useEffect(() => {
    // Expose refs so pausePolling/resumePolling can invalidate ETags
    _fastEtagRef = fastEtag;
    _slowEtagRef = slowEtag;

    let hasData = false;
    let fetchedStartupFastPayload = false;
    let fastTimerId: ReturnType<typeof setTimeout> | null = null;
    let slowTimerId: ReturnType<typeof setTimeout> | null = null;
    let viewportDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const fastAbortRef = { current: null as AbortController | null };
    const slowAbortRef = { current: null as AbortController | null };
    const fastFetchGenRef = { current: 0 };
    let lastViewportFetchKey: string | null = null;
    let lastViewportFetchAt = 0;

    const fetchCriticalBootstrap = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/bootstrap/critical`, {
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          setStoreBackendStatus('connected');
          const json = await res.json();
          mergeData(json);
          if (hasMeaningfulFastData(json) || (json.news?.length || 0) > 0 || json.threat_level) {
            hasData = true;
          }
        }
      } catch (e) {
        const aborted =
          typeof e === 'object' &&
          e !== null &&
          'name' in e &&
          (e as { name?: string }).name === 'AbortError';
        if (!aborted) {
          console.warn("Critical bootstrap fetch will retry via live polling", e);
        }
      }
    };

    const abortInFlightFastFetch = () => {
      if (fastAbortRef.current) {
        fastAbortRef.current.abort();
        fastAbortRef.current = null;
      }
    };

    const fetchFastData = async () => {
      if (fastTimerId) {
        clearTimeout(fastTimerId);
        fastTimerId = null;
      }
      // Skip fetch when Time Machine snapshot mode is active
      if (_pollingPaused) { scheduleNext('fast'); return; }

      abortInFlightFastFetch();
      const controller = new AbortController();
      fastAbortRef.current = controller;
      const fetchGen = ++fastFetchGenRef.current;

      try {
        const useStartupPayload = !fetchedStartupFastPayload && !fastEtag.current;
        const headers: Record<string, string> = {};
        if (!useStartupPayload && fastEtag.current) headers['If-None-Match'] = fastEtag.current;
        const url = appendLiveDataBoundsParams(
          `${API_BASE}/api/live-data/fast${useStartupPayload ? '?initial=1' : ''}`,
        );
        const res = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        if (fetchGen !== fastFetchGenRef.current) return;
        if (res.status === 304) {
          setStoreBackendStatus('connected');
          scheduleNext('fast', fetchGen);
          return;
        }
        if (res.ok) {
          setStoreBackendStatus('connected');
          // Do not keep the capped startup ETag. The next steady poll should
          // request the full fast dataset and replace the representative first paint.
          fastEtag.current = useStartupPayload ? null : res.headers.get('etag') || null;
          if (useStartupPayload) fetchedStartupFastPayload = true;
          const json = await res.json();
          if (fetchGen !== fastFetchGenRef.current) return;
          mergeData(json);
          if (hasMeaningfulFastData(json)) hasData = true;
        }
      } catch (e) {
        const aborted =
          typeof e === 'object' &&
          e !== null &&
          'name' in e &&
          (e as { name?: string }).name === 'AbortError';
        if (!aborted) {
          console.warn("Fast live data fetch will retry after runtime is reachable", e);
          setStoreBackendStatus('disconnected');
        }
      } finally {
        if (fastAbortRef.current === controller) {
          fastAbortRef.current = null;
        }
      }
      scheduleNext('fast', fetchGen);
    };

    const fetchSlowData = async () => {
      if (_pollingPaused) { scheduleNext('slow'); return; }
      if (slowAbortRef.current) return;
      const controller = new AbortController();
      slowAbortRef.current = controller;
      try {
        const headers: Record<string, string> = {};
        if (slowEtag.current) headers['If-None-Match'] = slowEtag.current;
        const res = await fetch(
          appendLiveDataBoundsParams(`${API_BASE}/api/live-data/slow`),
          {
            headers,
            signal: controller.signal,
          },
        );
        if (res.status === 304) { scheduleNext('slow'); return; }
        if (res.ok) {
          slowEtag.current = res.headers.get('etag') || null;
          const json = await res.json();
          mergeData(json);
        }
      } catch (e) {
        const aborted =
          typeof e === 'object' &&
          e !== null &&
          'name' in e &&
          (e as { name?: string }).name === 'AbortError';
        if (!aborted) {
          console.warn("Slow live data fetch will retry after runtime is reachable", e);
        }
      } finally {
        if (slowAbortRef.current === controller) {
          slowAbortRef.current = null;
        }
      }
      scheduleNext('slow');
    };

    // Adaptive polling: retry every 3s during startup, back off to normal cadence once data arrives
    const scheduleNext = (tier: 'fast' | 'slow', fetchGen?: number) => {
      if (tier === 'fast') {
        if (fetchGen !== undefined && fetchGen !== fastFetchGenRef.current) return;
        const delay = hasData ? 15000 : 3000; // 3s startup retry → 15s steady state
        const needsFullFastPayload = fetchedStartupFastPayload && !fastEtag.current;
        fastTimerId = setTimeout(fetchFastData, needsFullFastPayload ? 750 : delay);
      } else {
        const delay = hasData ? 120000 : 5000; // 5s startup retry → 120s steady state
        slowTimerId = setTimeout(fetchSlowData, delay);
      }
    };

    const queueViewportFastRefetch = () => {
      if (_pollingPaused) return;

      const key = liveDataBoundsKey();
      if (!key) {
        lastViewportFetchKey = null;
        return;
      }
      if (key === lastViewportFetchKey) return;

      if (viewportDebounceTimer) clearTimeout(viewportDebounceTimer);
      viewportDebounceTimer = setTimeout(() => {
        viewportDebounceTimer = null;
        if (_pollingPaused) return;

        const currentKey = liveDataBoundsKey();
        if (!currentKey || currentKey === lastViewportFetchKey) return;

        const now = Date.now();
        if (now - lastViewportFetchAt < VIEWPORT_FAST_REFETCH_MIN_INTERVAL_MS) return;

        lastViewportFetchKey = currentKey;
        lastViewportFetchAt = now;
        fastEtag.current = null;
        void fetchFastData();
      }, VIEWPORT_FAST_REFETCH_DEBOUNCE_MS);
    };

    // When a layer toggle fires, refetch live tiers immediately and retry a few
    // times so network-heavy on-enable fetches (FIRMS, PSK, …) can finish in the
    // background without blocking POST /api/layers on the single API worker.
    const onLayerToggle = () => {
      slowEtag.current = null;
      fastEtag.current = null;
      if (slowTimerId) clearTimeout(slowTimerId);
      slowTimerId = null;
      void fetchFastData();
      void fetchSlowData();
      const retryDelaysMs = [1000, 2500, 5000];
      for (const delay of retryDelaysMs) {
        setTimeout(() => {
          if (_pollingPaused) return;
          slowEtag.current = null;
          fastEtag.current = null;
          void fetchSlowData();
          void fetchFastData();
        }, delay);
      }
    };
    window.addEventListener(LAYER_TOGGLE_EVENT, onLayerToggle);
    window.addEventListener(VIEWPORT_COMMITTED_EVENT, queueViewportFastRefetch);

    void (async () => {
      await fetchCriticalBootstrap();
      fetchFastData();
      // Let the bootstrap/fast payload paint before competing with the slow tier.
      slowTimerId = setTimeout(fetchSlowData, 5000);
    })();

    return () => {
      window.removeEventListener(LAYER_TOGGLE_EVENT, onLayerToggle);
      window.removeEventListener(VIEWPORT_COMMITTED_EVENT, queueViewportFastRefetch);
      if (fastTimerId) clearTimeout(fastTimerId);
      if (slowTimerId) clearTimeout(slowTimerId);
      if (viewportDebounceTimer) clearTimeout(viewportDebounceTimer);
      abortInFlightFastFetch();
      if (slowAbortRef.current) slowAbortRef.current.abort();
    };
  }, []);

  // Data and backend status are now accessed via useDataStore hooks
  // (useDataKey, useDataKeys, useDataSnapshot, useBackendStatus).
  // This hook is a pure side-effect — it starts polling and writes to the store.
}
