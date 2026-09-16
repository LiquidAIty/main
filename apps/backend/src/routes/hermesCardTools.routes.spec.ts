import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createHermesCardToolsRouter } from './hermesCardTools.routes';

const envelope = { keyId: 'key-one', payload: 'signed-payload', signature: 'signed-value' };

function dependencies() {
  const authenticated = {
    owner: {
      userId: 'owner-one', projectId: 'project-one', deckId: 'deck-one', cardId: 'builder',
    },
    state: {
      sessionId: 'runtime-one', cardId: 'builder', profile: 'builder', pid: 1, gatewayPid: 1,
      tuiPid: null, ptyId: null, nativeSessionId: 'native-one', storedSessionId: 'stored-one',
      hermesHome: 'profile-home', unavailableToolReasons: {}, status: 'running' as const,
      cols: 120, rows: 36,
    },
    canonicalToolName: 'engraphis_stats',
    cardTools: {
      cardRevisionId: 'revision-one',
      configurationFingerprint: 'a'.repeat(64),
      runtimeMode: 'main' as const,
    },
    request: {
      version: 1 as const,
      expiresAt: 1_000,
      nonce: 'b'.repeat(32),
      sourceStoredSessionId: 'stored-one',
      tool: 'card__engraphis_stats',
      arguments: { project: 'project-one' },
    },
  };
  return {
    authenticated,
    agentTerminalManager: {
      authenticateCardToolRequest: vi.fn().mockResolvedValue(authenticated),
    },
    activeContext: vi.fn().mockReturnValue(null),
    execute: vi.fn().mockResolvedValue({ ok: true, output: '{"ok":true}' }),
    isLoopbackSocketRequest: vi.fn().mockReturnValue(true),
  };
}

async function post(deps: ReturnType<typeof dependencies>) {
  const app = express();
  app.use(express.json());
  app.use('/hermes-card-tools', createHermesCardToolsRouter(deps));
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/hermes-card-tools/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    )));
  }
}

describe('managed Hermes Card-tools host route', () => {
  it('rejects a non-loopback request before authenticating it', async () => {
    const deps = dependencies();
    deps.isLoopbackSocketRequest.mockReturnValue(false);

    await expect(post(deps)).resolves.toEqual({
      status: 403,
      body: { error: 'hermes_card_tool_loopback_required' },
    });
    expect(deps.agentTerminalManager.authenticateCardToolRequest).not.toHaveBeenCalled();
  });

  it('uses only authenticated runtime identity and does not fabricate a Run for a Bot turn', async () => {
    const deps = dependencies();

    await expect(post(deps)).resolves.toEqual({
      status: 200,
      body: { ok: true, output: '{"ok":true}' },
    });
    expect(deps.agentTerminalManager.authenticateCardToolRequest).toHaveBeenCalledWith(
      envelope.keyId,
      envelope.payload,
      envelope.signature,
    );
    expect(deps.activeContext).toHaveBeenCalledWith('runtime-one');
    expect(deps.execute).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-one',
      deckId: 'deck-one',
      cardId: 'builder',
      cardRevisionId: 'revision-one',
      configurationFingerprint: 'a'.repeat(64),
      runtimeMode: 'main',
      toolName: 'engraphis_stats',
      arguments: { project: 'project-one' },
      conversationId: '',
      parentRunId: '',
    });
  });

  it('maps every authentication rejection to one secret-free response', async () => {
    const deps = dependencies();
    deps.agentTerminalManager.authenticateCardToolRequest.mockRejectedValue(
      new Error('signature_invalid:do-not-leak'),
    );

    const response = await post(deps);
    expect(response).toEqual({
      status: 401,
      body: { error: 'hermes_card_tool_authentication_failed' },
    });
    expect(JSON.stringify(response)).not.toContain('do-not-leak');
  });
});
