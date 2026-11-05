/**
 * Entity: Application Transport
 * Relationship: Keeps the standalone Vite path relative while routing Hermes-hosted LiquidAIty pages to the existing loopback application backend with credentialed browser requests.
 */

type HermesDashboardWindow = Window & {
  __HERMES_PLUGIN_SDK__?: unknown;
  __HERMES_UI_SURFACE__?: string;
};

const DASHBOARD_BACKEND_ORIGIN = String(
  import.meta.env.VITE_LIQUIDAITY_API_ORIGIN || 'http://127.0.0.1:4000',
).replace(/\/+$/, '');

export function isHermesDashboardHosted(): boolean {
  return typeof window !== 'undefined'
    && (
      Boolean((window as HermesDashboardWindow).__HERMES_PLUGIN_SDK__)
      || (window as HermesDashboardWindow).__HERMES_UI_SURFACE__ === 'webapp'
    );
}

export function applicationApiUrl(path: string): string {
  if (!path.startsWith('/api/')) {
    throw new Error(`LiquidAIty API path must begin with /api/: ${path}`);
  }
  return isHermesDashboardHosted() ? `${DASHBOARD_BACKEND_ORIGIN}${path}` : path;
}

export function applicationFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = applicationApiUrl(path);
  return fetch(url, url === path ? init : {
    ...init,
    credentials: init?.credentials ?? 'include',
  });
}
