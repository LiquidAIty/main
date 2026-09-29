import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectWorldviewCapabilityStore,
  createWorldviewActionChannel,
  createWorldviewInternalRouter,
  createWorldviewRouter,
  resolveWorldviewGlobeUrl,
  type ProjectWorldviewCapabilityStore,
} from './worldview.routes';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env.WORLDVIEW_GLOBE_URL;
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('WorldView Card spatial action boundary', () => {
  it('accepts only the six requested God\'s Eye actions', async () => {
    const previousSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
    const secret = 'test-only-worldview-action-boundary-secret';
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = secret;
    try {
      const capabilityStore: ProjectWorldviewCapabilityStore = {
        list: vi.fn(async () => []),
        set: vi.fn(async () => { throw new Error('must_not_write'); }),
      };
      const runAuthorizer = vi.fn(async () => true);
      const app = express();
      app.use(express.json());
      app.use('/worldview', createWorldviewInternalRouter({
        channel: createWorldviewActionChannel(),
        capabilityStore,
        runAuthorizer,
      }));
      const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      });
      closers.push(() => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/worldview`;
      const call = async (name: string, args: Record<string, unknown> = {}) => fetch(`${base}/internal/actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-liquidaity-internal-mcp-secret': secret,
        },
        body: JSON.stringify({
          projectId: 'project-a', deckId: 'deck-a', cardId: 'card-worldview',
          parentRunId: 'run-a', name, arguments: args,
        }),
      });

      for (const name of [
        'get_current_view_state', 'get_entity_context', 'zoom_to_globe',
        'track_entity', 'stop_tracking',
      ]) {
        const response = await call(name);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true, result: { ok: false, error: 'worldview_mount_unavailable' },
        });
      }
      const validLayer = await call('set_layer_visibility', {
        layerId: 'satellites', enabled: true,
      });
      expect(validLayer.status).toBe(200);
      const coercedLayer = await call('set_layer_visibility', {
        layerId: 'satellites', enabled: 'false',
      });
      expect(coercedLayer.status).toBe(400);
      const missingLayer = await call('set_layer_visibility');
      expect(missingLayer.status).toBe(400);
      const outsideScope = await call('fly_to_location');
      expect(outsideScope.status).toBe(400);
      expect(await outsideScope.json()).toMatchObject({
        ok: false, error: 'worldview_action_request_invalid',
      });
      expect(runAuthorizer).toHaveBeenCalledTimes(6);
      expect(capabilityStore.set).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = previousSecret;
    }
  });
});

async function serve(
  fetcher: typeof fetch,
  capabilityStore?: ProjectWorldviewCapabilityStore,
  channel?: ReturnType<typeof createWorldviewActionChannel>,
) {
  const app = express();
  app.use(express.json());
  app.use('/worldview', createWorldviewRouter({
    fetcher,
    capabilityStore,
    channel,
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
        lastOrigin: 'user' as const,
        mainReason: null, updatedAt: '2026-09-27T00:00:00.000Z',
      }]),
      set: vi.fn(async (_projectId, capabilityId, actor, enabled) => ({
        capabilityId, enabled, controlledBy: actor === 'main' ? 'main' as const : 'user' as const,
        lastOrigin: actor,
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
        user_enabled: actor === 'user' || actor === 'worldview_card'
          ? userEnabled : prior.user_enabled,
        last_origin: actor,
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

  it('records a settled Card layer action as Card-originated Project state', async () => {
    const capabilityStore: ProjectWorldviewCapabilityStore = {
      list: vi.fn(async () => []),
      set: vi.fn(async (_projectId, capabilityId, actor, enabled) => ({
        capabilityId, enabled, controlledBy: 'user' as const,
        lastOrigin: actor, mainReason: null, updatedAt: '2026-09-27T00:00:01.000Z',
      })),
    };
    const channel = {
      ...createWorldviewActionChannel(),
      pendingAction: vi.fn(() => ({ name: 'set_layer_visibility' })),
      settle: vi.fn(() => true),
    } as unknown as ReturnType<typeof createWorldviewActionChannel>;
    const base = await serve(fetcher, capabilityStore, channel);
    const response = await fetch(`${base}/projects/project-a/actions/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'card-worldview', requestId: '00000000-0000-4000-8000-000000000001',
        result: { ok: true, action: 'set_layer_visibility', layerId: 'earthquakes', enabled: false },
      }),
    });
    expect(response.status).toBe(200);
    expect(capabilityStore.set).toHaveBeenCalledExactlyOnceWith(
      'project-a', 'earthquakes', 'worldview_card', false,
    );
    expect(await response.json()).toMatchObject({
      ok: true, capability: { lastOrigin: 'worldview_card', enabled: false },
    });
    expect(channel.settle).toHaveBeenCalledWith(
      'project-a', 'card-worldview', '00000000-0000-4000-8000-000000000001',
      expect.objectContaining({ ok: true, projectCapability: expect.objectContaining({
        lastOrigin: 'worldview_card',
      }) }),
    );
  });

  it('fails the Card action rather than claiming success when Project persistence fails', async () => {
    const capabilityStore: ProjectWorldviewCapabilityStore = {
      list: vi.fn(async () => []),
      set: vi.fn(async () => { throw new Error('database_offline'); }),
    };
    const channel = {
      ...createWorldviewActionChannel(),
      pendingAction: vi.fn(() => ({ name: 'set_layer_visibility' })),
      settle: vi.fn(() => true),
    } as unknown as ReturnType<typeof createWorldviewActionChannel>;
    const base = await serve(fetcher, capabilityStore, channel);
    const response = await fetch(`${base}/projects/project-a/actions/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'card-worldview', requestId: '00000000-0000-4000-8000-000000000002',
        result: { ok: true, action: 'set_layer_visibility', layerId: 'earthquakes', enabled: true },
      }),
    });
    expect(response.status).toBe(503);
    expect(channel.settle).toHaveBeenCalledWith(
      'project-a', 'card-worldview', '00000000-0000-4000-8000-000000000002',
      { ok: false, error: 'project_worldview_write_failed' },
    );
  });
});
