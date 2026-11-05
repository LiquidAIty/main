// Entity: Building Modeling
// Relationship: Verifies the shared HTTP transport preserves Project ownership and Python failure responses without simulating engineering behavior.
import express from 'express';
import { Agent } from 'undici';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ owned: vi.fn(), rails: vi.fn() }));
vi.mock('./projectAccess', () => ({ requireOwnedProject: mocks.owned }));
vi.mock('../services/pythonRailsClient', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/pythonRailsClient')>();
  return { ...actual, requestPythonRailsJson: mocks.rails };
});
import router from './nrgsim.routes';
import { PythonRailsHttpError } from '../services/pythonRailsClient';

describe('Project-owned modeling transport', () => {
  let server: Server, url: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    const app = express(); app.use(express.json()); app.use(router);
    server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    const address = server.address() as { port: number };
    url = `http://127.0.0.1:${address.port}/projects/requested-project`;
    mocks.owned.mockResolvedValue({ projectId: 'canonical-owned-project' });
  });
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const post = (payload: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  it('injects the canonical owned Project without changing domain arguments', async () => {
    mocks.rails.mockResolvedValue({ configured: true, cases: [] });
    expect((await post({ operation: 'state' })).status).toBe(200);
    expect(mocks.rails).toHaveBeenCalledWith('/nrgsim/projects/canonical-owned-project', expect.objectContaining({ body: '{"operation":"state"}' }), { timeoutMs: 930_000, dispatcher: expect.any(Agent) });
  });
  it('does not invoke Python for an unowned Project', async () => {
    mocks.owned.mockImplementation(async (_req, res) => { res.status(404).json({ error: 'project_not_found' }); return null; });
    expect((await post({ operation: 'run' })).status).toBe(404);
    expect(mocks.rails).not.toHaveBeenCalled();
  });
  it('preserves a refused edit rather than reporting success', async () => {
    mocks.rails.mockRejectedValue(new PythonRailsHttpError(409, 'Model revision changed'));
    const response = await post({ operation: 'glazing' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Model revision changed' });
  });
  it('serves the exact owned report with an inert document policy', async () => {
    const html = '<html><body>transport fixture</body></html>';
    mocks.rails.mockResolvedValue({ html });
    const response = await fetch(url + '/runs/known-run/report?caseId=case1');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
    expect(response.headers.get('content-security-policy')).toContain("sandbox; default-src 'none'");
    expect(mocks.rails).toHaveBeenCalledWith('/nrgsim/projects/canonical-owned-project', expect.objectContaining({
      body: JSON.stringify({ operation: 'report', caseId: 'case1', runId: 'known-run' }),
    }), { timeoutMs: 930_000, dispatcher: expect.any(Agent) });
  });
  it('does not read a report for an unowned Project', async () => {
    mocks.owned.mockImplementation(async (_req, res) => { res.status(404).end(); return null; });
    expect((await fetch(url + '/runs/known-run/report?caseId=case1')).status).toBe(404);
    expect(mocks.rails).not.toHaveBeenCalled();
  });
});
