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
    role: 'Planner',
    prompt: 'Instructions',
    runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
    runtimeOptions: { provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-5.6-luna' },
    position: { x: 0, y: 0 },
  }],
};

function native() {
  return {
    profile: {
      name: 'liquidaity-main',
      description: 'Planner',
      soul: 'Instructions',
      model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
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
  it('hydrates the real saved Hermes Card without returning secret-shaped fields', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/cards/card_main?projectId=p1&deckId=deck_builder`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.drift.status).toBe('in_sync');
    expect(JSON.stringify(body)).not.toMatch(/api.?key|access.?token|refresh.?token|client.?secret|bearer\s+[a-z0-9]/i);
  });

  it('performs an identical no-op apply without a native configure call', async () => {
    const requestExtension = vi.fn(async () => native());
    const { base } = await start(requestExtension);
    const hydrated = await (await fetch(`${base}/cards/card_main?projectId=p1&deckId=deck_builder`)).json();
    requestExtension.mockClear();
    const response = await fetch(`${base}/cards/card_main/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        deckId: 'deck_builder',
        expectedFingerprint: hydrated.fingerprint,
        draft: {
          role: 'Planner',
          prompt: 'Instructions',
          runtime: deck.nodes[0].runtime,
          runtimeOptions: deck.nodes[0].runtimeOptions,
        },
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.mutated).toBe(false);
    expect(requestExtension).toHaveBeenCalledTimes(1);
  });

  it('rejects secret-shaped or unknown draft fields before contacting Hermes', async () => {
    const { base, requestExtension } = await start();
    const response = await fetch(`${base}/cards/card_main/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        deckId: 'deck_builder',
        expectedFingerprint: 'fingerprint',
        draft: { apiKey: 'must-not-pass' },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'hermes_card_draft_unknown_field:apiKey' });
    expect(requestExtension).not.toHaveBeenCalled();
  });
});
