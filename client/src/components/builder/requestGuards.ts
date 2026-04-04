export type GuardedRequestOptions<T> = {
  key: string;
  method?: string;
  ttlMs?: number;
  dedupe?: boolean;
  bypassCache?: boolean;
  signal?: AbortSignal;
  fetcher: (signal: AbortSignal) => Promise<T>;
};

export type CachedGraphPayload = {
  updatedAt: number;
  cypher: string;
  graphResult: any[];
  knowGraphData: { nodes: any[]; relationships: any[] };
};

const requestGuardInFlight = new Map<string, Promise<any>>();
const requestGuardCache = new Map<string, { expiresAt: number; value: any }>();
const requestGuardSeq = new Map<string, number>();

export async function safeJson(res: Response): Promise<any | null> {
  if (res.status === 204 || res.status === 304) return null;
  let text = "";
  try {
    text = await res.text();
  } catch {
    console.warn("[safeJson] failed to read body", { status: res.status, url: res.url });
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err: any) {
    console.warn("[safeJson] invalid JSON", { status: res.status, url: res.url, error: err?.message || err });
    return null;
  }
}

export async function readJsonAndText(res: Response): Promise<{ data: any | null; text: string }> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { data: null, text: "" };
  }
  if (!text) return { data: null, text: "" };
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null, text };
  }
}

export function formatRequestErrorLine(endpoint: string, status: number, bodyPreview: string): string {
  const compactBody = String(bodyPreview || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${endpoint} | ${status} | ${compactBody || "no response body"}`;
}

function makeAbortError() {
  const error = new Error("Request aborted") as Error & { name: string };
  error.name = "AbortError";
  return error;
}

export function isAbortLikeError(err: any): boolean {
  const name = String(err?.name || "");
  const message = String(err?.message || "");
  return name === "AbortError" || message.toLowerCase().includes("aborted");
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(makeAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

function linkAbortSignal(externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  if (!externalSignal) return { signal: controller.signal, cleanup: () => {} };
  if (externalSignal.aborted) {
    controller.abort();
    return { signal: controller.signal, cleanup: () => {} };
  }
  const onAbort = () => controller.abort();
  externalSignal.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => externalSignal.removeEventListener("abort", onAbort),
  };
}

export async function guardedRequest<T>(options: GuardedRequestOptions<T>): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const ttlMs = options.ttlMs || 0;
  const canCache = method === "GET" && ttlMs > 0;
  if (canCache && !options.bypassCache) {
    const cached = requestGuardCache.get(options.key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
  }

  const shouldDedupe = options.dedupe !== false;
  if (shouldDedupe) {
    const existing = requestGuardInFlight.get(options.key) as Promise<T> | undefined;
    if (existing) {
      return withAbortSignal(existing, options.signal);
    }
  }

  const linked = linkAbortSignal(options.signal);
  const requestPromise = (async () => {
    try {
      const value = await options.fetcher(linked.signal);
      if (canCache) {
        requestGuardCache.set(options.key, {
          expiresAt: Date.now() + ttlMs,
          value,
        });
      }
      return value;
    } finally {
      requestGuardInFlight.delete(options.key);
      linked.cleanup();
    }
  })();
  requestGuardInFlight.set(options.key, requestPromise);
  return withAbortSignal(requestPromise, options.signal);
}

export function nextRequestSequence(requestType: string): number {
  const next = (requestGuardSeq.get(requestType) || 0) + 1;
  requestGuardSeq.set(requestType, next);
  return next;
}

export function isLatestRequestSequence(requestType: string, sequence: number): boolean {
  return (requestGuardSeq.get(requestType) || 0) === sequence;
}

export function readCachedGraphPayload(cacheKey: string): CachedGraphPayload | null {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      updatedAt: Number(parsed.updatedAt) || 0,
      cypher: typeof parsed.cypher === "string" ? parsed.cypher : "",
      graphResult: Array.isArray(parsed.graphResult) ? parsed.graphResult : [],
      knowGraphData: {
        nodes: Array.isArray(parsed?.knowGraphData?.nodes) ? parsed.knowGraphData.nodes : [],
        relationships: Array.isArray(parsed?.knowGraphData?.relationships) ? parsed.knowGraphData.relationships : [],
      },
    };
  } catch {
    return null;
  }
}

export function writeCachedGraphPayload(cacheKey: string, payload: CachedGraphPayload): void {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // best-effort cache
  }
}

export function isCachedGraphFresh(payload: CachedGraphPayload | null, ttlMs: number): boolean {
  if (!payload?.updatedAt) return false;
  return Date.now() - payload.updatedAt <= ttlMs;
}
