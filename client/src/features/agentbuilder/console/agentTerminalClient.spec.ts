// @vitest-environment jsdom

// Entity: Card Terminals
// Relationship: This file verifies terminal preflight accepts only the requested Card identity and an application-owned same-origin WebSocket path.
// Entity: Hermes Card Sessions
// Relationship: This file verifies direct Gateway URLs and session readback for another Card are rejected before a terminal stream opens.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentTerminalClient } from './agentTerminalClient';

const identity = {
  projectId: 'project-one',
  deckId: 'deck_builder',
  cardId: 'builder',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agentTerminalClient preflight', () => {
  it('constructs one same-origin WebSocket URL from exact server readback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        ...identity,
        profile: 'builder',
        sessionId: 'session-builder',
        cols: 100,
        rows: 30,
        websocketPath: '/api/card-terminals/project-one/deck_builder/builder/stream',
      }),
    })));

    const session = await agentTerminalClient.open(identity, { cols: 100, rows: 30 });

    expect(session).toMatchObject({
      ...identity,
      profile: 'builder',
      sessionId: 'session-builder',
      status: 'opening',
      cols: 100,
      rows: 30,
    });
    const websocket = new URL(session.websocketUrl);
    expect(websocket.origin).toBe(window.location.origin.replace('http:', 'ws:'));
    expect(websocket.pathname).toBe(
      '/api/card-terminals/project-one/deck_builder/builder/stream',
    );
  });

  it('rejects a direct Hermes URL even when every identity field is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        ...identity,
        profile: 'builder',
        sessionId: 'session-builder',
        websocketPath: 'ws://127.0.0.1:9119/api/pty?token=secret',
      }),
    })));

    await expect(agentTerminalClient.open(identity, { cols: 80, rows: 24 }))
      .rejects.toThrow('card_terminal_invalid_response');
  });

  it('rejects a preflight response for another Card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        projectId: 'project-one',
        deckId: 'deck_builder',
        cardId: 'other-card',
        profile: 'other',
        sessionId: 'session-other',
        websocketPath: '/api/card-terminals/project-one/deck_builder/other-card/stream',
      }),
    })));

    await expect(agentTerminalClient.open(identity, { cols: 80, rows: 24 }))
      .rejects.toThrow('card_terminal_invalid_response');
  });
});
