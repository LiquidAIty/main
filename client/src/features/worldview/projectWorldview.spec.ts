/**
 * Entity: WorldView
 * Relationship: Verifies exact Project capability transport for the one Earth surface, including structural validation, duplicate rejection, identifier encoding, user writes, and server error propagation.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  loadProjectWorldview,
  setProjectWorldviewCapability,
} from './projectWorldview';

describe('Project WorldView transport', () => {
  it('loads only a structurally valid Project-scoped capability mask', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: true,
      projectId: 'project-a',
      defaultEnabled: true,
      capabilities: [{
        capabilityId: 'weather',
        enabled: false,
        controlledBy: 'user',
        lastOrigin: 'user',
        mainReason: null,
        updatedAt: '2026-09-27T00:00:00.000Z',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(loadProjectWorldview('project-a', fetcher)).resolves.toMatchObject({
      projectId: 'project-a',
      capabilities: [{ capabilityId: 'weather', enabled: false }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/worldview/projects/project-a/capabilities',
      { method: 'GET' },
    );
  });

  it('writes one explicit user ON/OFF decision', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Response(JSON.stringify({
      ok: true,
      projectId: 'project-a',
      capability: {
        capabilityId: 'earthquakes',
        enabled: false,
        controlledBy: 'user',
        lastOrigin: 'user',
        mainReason: null,
        updatedAt: '2026-09-27T00:00:01.000Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(setProjectWorldviewCapability(
      'project-a', 'earthquakes', false, fetcher,
    )).resolves.toMatchObject({ capabilityId: 'earthquakes', enabled: false });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/worldview/projects/project-a/capabilities/earthquakes',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
    );
  });

  it('does not accept a capability response from another Project', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: true, projectId: 'project-b', defaultEnabled: true, capabilities: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(loadProjectWorldview('project-a', fetcher)).rejects.toThrow(
      'project_worldview_response_invalid',
    );
  });

  it('rejects malformed or duplicate capability identities in aggregate reads', async () => {
    for (const capabilities of [
      [{
        capabilityId: ' invalid ', enabled: true, controlledBy: 'user',
        lastOrigin: 'user', mainReason: null, updatedAt: null,
      }],
      [
        { capabilityId: 'weather', enabled: true, controlledBy: 'user', lastOrigin: 'user', mainReason: null, updatedAt: null },
        { capabilityId: 'weather', enabled: false, controlledBy: 'main', lastOrigin: 'main', mainReason: 'duplicate', updatedAt: null },
      ],
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        ok: true,
        projectId: 'project-a',
        defaultEnabled: true,
        capabilities,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await expect(loadProjectWorldview('project-a', fetcher)).rejects.toThrow(
        'project_worldview_response_invalid',
      );
    }
  });

  it('requires the PATCH response to confirm the exact requested capability', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: true,
      projectId: 'project-a',
      capability: {
        capabilityId: 'weather',
        enabled: false,
        controlledBy: 'user',
        lastOrigin: 'user',
        mainReason: null,
        updatedAt: null,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(setProjectWorldviewCapability(
      'project-a', 'earthquakes', false, fetcher,
    )).rejects.toThrow('project_worldview_response_invalid');
  });

  it('validates capability IDs before transport and safely encodes accepted IDs', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: true,
      projectId: 'project-a',
      capability: {
        capabilityId: 'weather:radar', enabled: true, controlledBy: 'user',
        lastOrigin: 'user', mainReason: null, updatedAt: null,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(setProjectWorldviewCapability(
      'project-a', '../weather', true, fetcher,
    )).rejects.toThrow('worldview_capability_id_invalid');
    expect(fetcher).not.toHaveBeenCalled();

    await expect(setProjectWorldviewCapability(
      'project-a', 'weather:radar', true, fetcher,
    )).resolves.toMatchObject({ capabilityId: 'weather:radar' });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/worldview/projects/project-a/capabilities/weather%3Aradar',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('projects HTTP failures without accepting their body as capability state', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: false,
      error: 'worldview_write_refused',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }));

    await expect(setProjectWorldviewCapability(
      'project-a', 'weather', true, fetcher,
    )).rejects.toThrow('worldview_write_refused');
  });
});
