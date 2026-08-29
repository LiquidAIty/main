import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';

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
      });

      const onEvent = vi.fn();
      const done = mainCliBridge.submit({
        runId: 'route-run-1',
        driverSource: 'internal_chat',
        message: 'hello',
        onEvent,
      });
      const next = await fetch(`${baseUrl}/next`, { headers: authorization });
      expect(next.status).toBe(200);
      const candidate = await next.json() as any;
      expect(candidate).toMatchObject({
        runId: 'route-run-1',
        driverSource: 'internal_chat',
        message: 'hello',
      });

      for (const event of [
        { ...candidate, kind: 'text', delta: 'answer' },
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
      });
      expect(onEvent).toHaveBeenCalledTimes(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    }
  });
});
