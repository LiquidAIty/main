import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectWorldviewCapabilityStore,
  createWorldviewRouter,
  resolveWorldviewGlobeUrl,
  type ProjectWorldviewCapabilityStore,
} from './worldview.routes';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env.WORLDVIEW_GLOBE_URL;
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function serve(
  fetcher: typeof fetch,
  capabilityStore?: ProjectWorldviewCapabilityStore,
) {
  const app = express();
  app.use(express.json());
  app.use('/worldview', createWorldviewRouter({
    fetcher,
    capabilityStore,
    projectAuthorizer: async () => true,
  }));
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

describe('Project WorldView capability authority', () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('<html/>', { status: 200 }));

  it('returns Project-scoped capability state and writes only a user override', async () => {
    const capabilityStore: ProjectWorldviewCapabilityStore = {
      list: vi.fn(async () => [{
        capabilityId: 'earthquakes', enabled: false, controlledBy: 'user' as const,
        mainReason: null, updatedAt: '2026-09-27T00:00:00.000Z',
      }]),
      set: vi.fn(async (_projectId, capabilityId, actor, enabled) => ({
        capabilityId, enabled, controlledBy: actor as 'user' | 'main',
        mainReason: null, updatedAt: '2026-09-27T00:00:01.000Z',
      })),
    };
    const base = await serve(fetcher, capabilityStore);

    const before = await fetch(`${base}/projects/project-a/capabilities`);
    expect(await before.json()).toMatchObject({
      ok: true,
      projectId: 'project-a',
      defaultEnabled: true,
      capabilities: [{ capabilityId: 'earthquakes', enabled: false }],
    });

    const updated = await fetch(`${base}/projects/project-a/capabilities/earthquakes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(updated.status).toBe(200);
    expect(capabilityStore.set).toHaveBeenCalledWith(
      'project-a', 'earthquakes', 'user', true,
    );
  });

  it('rejects unknown patch fields and malformed capability identities', async () => {
    const capabilityStore: ProjectWorldviewCapabilityStore = {
      list: vi.fn(async () => []),
      set: vi.fn(async () => {
        throw new Error('must_not_write');
      }),
    };
    const base = await serve(fetcher, capabilityStore);
    const malformed = await fetch(`${base}/projects/project-a/capabilities/Bad%20Source`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(malformed.status).toBe(400);

    const widened = await fetch(`${base}/projects/project-a/capabilities/earthquakes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, actor: 'main' }),
    });
    expect(widened.status).toBe(400);
    expect(capabilityStore.set).not.toHaveBeenCalled();
  });

  it('keeps an explicit user choice above a later Main suggestion', async () => {
    const rows = new Map<string, any>();
    const query = vi.fn(async (_sql: string, values: unknown[] = []) => {
      const [projectId, capabilityId, mainEnabled, mainReason, userEnabled, actor] = values;
      const key = `${projectId}:${capabilityId}`;
      const prior = rows.get(key) || {
        capability_id: capabilityId,
        main_enabled: null,
        main_reason: null,
        user_enabled: null,
      };
      const next = {
        ...prior,
        main_enabled: actor === 'main' ? mainEnabled : prior.main_enabled,
        main_reason: actor === 'main' ? mainReason : prior.main_reason,
        user_enabled: actor === 'user' ? userEnabled : prior.user_enabled,
        updated_at: new Date('2026-09-27T00:00:00.000Z'),
      };
      rows.set(key, next);
      return { rows: [next] };
    });
    const store = createProjectWorldviewCapabilityStore(query);

    await store.set('project-a', 'weather', 'user', false);
    const result = await store.set('project-a', 'weather', 'main', true, 'Research task');

    expect(result).toMatchObject({
      capabilityId: 'weather',
      enabled: false,
      controlledBy: 'user',
      mainReason: 'Research task',
    });
  });
});
