import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorldviewRouter, resolveWorldviewGlobeUrl } from './worldview.routes';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env.WORLDVIEW_GLOBE_URL;
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function serve(fetcher: typeof fetch) {
  const app = express();
  app.use('/worldview', createWorldviewRouter({ fetcher }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  closers.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/worldview`;
}

describe('authenticated WorldView presentation readiness', () => {
  it('reports the supervised native-agent boundary without starting it', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('<html/>', { status: 200 }));
    const base = await serve(fetcher);
    const response = await fetch(`${base}/readiness`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ready',
      lifecycle: { ownership: 'supervised-upstream', automaticStart: false },
      nativeAgents: {
        realtimeVoice: {
          policy: 'user-initiated',
          active: null,
          runtimeState: 'ui-handshake-required',
        },
      },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ origin: 'http://127.0.0.1:4174' }),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports an honest disconnected state', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error('connection refused');
    });
    const base = await serve(fetcher);
    const response = await fetch(`${base}/readiness`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('offline');
    expect(body.diagnostics).toBe('connection refused');
  });

  it('refuses a configured non-loopback presentation origin', () => {
    expect(() => resolveWorldviewGlobeUrl('https://example.com')).toThrow(
      'worldview_globe_url_must_be_loopback_http',
    );
  });
});
