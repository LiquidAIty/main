import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTradingRouter } from './trading.routes';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function serve(
  requestRails = vi.fn<typeof requestPythonRailsJson>(async () => ({ ok: true })),
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'user-123';
    next();
  });
  app.use('/trading', createTradingRouter({ requestRails }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  closers.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/trading`,
    requestRails,
  };
}

describe('authenticated Trading presentation transport', () => {
  it('passes only exact saved Card state selectors to Python rails', async () => {
    const { base, requestRails } = await serve();
    const response = await fetch(
      `${base}/state?projectId=project-1&deckId=deck_builder&cardId=card_trading_workbench`,
    );

    expect(response.status).toBe(200);
    expect(requestRails).toHaveBeenCalledExactlyOnceWith(
      '/trading/state?projectId=project-1&deckId=deck_builder&cardId=card_trading_workbench&timeframe=5Min',
      { method: 'GET' },
    );
  });

  it('records only bounded user interventions with authenticated actor lineage', async () => {
    const { base, requestRails } = await serve();
    const response = await fetch(`${base}/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        cardId: 'card_trading_workbench',
        jobId: 'job-1',
        action: 'resume',
        reason: 'Required evidence is fresh again.',
      }),
    });

    expect(response.status).toBe(200);
    const call = requestRails.mock.calls[0];
    expect(call[0]).toBe('/trading/intervene');
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId: 'card_trading_workbench',
      jobId: 'job-1',
      action: 'RESUME',
      reason: 'Required evidence is fresh again.',
      actor: 'authenticated-user:user-123',
    });
  });

  it('rejects an order-shaped or unsupported intervention before Python rails', async () => {
    const { base, requestRails } = await serve();
    const response = await fetch(`${base}/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ENTER' }),
    });

    expect(response.status).toBe(400);
    expect(requestRails).not.toHaveBeenCalled();
  });

  it('starts only the fixed authenticated local lifecycle proof', async () => {
    const { base, requestRails } = await serve();
    const response = await fetch(`${base}/lifecycle/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        cardId: 'card_trading_workbench',
        idempotencyKey: 'proof-1',
        broker: 'live',
        code: 'submit_order()',
      }),
    });

    expect(response.status).toBe(200);
    const call = requestRails.mock.calls[0];
    expect(call[0]).toBe('/trading/lifecycle/backtest');
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId: 'card_trading_workbench',
      idempotencyKey: 'proof-1',
      actor: 'authenticated-user:user-123',
    });
    expect(call[2]).toEqual({ timeoutMs: 120_000 });
  });

  it('streams normalized snapshots through the same authenticated selector path', async () => {
    const snapshot = {
      cardId: 'card_trading_workbench',
      observedAt: '2026-09-03T00:00:00Z',
      jobs: [],
    };
    const { base, requestRails } = await serve(
      vi.fn<typeof requestPythonRailsJson>(async () => snapshot),
    );
    const controller = new AbortController();
    const response = await fetch(
      `${base}/events?projectId=project-1&deckId=deck_builder&cardId=card_trading_workbench&timeframe=15Min`,
      { signal: controller.signal },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let payload = '';
    while (!payload.includes('event: snapshot')) {
      const next = await reader.read();
      if (next.done) break;
      payload += decoder.decode(next.value);
    }
    controller.abort();
    expect(payload).toContain(`data: ${JSON.stringify(snapshot)}`);
    expect(requestRails).toHaveBeenCalledWith(
      '/trading/state?projectId=project-1&deckId=deck_builder&cardId=card_trading_workbench&timeframe=15Min',
      { method: 'GET' },
    );
  });
});
