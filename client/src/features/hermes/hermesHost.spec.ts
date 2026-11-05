// @vitest-environment jsdom
// Entity: Hermes UI Integration
// Relationship: Verifies the standalone LiquidAIty Webapp host mints one-use Hermes Gateway tickets and authenticates plugin HTTP requests without a dashboard SDK global.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hermesDashboardSdk } from './hermesHost';

type HermesHostWindow = Window & {
  __HERMES_AUTH_REQUIRED__?: boolean;
  __HERMES_BASE_PATH__?: string;
  __HERMES_UI_SURFACE__?: string;
};

function sessionKey(basePath = ''): string {
  return `hermes.webapp.session.v1:${JSON.stringify([window.location.origin, basePath])}`;
}

afterEach(() => {
  const host = window as HermesHostWindow;
  delete host.__HERMES_AUTH_REQUIRED__;
  delete host.__HERMES_BASE_PATH__;
  delete host.__HERMES_UI_SURFACE__;
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('Hermes Webapp host', () => {
  it('mints a profile-scoped one-use ticket for the generated Gateway client', async () => {
    const host = window as HermesHostWindow;
    host.__HERMES_UI_SURFACE__ = 'webapp';
    host.__HERMES_AUTH_REQUIRED__ = false;
    window.sessionStorage.setItem(sessionKey(), 'browser-session');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ticket: 'one-use-ticket' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    const url = new URL(await hermesDashboardSdk().buildWsUrl('/api/ws', { profile: 'main' }));

    expect(url.pathname).toBe('/api/ws');
    expect(url.searchParams.get('profile')).toBe('main');
    expect(url.searchParams.get('native_dial')).toBe('browser');
    expect(url.searchParams.get('ticket')).toBe('one-use-ticket');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/webapp/socket-ticket?socket=gateway&profile=main',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.any(Headers),
      }),
    );
    const headers = fetcher.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('X-Hermes-Session-Token')).toBe('browser-session');
  });

  it('uses the Webapp browser credential for authenticated plugin HTTP', async () => {
    const host = window as HermesHostWindow;
    host.__HERMES_UI_SURFACE__ = 'webapp';
    window.sessionStorage.setItem(sessionKey(), 'browser-session');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    await expect(hermesDashboardSdk().fetchJSON?.('/api/plugins/liquidaity/navigation-map'))
      .resolves.toEqual({ ok: true });
    const headers = fetcher.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('X-Hermes-Session-Token')).toBe('browser-session');
  });
});
