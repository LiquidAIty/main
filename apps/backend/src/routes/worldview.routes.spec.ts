/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: WorldView
 * Relationship: Verifies Project capability authority, readiness, and route-level scope through the mounted Express boundary.
 */

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorldviewRouter } from './worldview.routes';
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

});
