import express from 'express';
import { createServer } from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckDocument } from '../types';
import { createHermesProfileRouter } from './hermesProfile.routes';

const deck: DeckDocument = {
  id: 'deck_builder',
  name: 'Builder',
  workspaceRoot: 'C:/Projects/LiquidAIty/main',
  version: 1,
  promptTemplates: [],
  edges: [],
  nodes: [
    {
      id: 'card_main',
      templateId: 'main',
      title: 'Main Chat',
      role: 'Card role',
      prompt: 'Card contract',
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      runtimeOptions: { tools: ['main.context'] },
      position: { x: 0, y: 0 },
    },
    {
      id: 'card_delegate',
      templateId: 'delegate',
      title: 'Delegate',
      role: 'Delegate role',
      prompt: 'Delegate contract',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
      runtimeOptions: { tools: [] },
      position: { x: 1, y: 1 },
    },
  ],
};

function profileState() {
  return {
    name: 'liquidaity-main',
    description: 'Hermes description',
    soul: 'Hermes SOUL',
    model: { provider: 'openai-codex', default: 'gpt-hermes' },
    skills: [],
    toolsets: [],
    toolsets_pinned: false,
    mcp_servers: [],
  };
}

type HermesRequest = (
  method: string,
  params?: Record<string, unknown>,
  profile?: string,
) => Promise<unknown>;

function hermesRequest() {
  return vi.fn<HermesRequest>(async (method: string) => {
    if (method === 'profiles.describe') return profileState();
    if (method === 'mcp.servers.list') return { servers: [] };
    if (method === 'learning.frames') return { count: 0, summary: [], buckets: [] };
    if (method === 'profiles.configure') return { ok: true, applied: { description: true } };
    if (method === 'learning.detail') return {
      ok: true, id: 'skill:research', kind: 'skill', label: 'Research', content: 'Current content',
    };
    if (method === 'learning.edit') return { ok: true, message: 'updated' };
    throw new Error(`unexpected_hermes_method:${method}`);
  });
}

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(requestHermes: HermesRequest = hermesRequest()) {
  const app = express();
  app.use(express.json());
  app.use('/hermes-profile', createHermesProfileRouter({
    getDeck: vi.fn(async () => ({ deck, meta: { deckRevision: 'rev-1', deckSavedAt: null } })),
    requestHermes: requestHermes as never,
  }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  return { base: `http://127.0.0.1:${address.port}/hermes-profile`, requestHermes };
}

describe('Hermes profile Card routes', () => {
  it('reads the bound Hermes profile without returning secret-shaped fields', async () => {
    const { base, requestHermes } = await start();
    const response = await fetch(`${base}/cards/card_main?projectId=p1&deckId=deck_builder`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profileApply).toBe('run_start');
    expect(body.cardSaveMutatesProfile).toBe(false);
    expect(body.binding).toMatchObject({ profile: 'liquidaity-main', mode: 'main' });
    expect(body.profile).toMatchObject({ description: 'Hermes description', soul: 'Hermes SOUL' });
    expect(requestHermes).toHaveBeenCalledTimes(3);
    expect(requestHermes).toHaveBeenNthCalledWith(1, 'profiles.describe', {
      name: 'liquidaity-main',
    });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|access.?token|refresh.?token|client.?secret|bearer\s+[a-z0-9]/i);
  });

  it('applies one supported Hermes operation without creating a Card revision or Run', async () => {
    const { base, requestHermes } = await start();
    const response = await fetch(`${base}/cards/card_main/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        deckId: 'deck_builder',
        method: 'profiles.configure',
        params: { description: 'Hermes role only' },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.method).toBe('profiles.configure');
    expect(body.cardSaveMutatesProfile).toBe(false);
    expect(requestHermes).toHaveBeenCalledTimes(4);
    expect(requestHermes).toHaveBeenNthCalledWith(1, 'profiles.configure', {
      name: 'liquidaity-main',
      description: 'Hermes role only',
    });
    expect(body).not.toHaveProperty('runId');
    expect(body).not.toHaveProperty('cardRevision');
    expect(deck.nodes[0].prompt).toBe('Card contract');
  });

  it.each([
    {
      method: 'learning.detail',
      params: { id: 'skill:research' },
    },
    {
      method: 'learning.edit',
      params: { id: 'skill:research', content: 'Updated content' },
    },
  ])('preserves the Hermes $method operation on the bound profile', async ({ method, params }) => {
    const { base, requestHermes } = await start();
    const response = await fetch(`${base}/cards/card_main/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1', deckId: 'deck_builder', method, params,
      }),
    });

    expect(response.status).toBe(200);
    expect(requestHermes).toHaveBeenNthCalledWith(1, method, params, 'liquidaity-main');
    expect(requestHermes).toHaveBeenCalledTimes(4);
  });

  it.each([
    { memory_provider: 'honcho' },
    { subagent_model: { provider: 'openai-codex', model: 'gpt-5.6-luna' } },
  ])('rejects unsupported profile configuration before Hermes: %j', async (params) => {
    const { base, requestHermes } = await start();
    const response = await fetch(`${base}/cards/card_main/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1', deckId: 'deck_builder', method: 'profiles.configure', params,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'hermes_profile_operation_invalid',
    });
    expect(requestHermes).not.toHaveBeenCalled();
  });

  it('rejects unsupported background-review configuration before Hermes', async () => {
    const { base, requestHermes } = await start();
    const response = await fetch(`${base}/cards/card_main/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        deckId: 'deck_builder',
        method: 'profiles.configure',
        params: {
          background_review: {
            enabled: true,
            provider: 'openai-codex',
            model: 'gpt-5.6-luna',
            max_input_tokens: 120_001,
          },
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'hermes_profile_operation_invalid',
    });
    expect(requestHermes).not.toHaveBeenCalled();
  });

  it('rejects a second profile-local Soul write path before Hermes', async () => {
    const { base, requestHermes } = await start();
    const response = await fetch(`${base}/cards/card_main/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        deckId: 'deck_builder',
        method: 'profiles.configure',
        params: { soul: 'Soul' },
      }),
    });

    expect(response.status).toBe(400);
    expect(requestHermes).not.toHaveBeenCalled();
  });
});
