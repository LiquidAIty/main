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
    resolveProjectRosters: vi.fn().mockResolvedValue([]),
    openProjectRosterTarget: vi.fn().mockResolvedValue('stored-target-conversation'),
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

  it('uses the verified outer Magnetic Run without fabricating a Bot Chat context', async () => {
    const deps = dependencies();
    Object.assign(deps.authenticated, {
      executionContext: { parentRunId: 'outer-magnetic-run', conversationId: '' },
      request: {
        version: 2,
        expiresAt: 1_000,
        nonce: 'c'.repeat(32),
        sourceTaskId: 'worker-task-one',
        sourceTaskRunId: 23,
        sourceProfile: 'builder',
        tool: 'card__engraphis_stats',
        arguments: { project: 'project-one' },
      },
    });

    await expect(post(deps)).resolves.toEqual({
      status: 200,
      body: { ok: true, output: '{"ok":true}' },
    });
    expect(deps.activeContext).not.toHaveBeenCalled();
    expect(deps.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      projectId: 'project-one',
      deckId: 'deck-one',
      cardId: 'builder',
      cardRevisionId: 'revision-one',
      configurationFingerprint: 'a'.repeat(64),
      toolName: 'engraphis_stats',
      arguments: { project: 'project-one' },
      conversationId: '',
      parentRunId: 'outer-magnetic-run',
    }));
  });

  it('returns only the signed session Project orange-flow roster', async () => {
    const deps = dependencies();
    deps.authenticated.canonicalToolName = 'project_roster.resolve';
    deps.authenticated.request.tool = 'project_roster.resolve';
    deps.resolveProjectRosters.mockResolvedValue([
      {
        cardId: 'builder', cardRevisionId: 'revision-one', profile: 'builder',
        title: 'Builder', botEnabled: true, roster: ['knowgraph'],
      },
      {
        cardId: 'knowgraph', cardRevisionId: 'revision-two', profile: 'knowgraph',
        title: 'KnowGraph', botEnabled: true, roster: [],
      },
      {
        cardId: 'magnetic', cardRevisionId: 'revision-three', profile: 'magnetic',
        title: 'Magnetic', botEnabled: true, roster: [],
      },
    ]);

    const response = await post(deps);

    expect(response.status).toBe(200);
    expect(JSON.parse((response.body as { output: string }).output)).toEqual({
      targets: [{ title: 'KnowGraph', profile: 'knowgraph' }],
    });
    expect(deps.resolveProjectRosters).toHaveBeenCalledExactlyOnceWith(
      'project-one', 'deck-one',
    );
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('binds an authorized visible target to its exact Project conversation session', async () => {
    const deps = dependencies();
    deps.authenticated.canonicalToolName = 'project_roster.resolve';
    Object.assign(deps.authenticated.owner, { conversationId: 'conversation-one' });
    deps.authenticated.request.tool = 'project_roster.resolve';
    Object.assign(deps.authenticated.request.arguments, { target: 'KnowGraph' });
    const source = {
      cardId: 'builder', cardRevisionId: 'revision-one', profile: 'builder',
      title: 'Builder', botEnabled: true, roster: ['knowgraph'],
    };
    const target = {
      cardId: 'knowgraph', cardRevisionId: 'revision-two', profile: 'knowgraph',
      title: 'KnowGraph', botEnabled: true, roster: [],
    };
    deps.resolveProjectRosters.mockResolvedValue([source, target]);

    const response = await post(deps);

    expect(response.status).toBe(200);
    expect(JSON.parse((response.body as { output: string }).output)).toEqual({
      targets: [{ title: 'KnowGraph', profile: 'knowgraph' }],
      resolved: { profile: 'knowgraph', storedSessionId: 'stored-target-conversation' },
    });
    expect(deps.openProjectRosterTarget).toHaveBeenCalledExactlyOnceWith(
      deps.authenticated,
      target,
    );
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('does not normalize another address prefix at the signed authority boundary', async () => {
    const deps = dependencies();
    deps.authenticated.canonicalToolName = 'project_roster.resolve';
    deps.authenticated.request.tool = 'project_roster.resolve';
    Object.assign(deps.authenticated.request.arguments, { target: '@KnowGraph' });
    deps.resolveProjectRosters.mockResolvedValue([
      {
        cardId: 'builder', cardRevisionId: 'revision-one', profile: 'builder',
        title: 'Builder', botEnabled: true, roster: ['knowgraph'],
      },
      {
        cardId: 'knowgraph', cardRevisionId: 'revision-two', profile: 'knowgraph',
        title: 'KnowGraph', botEnabled: true, roster: [],
      },
    ]);

    const response = await post(deps);

    expect(response).toEqual({
      status: 403,
      body: { error: 'hermes_project_roster_target_forbidden' },
    });
    expect(deps.openProjectRosterTarget).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
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
