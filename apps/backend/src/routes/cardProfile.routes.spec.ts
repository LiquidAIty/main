// Entity: Card Profiles
// Relationship: Verifies settings use the exact saved profile and Desktop API contracts without Bot Mode calls.
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./projectAccess', () => ({ requireOwnedProject: vi.fn() }));
vi.mock('../decks/deckDomainClient', () => ({ getDeckDocument: vi.fn() }));
vi.mock('../services/projectStore', () => ({ assertCardProfileOwner: vi.fn() }));
import { requireOwnedProject } from './projectAccess';
import { getDeckDocument } from '../decks/deckDomainClient';
import { assertCardProfileOwner } from '../services/projectStore';
import { createCardProfileRouter } from './cardProfile.routes';

const closers: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireOwnedProject).mockResolvedValue({ ownerUserId: 'owner', projectId: 'project' });
  vi.mocked(getDeckDocument).mockResolvedValue({ deck: { nodes: [{
    id: 'trader', enabled: false, runtime: { kind: 'hermes', mode: 'delegate', profile: 'trading' },
    prompt: '# CARD_PROMPT_V1\n[ROLE]\nTrade carefully.',
    runtimeOptions: { tools: ['engraphis_get_memory'] },
  }] } } as any);
});
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

async function serve() {
  const graph = { nodes: [{ id: 'skill:research' }], edges: [], memory: [], clusters: [], stats: {} };
  let soulContent = 'old profile prompt';
  let include = ['old_tool'];
  const api = vi.fn(async (pathname: string, method = 'GET', body?: Record<string, any>) => {
    if (pathname === '/api/profiles/trading/soul') {
      if (method === 'PUT') {
        soulContent = String(body?.content ?? '');
        return { ok: true };
      }
      return { content: soulContent, exists: true };
    }
    if (pathname === '/api/mcp/servers') return { servers: [{
      name: 'liquidaity', enabled: true, source: 'config', tools: { include },
    }] };
    if (pathname === '/api/config' && method === 'PUT') {
      include = [...(body?.config?.mcp_servers?.liquidaity?.tools?.include || [])];
      return { ok: true };
    }
    if (pathname === '/api/learning/graph') return graph;
    if (pathname === '/api/tools/toolsets') return [{ name: 'web', enabled: false, tools: ['web_search'] }];
    if (pathname === '/api/skills') return [{ name: 'research', enabled: true }];
    return { ok: true };
  });
  const connect = vi.fn(async (_profile: string) => api);
  const app = express();
  app.use(express.json());
  app.use(createCardProfileRouter(connect));
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  closers.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cards/trader`;
  return { base, api, connect, graph, readPublished: () => ({ soulContent, include }) };
}

describe('Card profile settings', () => {
  it('reads the actual saved profile prompt, tools, and graph unchanged', async () => {
    const { base, api, connect, graph } = await serve();
    const response = await fetch(`${base}?projectId=project&deckId=deck`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(connect).toHaveBeenCalledExactlyOnceWith('trading');
    expect(assertCardProfileOwner).toHaveBeenCalledWith('trading', 'owner');
    expect(body.profile.learning.graph).toEqual(graph);
    expect(body.profile.soul).toEqual({ content: 'old profile prompt', exists: true, matchesSavedPrompt: false });
    expect(body.profile.applicationTools).toMatchObject({
      server: 'liquidaity', selected: ['engraphis_get_memory'], include: ['old_tool'],
      matchesSavedSelection: false,
    });
    expect(api.mock.calls.map(call => call[0])).toEqual([
      '/api/skills', '/api/tools/toolsets', '/api/learning/graph',
      '/api/profiles/trading/soul', '/api/mcp/servers',
    ]);
  });

  it('publishes the saved prompt and exact application-tool selection, then reads both back', async () => {
    const { base, api, connect, readPublished } = await serve();
    const response = await fetch(`${base}/operations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project', deckId: 'deck', profile: 'main',
        method: 'configuration.publish', params: {},
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(readPublished()).toEqual({
      soulContent: '# CARD_PROMPT_V1\n[ROLE]\nTrade carefully.',
      include: ['engraphis_get_memory'],
    });
    expect(api).toHaveBeenCalledWith('/api/profiles/trading/soul', 'PUT', {
      content: '# CARD_PROMPT_V1\n[ROLE]\nTrade carefully.',
    });
    expect(api).toHaveBeenCalledWith('/api/config', 'PUT', {
      config: { mcp_servers: { liquidaity: {
        enabled: true, tools: { include: ['engraphis_get_memory'] },
      } } },
    });
    expect(body.result).toEqual({ published: true });
    expect(connect).toHaveBeenCalledExactlyOnceWith('trading');
    expect(body.binding).toEqual({ profile: 'trading', mode: 'delegate' });
    expect(body.profile.soul.matchesSavedPrompt).toBe(true);
    expect(body.profile.applicationTools.matchesSavedSelection).toBe(true);
  });

  it('reports a SOUL publication readback mismatch instead of accepting the deck save alone', async () => {
    const { base, api } = await serve();
    api.mockImplementationOnce(async () => ({ ok: true }));
    const response = await fetch(`${base}/operations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project', deckId: 'deck', method: 'configuration.publish', params: {},
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false, error: 'card_profile_soul_readback_mismatch',
    });
  });

  it('toggles one Hermes toolset through Desktop HTTP, ignoring a supplied profile override', async () => {
    const { base, api, connect } = await serve();
    const response = await fetch(`${base}/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project', deckId: 'deck', profile: 'main',
        method: 'toolset.toggle', params: { name: 'web', enabled: false, profile: 'main' } }) });
    expect(response.status).toBe(200);
    expect(connect).toHaveBeenCalledExactlyOnceWith('trading');
    expect(api).toHaveBeenCalledWith('/api/tools/toolsets/web', 'PUT', { enabled: false });
  });

  it('does not connect for an unowned Project', async () => {
    const { base, connect } = await serve();
    vi.mocked(requireOwnedProject).mockImplementation(async (_req, res) => {
      res.status(403).json({ ok: false }); return null;
    });
    expect((await fetch(`${base}?projectId=foreign&deckId=deck`)).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects arbitrary methods and reports provider failure without empty-success data', async () => {
    const { base, api } = await serve();
    const rejected = await fetch(`${base}/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project', deckId: 'deck', method: 'prompt.submit', params: {} }) });
    expect(rejected.status).toBe(400);
    expect(api).not.toHaveBeenCalled();
    api.mockRejectedValueOnce(new Error('provider unavailable'));
    const failed = await fetch(`${base}?projectId=project&deckId=deck`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, error: 'card_profile_unavailable' });
  });
});
