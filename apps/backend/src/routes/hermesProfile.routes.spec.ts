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
    profile: {
      name: 'liquidaity-main',
      description: 'Native description',
      soul: 'Native SOUL',
      model: { provider: 'openai-codex', default: 'gpt-native' },
      skills: [],
      toolsets: [],
      toolsetsPinned: false,
      mcpServers: [],
    },
  };
}

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(requestExtension = vi.fn(async () => native())) {
  const app = express();
  app.use(express.json());
  app.use('/hermes-profile', createHermesProfileRouter({
    getDeck: vi.fn(async () => ({ deck, meta: { deckRevision: 'rev-1', deckSavedAt: null } })),
    requestExtension: requestExtension as never,
  }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  return { base: `http://127.0.0.1:${address.port}/hermes-profile`, requestExtension };
}

describe('Hermes profile Card routes', () => {
  it('reads the bound native profile without returning secret-shaped fields', async () => {
    const { base, requestExtension } = await start();
    const response = await fetch(`${base}/cards/card_main?projectId=p1&deckId=deck_builder`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.readOnly).toBe(true);
    expect(body.binding).toMatchObject({ profile: 'liquidaity-main', mode: 'main' });
    expect(body.native).toMatchObject({ description: 'Native description', soul: 'Native SOUL' });
    expect(requestExtension).toHaveBeenCalledTimes(1);
    expect(requestExtension).toHaveBeenCalledWith('_profile/read', { name: 'liquidaity-main' });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|access.?token|refresh.?token|client.?secret|bearer\s+[a-z0-9]/i);
  });

  it('does not expose Card-to-profile apply or preview endpoints', async () => {
    const { base, requestExtension } = await start();
    for (const suffix of ['apply', 'preview']) {
      const response = await fetch(`${base}/cards/card_main/${suffix}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', deckId: 'deck_builder', draft: { prompt: 'must not write' } }),
      });
      expect(response.status).toBe(404);
    }
    expect(requestExtension).not.toHaveBeenCalled();
  });
});
