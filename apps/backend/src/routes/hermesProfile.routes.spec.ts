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
  nodes: [{
    id: 'card_main',
    templateId: 'main',
    title: 'Main Chat',
    role: 'Card role',
    prompt: 'Card contract',
    runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
    runtimeOptions: { tools: ['main.context'] },
    position: { x: 0, y: 0 },
  }],
};

function native() {
  return {
    name: 'liquidaity-main',
    description: 'Native description',
    soul: 'Native SOUL',
    model: { provider: 'openai-codex', default: 'gpt-native' },
    skills: [],
    toolsets: [],
    toolsets_pinned: false,
    mcp_servers: [],
  };
}

function nativeRequest() {
  return vi.fn(async (method: string) => {
    if (method === 'profiles.describe') return native();
    if (method === 'mcp.servers.list') return { servers: [] };
    if (method === 'learning.frames') return { count: 0, summary: '', buckets: [] };
    if (method === 'learning.graph') return {
      profile: 'liquidaity-main',
      generated_at: '2026-08-29T00:00:00Z',
      counts: { nodes: 0, edges: 0, memories: 0 },
      nodes: [],
      edges: [],
    };
    if (method === 'profiles.configure') return { ok: true, applied: { description: true } };
    throw new Error(`unexpected_native_method:${method}`);
  });
}

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(requestNative = nativeRequest()) {
  const app = express();
  app.use(express.json());
  app.use('/hermes-profile', createHermesProfileRouter({
    getDeck: vi.fn(async () => ({ deck, meta: { deckRevision: 'rev-1', deckSavedAt: null } })),
    requestNative: requestNative as never,
  }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  return { base: `http://127.0.0.1:${address.port}/hermes-profile`, requestNative };
}

describe('Hermes profile Card routes', () => {
  it('reads the bound native profile without returning secret-shaped fields', async () => {
    const { base, requestNative } = await start();
    const response = await fetch(`${base}/cards/card_main?projectId=p1&deckId=deck_builder`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.nativeApply).toBe('explicit');
    expect(body.cardSaveMutatesNative).toBe(false);
    expect(body.binding).toMatchObject({ profile: 'liquidaity-main', mode: 'main' });
    expect(body.native).toMatchObject({ description: 'Native description', soul: 'Native SOUL' });
    expect(requestNative).toHaveBeenCalledTimes(4);
    expect(requestNative).toHaveBeenNthCalledWith(1, 'profiles.describe', { name: 'liquidaity-main' });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|access.?token|refresh.?token|client.?secret|bearer\s+[a-z0-9]/i);
  });

  it('applies one supported native operation without creating a Card revision or Run', async () => {
    const { base, requestNative } = await start();
    const response = await fetch(`${base}/cards/card_main/native`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        deckId: 'deck_builder',
        method: 'profiles.configure',
        params: { description: 'Native role only' },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.method).toBe('profiles.configure');
    expect(body.cardSaveMutatesNative).toBe(false);
    expect(requestNative).toHaveBeenCalledTimes(5);
    expect(requestNative).toHaveBeenNthCalledWith(1, 'profiles.configure', {
      name: 'liquidaity-main',
      description: 'Native role only',
    });
    expect(body).not.toHaveProperty('runId');
    expect(body).not.toHaveProperty('cardRevision');
    expect(deck.nodes[0].prompt).toBe('Card contract');
  });

  it('applies the bounded account Luna background-review selector and reads it back', async () => {
    const requestNative = vi.fn(async (
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<unknown> => {
      if (method === 'profiles.configure') return { ok: true, applied: { background_review: true } };
      if (method === 'profiles.describe') return {
        ...native(),
        background_review: {
          enabled: true,
          provider: 'openai-codex',
          model: 'gpt-5.6-luna',
          max_input_tokens: 120_000,
        },
      };
      if (method === 'mcp.servers.list') return { servers: [] };
      if (method === 'learning.frames') return { count: 0, summary: '', buckets: [] };
      if (method === 'learning.graph') return { nodes: [], edges: [], clusters: [], memory: [], stats: {} };
      throw new Error(`unexpected_native_method:${method}:${JSON.stringify(params)}`);
    });
    const { base } = await start(requestNative);
    const response = await fetch(`${base}/cards/card_main/native`, {
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
            max_input_tokens: 120_000,
          },
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requestNative).toHaveBeenNthCalledWith(1, 'profiles.configure', {
      name: 'liquidaity-main',
      background_review: {
        enabled: true,
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        max_input_tokens: 120_000,
      },
    });
    expect(body.native.backgroundReview).toEqual({
      enabled: true,
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      maxInputTokens: 120_000,
    });
  });

  it('rejects unbounded or malformed background-review selectors before Hermes', async () => {
    const { base, requestNative } = await start();
    const response = await fetch(`${base}/cards/card_main/native`, {
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
    expect(requestNative).not.toHaveBeenCalled();
  });

  it('rejects broad or extra-field synchronization payloads before Hermes', async () => {
    const { base, requestNative } = await start();
    const response = await fetch(`${base}/cards/card_main/native`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        deckId: 'deck_builder',
        method: 'profiles.configure',
        params: { soul: 'Soul' },
        prompt: 'must not synchronize',
      }),
    });

    expect(response.status).toBe(400);
    expect(requestNative).not.toHaveBeenCalled();
  });
});
