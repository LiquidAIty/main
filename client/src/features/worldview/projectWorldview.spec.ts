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
});
