/**
 * Entity: WorldView
 * Relationship: Verifies bounded Card actions, exact result correlation, Project capability authority, persistence failure handling, readiness, and route-level scope through the mounted Express boundary.
 */

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorldviewInternalRouter,
  createWorldviewRouter,
} from './worldview.routes';
import { createWorldviewActionChannel } from './worldviewActionChannel';
import {
  createProjectWorldviewCapabilityStore,
  type ProjectWorldviewCapabilityStore,
} from './projectWorldviewCapabilities';
import { resolveWorldviewGlobeUrl } from './worldviewRouteHandlers';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env.WORLDVIEW_GLOBE_URL;
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('WorldView Card spatial action boundary', () => {
  it('accepts the bounded satellite focus action and existing God\'s Eye actions', async () => {
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
      for (const noradIds of [[25544, 20580, 48274, 33591, 43013], []]) {
        const focus = await call('focus_satellites', { noradIds });
        expect(focus.status).toBe(200);
        expect(await focus.json()).toMatchObject({
          ok: true, result: { ok: false, error: 'worldview_mount_unavailable' },
        });
      }
      for (const argumentsValue of [
        {}, { noradIds: [0] }, { noradIds: ['25544'] },
        { noradIds: [Number.MAX_SAFE_INTEGER + 1] },
        { noradIds: Array.from({ length: 51 }, (_, index) => index + 1) },
        { noradIds: [], other: true },
      ]) {
        expect((await call('focus_satellites', argumentsValue)).status).toBe(400);
      }
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
      expect(runAuthorizer).toHaveBeenCalledTimes(8);
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

function mountActionChannel(
  channel: ReturnType<typeof createWorldviewActionChannel>,
  projectId = 'project-a',
  cardId = 'card-worldview',
) {
  let stream = '';
  const response: any = { destroyed: false };
  response.status = vi.fn(() => response);
  response.set = vi.fn(() => response);
  response.flushHeaders = vi.fn();
  response.write = vi.fn((chunk: string) => {
    stream += chunk;
    return true;
  });
  response.on = vi.fn(() => response);
  expect(channel.listen(projectId, cardId, response)).toBe(true);
  return {
    actionEvent() {
      const match = stream.match(/event: action\ndata: ([^\n]+)\n\n/);
      if (!match) throw new Error('worldview_action_event_missing');
      return JSON.parse(match[1]) as {
        requestId: string;
        name: string;
        arguments: Record<string, unknown>;
      };
    },
  };
}

function dispatchLayerAction(
  channel: ReturnType<typeof createWorldviewActionChannel>,
  enabled: boolean,
) {
  const mounted = mountActionChannel(channel);
  const result = channel.dispatch({
    projectId: 'project-a',
    deckId: 'deck-a',
    cardId: 'card-worldview',
    parentRunId: 'run-a',
    name: 'set_layer_visibility',
    arguments: { layerId: 'earthquakes', enabled },
  }, []);
  return { event: mounted.actionEvent(), result };
}

describe('authenticated WorldView presentation readiness', () => {
  it('reports the supervised presentation boundary without inventing a voice runtime', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('<html/>', { status: 200 }));
    const base = await serve(fetcher);
    const response = await fetch(`${base}/readiness`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ready',
      lifecycle: { ownership: 'supervised-upstream', automaticStart: false },
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
        capabilityId, enabled, controlledBy: 'user' as const,
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

  it('preserves Python-authored Main state while writing one user override', async () => {
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      expect(sql).not.toContain('main_enabled=CASE');
      expect(sql).not.toContain('main_reason=CASE');
      expect(sql).toContain('user_enabled=EXCLUDED.user_enabled');
      expect(values).toEqual(['project-a', 'weather', false, 'user']);
      return { rows: [{
        capability_id: 'weather',
        main_enabled: true,
        main_reason: 'Research task',
        user_enabled: false,
        last_origin: 'user',
        updated_at: new Date('2026-09-27T00:00:00.000Z'),
      }] };
    });
    const store = createProjectWorldviewCapabilityStore(query);

    const result = await store.set('project-a', 'weather', 'user', false);

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
    const channel = createWorldviewActionChannel();
    const dispatched = dispatchLayerAction(channel, false);
    const base = await serve(fetcher, capabilityStore, channel);
    const response = await fetch(`${base}/projects/project-a/actions/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'card-worldview', requestId: dispatched.event.requestId,
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
    await expect(dispatched.result).resolves.toMatchObject({
      ok: true,
      projectCapability: { lastOrigin: 'worldview_card', enabled: false },
    });
  });

  it('fails the Card action rather than claiming success when Project persistence fails', async () => {
    const capabilityStore: ProjectWorldviewCapabilityStore = {
      list: vi.fn(async () => []),
      set: vi.fn(async () => { throw new Error('database_offline'); }),
    };
    const channel = createWorldviewActionChannel();
    const dispatched = dispatchLayerAction(channel, true);
    const base = await serve(fetcher, capabilityStore, channel);
    const response = await fetch(`${base}/projects/project-a/actions/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'card-worldview', requestId: dispatched.event.requestId,
        result: { ok: true, action: 'set_layer_visibility', layerId: 'earthquakes', enabled: true },
      }),
    });
    expect(response.status).toBe(503);
    await expect(dispatched.result).resolves.toEqual({
      ok: false, error: 'project_worldview_write_failed',
    });
  });

  it('refuses a layer readback that differs from the exact dispatched arguments', async () => {
    const capabilityStore: ProjectWorldviewCapabilityStore = {
      list: vi.fn(async () => []),
      set: vi.fn(async () => { throw new Error('must_not_write'); }),
    };
    const channel = createWorldviewActionChannel();
    const dispatched = dispatchLayerAction(channel, false);
    const base = await serve(fetcher, capabilityStore, channel);

    const response = await fetch(`${base}/projects/project-a/actions/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'card-worldview', requestId: dispatched.event.requestId,
        result: {
          ok: true,
          action: 'set_layer_visibility',
          layerId: 'weather',
          enabled: false,
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(capabilityStore.set).not.toHaveBeenCalled();
    await expect(dispatched.result).resolves.toEqual({
      ok: false, error: 'worldview_layer_readback_invalid',
    });
  });

  it('claims one exact result before awaiting Project persistence', async () => {
    let persistenceStarted!: () => void;
    let finishPersistence!: (value: Awaited<ReturnType<ProjectWorldviewCapabilityStore['set']>>) => void;
    const started = new Promise<void>((resolve) => { persistenceStarted = resolve; });
    const persisted = new Promise<Awaited<ReturnType<ProjectWorldviewCapabilityStore['set']>>>(
      (resolve) => { finishPersistence = resolve; },
    );
    const capabilityStore: ProjectWorldviewCapabilityStore = {
      list: vi.fn(async () => []),
      set: vi.fn(async () => {
        persistenceStarted();
        return persisted;
      }),
    };
    const channel = createWorldviewActionChannel();
    const dispatched = dispatchLayerAction(channel, true);
    const base = await serve(fetcher, capabilityStore, channel);

    const responsePromise = fetch(`${base}/projects/project-a/actions/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'card-worldview', requestId: dispatched.event.requestId,
        result: {
          ok: true,
          action: 'set_layer_visibility',
          layerId: 'earthquakes',
          enabled: true,
        },
      }),
    });
    await started;
    expect(channel.claim(
      'project-a', 'card-worldview', dispatched.event.requestId,
    )).toBeNull();

    finishPersistence({
      capabilityId: 'earthquakes',
      enabled: true,
      controlledBy: 'main',
      lastOrigin: 'worldview_card',
      mainReason: null,
      updatedAt: '2026-10-17T00:00:00.000Z',
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    await expect(dispatched.result).resolves.toMatchObject({
      ok: true,
      projectCapability: { capabilityId: 'earthquakes', enabled: true },
    });
  });
});
