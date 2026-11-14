/**
 * Entity: Trading
 * Relationship: Verifies authenticated Trading routes forward exact saved Card selectors, stream normalized state, record bounded interventions with actor lineage, and reject order-shaped actions.
 */

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./projectAccess', () => ({
  requireOwnedProject: vi.fn(async () => ({ ownerUserId: 'owner-one' })),
}));

import { createTradingRouter } from './trading.routes';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { requireOwnedProject } from './projectAccess';

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
  it('retains an explicit comparison only for an owned Project and forwards no supplied result', async () => {
    const { base, requestRails } = await serve();
    const body = { projectId: 'project-1', deckId: 'deck', cardId: 'trader', forecastId: 'forecast-1' };
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, metrics: { invented: true } }) };
    expect((await fetch(base + '/forecasts/compare', request)).status).toBe(200);
    expect(requestRails).toHaveBeenCalledWith('/trading/forecasts/compare', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(requestRails.mock.calls[0][1]?.body))).toEqual(body);
    vi.mocked(requireOwnedProject).mockImplementationOnce(async (_req, res) => { res.status(403).json({ error: 'forbidden' }); return null; });
    expect((await fetch(base + '/forecasts/compare', request)).status).toBe(403);
    expect(requestRails).toHaveBeenCalledTimes(1);
  });
  it('reads chart history for the exact forecast Card and rejects another Project before fetching data', async () => {
    const { base, requestRails } = await serve();
    const path = '/forecast/history?projectId=project-1&deckId=deck_builder&cardId=quant&symbol=SPY&timeframe=1Hour';
    expect((await fetch(base + path)).status).toBe(200);
    expect(requestRails).toHaveBeenCalledExactlyOnceWith('/trading' + path, { method: 'GET' });
    vi.mocked(requireOwnedProject).mockImplementationOnce(async (_req, res) => { res.status(403).json({ error: 'forbidden' }); return null; });
    expect((await fetch(base + path.replace('project-1', 'foreign'))).status).toBe(403);
    expect(requestRails).toHaveBeenCalledTimes(1);
  });
  it('does not generate forecasts for an unowned Project', async () => {
    vi.mocked(requireOwnedProject).mockImplementationOnce(async (_req, res) => { res.status(403).json({ error: 'forbidden' }); return null; });
    const { base, requestRails } = await serve();
    const response = await fetch(base + '/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'foreign', symbol: 'SPY' }) });
    expect(response.status).toBe(403);
    expect(requestRails).not.toHaveBeenCalled();
  });

  it('forwards one explicit forecast and scopes later reads to the same Project and Card', async () => {
    const { base, requestRails } = await serve();
    const payload = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'trader', symbol: 'SPY', timeframe: '1Day',
      temperature: .6, top_p: .95, top_k: 0, seed: 444, sample_count: 16 };
    expect((await fetch(base + '/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status).toBe(200);
    expect(JSON.parse(String(requestRails.mock.calls[0][1]?.body))).toEqual(payload);
    await fetch(base + '/forecasts?projectId=project-1&deckId=deck_builder&cardId=trader&forecastId=f-1&compare=true');
    expect(requestRails.mock.calls[1][0]).toBe('/trading/forecasts?projectId=project-1&deckId=deck_builder&cardId=trader&forecastId=f-1&compare=true');
  });
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

});
