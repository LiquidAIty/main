// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Card Profiles
// Relationship: Verifies exact saved-profile settings transport, Project ownership, bounded operations, and Main publication without changing its prompt or model.
// Entity: KnowGraph
// Relationship: Checks that profile publication uses the saved KnowGraph prompt and model despite caller-supplied replacement values.
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, symlink } from 'node:fs/promises';

vi.mock('./projectAccess', () => ({ requireOwnedProject: vi.fn() }));
vi.mock('../decks/deckDomainClient', () => ({ getDeckDocument: vi.fn() }));
vi.mock('../services/projectStore', () => ({ assertCardProfileOwner: vi.fn() }));
vi.mock('node:fs/promises', () => ({ lstat: vi.fn(), mkdir: vi.fn(), realpath: vi.fn(), symlink: vi.fn() }));
import { requireOwnedProject } from './projectAccess';
import { getDeckDocument } from '../decks/deckDomainClient';
import { assertCardProfileOwner } from '../services/projectStore';
import { createCardProfileRouter } from './cardProfile.routes';

const closers: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lstat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(symlink).mockResolvedValue(undefined);
  vi.mocked(requireOwnedProject).mockResolvedValue({ ownerUserId: 'owner', projectId: 'project' });
  vi.mocked(getDeckDocument).mockResolvedValue({ deck: { nodes: [{
    id: 'trader', enabled: false, runtime: { kind: 'hermes', mode: 'delegate', profile: 'trading' },
  }] } } as any);
});
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

async function serve() {
  const graph = { nodes: [{ id: 'skill:research' }], edges: [], memory: [], clusters: [], stats: {} };
  const api = vi.fn(async (pathname: string, _method?: string, _body?: Record<string, unknown>) => {
    if (pathname === '/api/learning/graph') return graph;
    if (pathname === '/api/tools/toolsets') return [{ name: 'web', enabled: false, tools: ['web_search'] }];
    if (pathname === '/api/skills') return [{ name: 'research', enabled: true }];
    return { ok: true };
  });
  const connect = vi.fn(async (_profile: string) => api);
  const app = express();
  app.use(express.json());
  app.use(createCardProfileRouter(connect, async () => ({ reloaded: true }) as any));
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  closers.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cards/trader`;
  return { base, api, connect, graph };
}

describe('Card profile settings', () => {
  it('publishes only the authoritative saved KnowGraph prompt, model and grants', async () => {
    const { base, api } = await serve();
    const prompt = '# CARD_PROMPT_V1\n[ROLE]\nSaved researcher';
    vi.mocked(getDeckDocument).mockResolvedValue({ deck: { nodes: [{
      id: 'trader', prompt, runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' },
      runtimeOptions: { modelKey: 'gpt-5.6-luna', accessMode: 'chatgpt-account', tools: ['graphiti.get_know'], toolsets: ['terminal'] },
    }] } } as any);
    api.mockImplementation(async (pathname: string) => {
      if (pathname.endsWith('/soul')) return { content: prompt } as any;
      if (pathname === '/api/config') return { plugins: { enabled: ['existing'], disabled: ['other'] },
        platform_toolsets: { cli: ['browser', 'web', 'terminal'] }, agent: { disabled_toolsets: ['delegation'] } } as any;
      return { ok: true } as any;
    });
    const response = await fetch(`${base}/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project', deckId: 'deck', method: 'profile.publish',
        params: { prompt: 'untrusted replacement', model: 'untrusted-model' } }) });
    expect(response.status).toBe(200);
    expect(api).toHaveBeenCalledWith('/api/profiles/knowgraph/soul', 'PUT', { content: prompt });
    expect(api).toHaveBeenCalledWith('/api/model/set', 'POST', expect.objectContaining({ model: 'gpt-5.6-luna', provider: 'openai-codex' }));
    expect(api).toHaveBeenCalledWith('/api/config', 'PUT', expect.objectContaining({ config: expect.objectContaining({
      plugins: { enabled: ['existing', 'project-graph'], disabled: ['other'], entries: { 'project-graph': { settings: { recipient: 'knowgraph' }, mcp_allowlist: ['liquidaity'] } } },
      platform_toolsets: { cli: ['terminal'] },
      agent: { disabled_toolsets: ['delegation', 'browser', 'web', 'project', 'catalog', 'desktop_ui'] },
      mcp_servers: { liquidaity: { timeout: 600, tools: { include: ['graphiti.get_know'], resources: false, prompts: false } } },
    }) }));
    expect(api.mock.calls.some(([url]) => url.startsWith('/api/tools/toolsets/'))).toBe(false);
  });

  it('publishes Main context settings without changing its prompt, model or native web tools', async () => {
    const { base, api } = await serve();
    vi.mocked(getDeckDocument).mockResolvedValue({ deck: { nodes: [{ id: 'trader',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' }, runtimeOptions: { tools: ['project_graph.read_map'] },
    }] } } as any);
    const response = await fetch(`${base}/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project', deckId: 'deck', method: 'profile.publish', params: {} }) });
    expect(response.status).toBe(200);
    expect(api.mock.calls.some(([url]) => url.includes('/soul') || url === '/api/model/set' || url.startsWith('/api/tools/toolsets/'))).toBe(false);
    const config = api.mock.calls.find(([url, method]) => url === '/api/config' && method === 'PUT')?.[2]?.config as any;
    expect(config).not.toHaveProperty('platform_toolsets');
    expect(config).not.toHaveProperty('agent');
    expect(config.mcp_servers.liquidaity.tools).toEqual({ include: ['project_graph.read_map'] });
  });
  it('reads the actual saved profile tools and graph unchanged', async () => {
    const { base, api, connect, graph } = await serve();
    const response = await fetch(`${base}?projectId=project&deckId=deck`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(connect).toHaveBeenCalledExactlyOnceWith('trading');
    expect(assertCardProfileOwner).toHaveBeenCalledWith('trading', 'owner');
    expect(body.profile.learning.graph).toEqual(graph);
    expect(api.mock.calls.map(call => call[0])).toEqual(['/api/skills', '/api/tools/toolsets', '/api/learning/graph']);
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
