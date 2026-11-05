// @vitest-environment jsdom
// Entity: Application Transport
// Relationship: Proves the dashboard plugin uses the existing application backend without changing standalone Vite request paths.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applicationApiUrl, applicationFetch } from './applicationApi';

afterEach(() => {
  delete (window as Window & { __HERMES_PLUGIN_SDK__?: unknown }).__HERMES_PLUGIN_SDK__;
  vi.unstubAllGlobals();
});

describe('LiquidAIty application API location', () => {
  it('keeps standalone Vite requests relative', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);

    expect(applicationApiUrl('/api/projects')).toBe('/api/projects');
    await applicationFetch('/api/projects', { method: 'GET' });
    expect(fetcher).toHaveBeenCalledWith('/api/projects', { method: 'GET' });
  });

  it('uses the existing loopback backend with credentials inside Hermes dashboard', async () => {
    (window as Window & { __HERMES_PLUGIN_SDK__?: unknown }).__HERMES_PLUGIN_SDK__ = {};
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);

    expect(applicationApiUrl('/api/projects?active=1'))
      .toBe('http://127.0.0.1:4000/api/projects?active=1');
    await applicationFetch('/api/projects', { method: 'POST' });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4000/api/projects', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('refuses to turn arbitrary URLs into application-backend requests', () => {
    expect(() => applicationApiUrl('https://example.com')).toThrow('/api/');
  });
});
