// Entity: IDD
// Relationship: This file verifies the Card options route returns only the Python-owned field and catalog projection and fails closed on malformed output.

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestPythonRailsJson: vi.fn(),
}));

vi.mock('../services/pythonRailsClient', () => ({
  requestPythonRailsJson: mocks.requestPythonRailsJson,
}));

import router from './cardOptions.routes';

async function getOptions(): Promise<Response> {
  const app = express();
  app.use('/api/cards', router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${address.port}/api/cards/options`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(
      error => error ? reject(error) : resolve(),
    ));
  }
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('Card editor options route', () => {
  it('returns only the Python-owned field and catalog projection', async () => {
    mocks.requestPythonRailsJson.mockResolvedValue({
      fields: [{ id: 'modelKey', type: 'select' }],
      catalogs: { models: [{ id: 'model-one' }] },
    });

    const response = await getOptions();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      fields: [{ id: 'modelKey', type: 'select' }],
      catalogs: { models: [{ id: 'model-one' }] },
    });
    expect(mocks.requestPythonRailsJson).toHaveBeenCalledWith(
      '/card-editor/options',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails closed when the Python projection is malformed', async () => {
    mocks.requestPythonRailsJson.mockResolvedValue({ fields: [] });

    const response = await getOptions();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'runtime_options_unavailable',
    });
  });
});
