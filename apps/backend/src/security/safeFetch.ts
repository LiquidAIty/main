import { assertUrlAllowed, FetchPolicy } from "./urlGuard";

export type SafeFetchOpts = RequestInit & {
  allowHosts?: string[];
  timeoutMs?: number;
  policy?: FetchPolicy;
  maxBytes?: number;
  follow?: number;
};

export async function safeFetch(rawUrl: string, opts: SafeFetchOpts = {}) {
  const {
    allowHosts = [],
    timeoutMs = 5000,
    policy,
    maxBytes,
    follow = 3,
    signal: externalSignal,
    ...rest
  } = opts;

  const hasTimeout = typeof timeoutMs === "number" && timeoutMs > 0;
  const controller = hasTimeout ? new AbortController() : null;
  const timer = hasTimeout ? setTimeout(() => controller!.abort(), timeoutMs) : null;
  let signal: AbortSignal | undefined = controller ? controller.signal : undefined;
  if (externalSignal) {
    if (controller && typeof (AbortSignal as any)?.any === "function") {
      signal = (AbortSignal as any).any([controller.signal, externalSignal]);
    } else if (controller) {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      signal = controller.signal;
    } else {
      signal = externalSignal;
    }
  }

  const fetchWithRedirects = async (url: string, redirectsRemaining: number): Promise<Response> => {
    await assertUrlAllowed(url, { allowHosts, policy });

    const response = await fetch(url, {
      ...rest,
      ...(signal ? { signal } : {}),
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        if (redirectsRemaining <= 0) {
          throw new Error("Redirect limit exceeded");
        }
        const nextUrl = new URL(location, url).toString();
        return fetchWithRedirects(nextUrl, redirectsRemaining - 1);
      }
    }

    if (response.url && response.url !== url) {
      await assertUrlAllowed(response.url, { allowHosts, policy });
    }

    if (maxBytes != null) {
      const headerLength = response.headers.get("content-length");
      if (headerLength && Number(headerLength) > maxBytes) {
        throw new Error("Response exceeds maximum allowed size");
      }

      const clone = response.clone();
      const buffer = Buffer.from(await clone.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        throw new Error("Response exceeds maximum allowed size");
      }
    }

    return response;
  };

  try {
    return await fetchWithRedirects(rawUrl, follow);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
