// Entity: Main Chat
// Relationship: Verifies the HTTP reply ends before one completed-pair storage call, including slow or failed storage.
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(), save: vi.fn(),
  listeners: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock('tsx/esm/api', () => ({ tsImport: async () => ({
  HermesGateway: class {
    connectionState = 'open';
    connect = async () => undefined;
    close = () => undefined;
    request = mocks.request;
    onEvent(listener: (event: Record<string, unknown>) => void) {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    }
    onState() { return () => undefined; }
  },
  STARTUP_REQUEST_TIMEOUT_MS: 60_000, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000,
  ensureLocalGateway: async () => ({ gatewayEndpoint: {}, baseUrl: 'http://unused' }),
  createGatewayTicketResolver: () => async () => 'test-ticket',
  configurePythonGatewayTicketClient: () => undefined,
  createLocalGatewayDials: () => ({ prepare: () => ({}) }),
  closeGatewayTicketBridges: () => undefined,
}) }));
vi.mock('../conversations/store', () => ({ appendConversationTurn: mocks.save, getConversationMessages: vi.fn() }));
vi.mock('../services/workingDirectories', () => ({ resolveRepoRoot: () => process.cwd() }));
vi.mock('../services/projectStore', () => ({ assertCardProfileOwner: vi.fn() }));
vi.mock('./projectAccess', () => ({ requireOwnedProject: async () => ({ ownerUserId: 'owner', projectId: 'project' }) }));
vi.mock('../services/projectCardAuthority', () => ({
  objectRecord: (value: unknown) => value || {}, exactStrings: () => [],
  projectCardAuthority: async () => {
    const main = { card: { id: 'main-card', runtime: { kind: 'hermes' } }, profile: 'main', title: 'Main' };
    const builder = { card: { id: 'builder-card', runtime: { kind: 'hermes' } }, profile: 'builder', title: 'Builder', address: 'Builder' };
    return { main, cards: [main, builder], deck: { id: 'deck', edges: [{ source: 'main-card', target: 'builder-card' }] } };
  },
}));
import router, { closeMainConnection } from './mainSession.routes';

let server: Server;
let base: string;
let serverResponse: express.Response;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ admission_id: 'admitted' });
  mocks.save.mockResolvedValue([]);
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { serverResponse = res; next(); });
  app.use(router);
  server = await new Promise<Server>(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  closeMainConnection();
  mocks.listeners.clear();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
});

async function submit(message = 'Compare Rocket Lab and Planet Labs.') {
  const response = await fetch(`${base}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'project', deckId: 'deck', message, clientMessageId: 'input',
      sessions: { 'main-card': 'main-session', 'builder-card': 'builder-session' } }) });
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  return response;
}
function emit(type: string, text: string, profile = 'main') {
  for (const listener of mocks.listeners) listener({ type, profile, session_id: `${profile}-session`,
    admission_id: 'admitted', payload: { text } });
}

it('ends the reply before starting one pair save and does not wait for that save', async () => {
  let release!: () => void;
  mocks.save.mockImplementationOnce(() => {
    expect(serverResponse.writableEnded).toBe(true);
    return new Promise(resolve => { release = () => resolve([]); });
  });
  const response = await submit();
  expect(mocks.save).not.toHaveBeenCalled();
  emit('message.delta', 'Live answer');
  await Promise.resolve();
  expect(mocks.save).not.toHaveBeenCalled();
  emit('message.complete', 'Live answer');
  const body = await response.text();
  expect(body).toContain('event: text');
  expect(body).toContain('event: done');
  expect(body).toContain('Live answer');
  expect(mocks.save).toHaveBeenCalledOnce();
  const saved = mocks.save.mock.calls[0][0];
  expect(saved.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant']);
  expect(saved.messages[0].content).toBe('Compare Rocket Lab and Planet Labs.');
  expect(saved.messages[1].content).toBe('Live answer');
  expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['prompt.submit']);
  release();
});

it('does not turn a failed save into a failed model reply', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.save.mockRejectedValue(new Error('storage unavailable'));
  const response = await submit();
  emit('message.complete', 'Delivered answer');
  const body = await response.text();
  expect(body).toContain('event: done');
  expect(body).not.toContain('event: error');
  expect(log).toHaveBeenCalled();
});

it('keeps Builder delivery and attribution on Builder when its save is delayed', async () => {
  let release!: () => void;
  mocks.save.mockReturnValueOnce(new Promise(resolve => { release = () => resolve([]); }));
  const response = await submit('@Builder Suggest two comparison fields.');
  emit('message.complete', 'Use revenue and cash flow.', 'builder');
  const body = await response.text();
  expect(body).toContain('@Builder Use revenue and cash flow.');
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', expect.objectContaining({
    profile: 'builder', session_id: 'builder-session',
  }), expect.any(Number));
  release();
  expect(mocks.save).toHaveBeenCalledOnce();
  const pair = mocks.save.mock.calls[0][0].messages;
  expect(pair[0].target.profile).toBe('builder');
  expect(pair[1].speaker.profile).toBe('builder');
});
