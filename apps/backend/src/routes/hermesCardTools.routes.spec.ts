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
      tuiPid: null, ptyId: null, hermesSessionId: 'hermes-one', storedSessionId: 'stored-one',
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
    cardRuntimeManager: {
      authenticateCardToolRequest: vi.fn().mockResolvedValue(authenticated),
    },
    activeContext: vi.fn().mockReturnValue(null),
    execute: vi.fn().mockResolvedValue({ ok: true, output: '{"ok":true}' }),
    observe: vi.fn().mockResolvedValue({ ok: true }),
    resolveProjectRosters: vi.fn().mockResolvedValue([]),
    openProjectRosterTarget: vi.fn().mockResolvedValue('stored-target'),
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
    expect(deps.cardRuntimeManager.authenticateCardToolRequest).not.toHaveBeenCalled();
  });

  it('uses only authenticated runtime identity and does not fabricate a Run for a Bot turn', async () => {
    const deps = dependencies();

    await expect(post(deps)).resolves.toEqual({
      status: 200,
      body: { ok: true, output: '{"ok":true}' },
    });
    expect(deps.cardRuntimeManager.authenticateCardToolRequest).toHaveBeenCalledWith(
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

  it('binds hook observations to the active Card Run without treating them as tools', async () => {
    const deps = dependencies();
    deps.activeContext.mockReturnValue({
      runId: 'run-one', conversationId: 'conversation-one', authorizedCanonicalTools: [],
    });
    Object.assign(deps.authenticated, {
      canonicalToolName: 'runtime.observe_attempt',
      request: {
        version: 1,
        expiresAt: 1_000,
        nonce: 'd'.repeat(32),
        sourceStoredSessionId: 'stored-one',
        tool: 'runtime.observe_attempt',
        arguments: { attempt: {
          eventId: 'llm:one:completed', attemptId: 'llm:one',
          kind: 'llm', phase: 'completed', durationMs: 12,
        } },
      },
    });

    await expect(post(deps)).resolves.toEqual({
      status: 200,
      body: { ok: true, output: '{"observed":true}' },
    });
    expect(deps.observe).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-one', deckId: 'deck-one', cardId: 'builder', runId: 'run-one',
      attempt: expect.objectContaining({ eventId: 'llm:one:completed', durationMs: 12 }),
    });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('resolves one Bot Mode target only from the source Card orange roster', async () => {
    const deps = dependencies();
    Object.assign(deps.authenticated, {
      canonicalToolName: 'project_roster.resolve',
      request: {
        version: 1,
        expiresAt: 1_000,
        nonce: 'e'.repeat(32),
        sourceStoredSessionId: 'stored-one',
        tool: 'project_roster.resolve',
        arguments: { target: 'Builder' },
      },
    });
    const source = {
      cardId: 'builder', cardRevisionId: 'revision-one', profile: 'builder',
      title: 'Builder', botEnabled: true, roster: ['target-profile'],
    };
    const target = {
      cardId: 'target-card', cardRevisionId: 'revision-target', profile: 'target-profile',
      title: 'Target', botEnabled: false, roster: [],
    };
    deps.resolveProjectRosters.mockResolvedValue([source, target]);

    await expect(post(deps)).resolves.toEqual({
      status: 403,
      body: { error: 'hermes_project_roster_target_forbidden' },
    });
    expect(deps.openProjectRosterTarget).not.toHaveBeenCalled();

    (deps.authenticated.request as any).arguments.target = 'Target';
    await expect(post(deps)).resolves.toEqual({
      status: 200,
      body: {
        ok: true,
        output: JSON.stringify({
          targets: [{ title: 'Target', profile: 'target-profile' }],
          resolved: { profile: 'target-profile', storedSessionId: 'stored-target' },
        }),
      },
    });
    expect(deps.openProjectRosterTarget).toHaveBeenCalledExactlyOnceWith(
      deps.authenticated,
      target,
    );
    expect(deps.execute).not.toHaveBeenCalled();
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

  it('maps every authentication rejection to one secret-free response', async () => {
    const deps = dependencies();
    deps.cardRuntimeManager.authenticateCardToolRequest.mockRejectedValue(
      new Error('signature_invalid:do-not-leak'),
    );

    const response = await post(deps);
    expect(response).toEqual({
      status: 401,
      body: { error: 'hermes_card_tool_authentication_failed' },
    });
    expect(JSON.stringify(response)).not.toContain('do-not-leak');
  });

  it('logs only a fixed internal authentication stage while keeping the response generic', async () => {
    const deps = dependencies();
    deps.cardRuntimeManager.authenticateCardToolRequest.mockRejectedValue(
      new Error('hermes_card_tool_authentication_failed:run_authorization'),
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const response = await post(deps);
      expect(response).toEqual({
        status: 401,
        body: { error: 'hermes_card_tool_authentication_failed' },
      });
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        '[hermes-card-tools] authentication failed stage=run_authorization',
      );
      expect(JSON.stringify(response)).not.toContain('run_authorization');
    } finally {
      warning.mockRestore();
    }
  });
});
