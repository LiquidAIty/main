/**
 * Entity: Application Transport
 * Relationship: Keeps the standalone Vite path relative while routing Hermes-hosted LiquidAIty pages to the existing loopback application backend with credentialed browser requests.
 */

type HermesWebappWindow = Window & {
  __HERMES_UI_SURFACE__?: string;
};

const APPLICATION_BACKEND_ORIGIN = String(
  import.meta.env.VITE_LIQUIDAITY_API_ORIGIN || 'http://127.0.0.1:4000',
).replace(/\/+$/, '');

export function isHermesWebappHosted(): boolean {
  return typeof window !== 'undefined'
    && (window as HermesWebappWindow).__HERMES_UI_SURFACE__ === 'webapp';
}

export function applicationApiUrl(path: string): string {
  if (!path.startsWith('/api/')) {
    throw new Error(`LiquidAIty API path must begin with /api/: ${path}`);
  }
  return isHermesWebappHosted() ? `${APPLICATION_BACKEND_ORIGIN}${path}` : path;
}

export function applicationFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = applicationApiUrl(path);
  return fetch(url, url === path ? init : {
    ...init,
    credentials: init?.credentials ?? 'include',
  });
}
