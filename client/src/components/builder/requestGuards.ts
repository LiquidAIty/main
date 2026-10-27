/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Projects
 * Relationship: This file fences overlapping Project reads, isolates caller cancellation, and rejects stale request generations before they can replace current Project state.
 * Entity: Saved Cards
 * Relationship: This file deduplicates saved-deck reads and safely parses persistence responses for Card and deck state owners.
 */

type GuardedRequestOptions<T> = {
  key: string;
  method?: string;
  ttlMs?: number;
  dedupe?: boolean;
  bypassCache?: boolean;
  signal?: AbortSignal;
  fetcher: (signal: AbortSignal) => Promise<T>;
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
  if (!externalSignal) return { signal: controller.signal, cleanup: () => undefined };
  if (externalSignal.aborted) {
    controller.abort();
    return { signal: controller.signal, cleanup: () => undefined };
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

  const linked = linkAbortSignal(shouldDedupe ? undefined : options.signal);
  let requestPromise!: Promise<T>;
  requestPromise = (async () => {
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
      if (requestGuardInFlight.get(options.key) === requestPromise) {
        requestGuardInFlight.delete(options.key);
      }
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
