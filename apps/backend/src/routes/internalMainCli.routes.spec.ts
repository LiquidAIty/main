import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearHermesExecutionContextsForTest,
  registerHermesRootExecutionContext,
} from '../hermes/childExecutionContext';
import { mainCliBridge, mainCliBridgeToken } from '../hermes/mainCliBridge';
import router from './internalMainCli.routes';

async function createServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use('/internal/main-cli', router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/main-cli`,
  };
}

describe('internal Main CLI bridge routes', () => {
  beforeEach(() => clearHermesExecutionContextsForTest());

  it('requires the process token and transports one structured turn end to end', async () => {
    const { server, baseUrl } = await createServer();
    const authorization = { Authorization: `Bearer ${mainCliBridgeToken}` };
    try {
      expect((await fetch(`${baseUrl}/next`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/next`, { headers: authorization })).status).toBe(204);
      const history = await fetch(`${baseUrl}/history`, {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-1',
          messages: [{ role: 'assistant', text: 'prior answer' }],
        }),
      });
      expect(history.status).toBe(200);
      expect(mainCliBridge.history()).toEqual({
        sessionId: 'session-1',
        messages: [{ role: 'assistant', text: 'prior answer' }],
        projections: [],
      });

      const onEvent = vi.fn();
      const done = mainCliBridge.submit({
        runId: 'route-run-1',
        executionContextId: 'route-context-1',
        driverSource: 'internal_chat',
        message: 'hello',
        onEvent,
      });
      const next = await fetch(`${baseUrl}/next`, { headers: authorization });
      expect(next.status).toBe(200);
      const candidate = await next.json() as any;
      expect(candidate).toMatchObject({
        runId: 'route-run-1',
        executionContextId: 'route-context-1',
        driverSource: 'internal_chat',
        message: 'hello',
      });

      for (const event of [
        {
          ...candidate,
          kind: 'projection',
          projection: {
            schemaVersion: 'liquidaity.main.projection.v1',
            id: 'turn-1:conversation.answer:completed',
            category: 'conversation.answer',
            sequence: 1,
            timestamp: '2026-08-31T12:00:00.000Z',
            nativeSessionId: 'session-1',
            nativeTurnId: 'turn-1',
            state: 'completed',
            text: 'answer',
          },
        },
        {
          ...candidate,
          kind: 'completed',
          finalText: 'answer',
          nativeSessionId: 'session-1',
          nativeTurnId: 'turn-1',
        },
      ]) {
        const response = await fetch(`${baseUrl}/events`, {
          method: 'POST',
          headers: { ...authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });
        expect(response.status).toBe(200);
      }
      await expect(done).resolves.toEqual({
        finalText: 'answer',
        nativeSessionId: 'session-1',
        nativeTurnId: 'turn-1',
        contextAuthorityMode: 'main_native_honcho',
      });
      expect(onEvent).toHaveBeenCalledTimes(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    }
  });

  it('binds the exact Main root and acknowledges one native Team session delivery', async () => {
    const { server, baseUrl } = await createServer();
    const authorization = { Authorization: `Bearer ${mainCliBridgeToken}` };
    const jsonHeaders = { ...authorization, 'Content-Type': 'application/json' };
    try {
      const root = registerHermesRootExecutionContext({
        sessionId: 'main:route-run-team',
        runId: 'route-run-team',
        projectId: 'project-1',
        deckId: 'deck-1',
        conversationId: 'conversation-1',
        cardId: 'card_main_chat',
        runtimeMode: 'main',
        grantedTools: ['delegate_task'],
      });
      const turn = mainCliBridge.submit({
        runId: root.runId,
        executionContextId: root.contextId,
        driverSource: 'internal_chat',
        message: 'team mission',
        onEvent: vi.fn(),
      });
      const turnOutcome = turn.then(
        () => 'resolved',
        (error) => error instanceof Error ? error.message : String(error),
      );
      const candidateResponse = await fetch(`${baseUrl}/next`, { headers: authorization });
      const candidate = await candidateResponse.json() as any;
      const binding = await fetch(`${baseUrl}/execution/bind`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          requestId: candidate.requestId,
          runId: candidate.runId,
          executionContextId: candidate.executionContextId,
          sessionId: 'session-native-1',
        }),
      });
      expect(binding.status).toBe(200);

      const delivery = mainCliBridge.queueTeamResult({
        sessionId: 'session-native-1',
        taskId: 't_team',
        result: 'reviewed result',
        state: 'completed',
      }, 5_000);
      const nextDelivery = await fetch(`${baseUrl}/team-results/next`, {
        headers: authorization,
      });
      expect(nextDelivery.status).toBe(200);
      const deliveryPayload = await nextDelivery.json() as any;
      expect(deliveryPayload).toMatchObject({
        sessionId: 'session-native-1',
        taskId: 't_team',
        result: 'reviewed result',
        state: 'completed',
      });
      const ack = await fetch(`${baseUrl}/team-results/ack`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          deliveryId: deliveryPayload.deliveryId,
          delivered: true,
        }),
      });
      expect(ack.status).toBe(200);
      await expect(delivery).resolves.toBeUndefined();

      const failed = await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          requestId: candidate.requestId,
          runId: candidate.runId,
          kind: 'failed',
          error: 'test-complete',
        }),
      });
      expect(failed.status).toBe(200);
      await expect(turnOutcome).resolves.toBe('test-complete');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    }
  });
});
