import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canIssueBootstrapSession: vi.fn(),
  createLocalSession: vi.fn(),
  getUserBySessionId: vi.fn(),
  setSessionCookie: vi.fn(),
}));
vi.mock('../security/requestAccess', () => ({ canIssueBootstrapSession: mocks.canIssueBootstrapSession }));
vi.mock('../auth/sessionStore', () => ({
  ...mocks, clearSessionCookie: vi.fn(), createSession: vi.fn(), removeSession: vi.fn(),
}));
vi.mock('../auth/userService', () => ({ createUser: vi.fn(), getUserByEmail: vi.fn(), verifyPassword: vi.fn() }));
import router from './auth.routes';

afterEach(() => { vi.resetAllMocks(); });

async function bootstrap(cookie?: string) {
  const app = express();
  app.use(cookieParser() as unknown as RequestHandler);
  app.use('/api/auth', router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/start`, {
      method: 'POST', headers: cookie ? { cookie } : {},
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('session bootstrap continuity', () => {
  it('keeps the authenticated identity and cookie when bootstrap is repeated', async () => {
    mocks.canIssueBootstrapSession.mockReturnValue(true);
    mocks.getUserBySessionId.mockResolvedValue({ id: 'existing-owner' });
    mocks.createLocalSession.mockResolvedValue({ user: { id: 'replacement-owner' }, session: { id: 'replacement-session' } });
    expect(await bootstrap('sid=existing-session')).toEqual({ status: 200, body: { userId: 'existing-owner' } });
    expect(mocks.getUserBySessionId).toHaveBeenCalledExactlyOnceWith('existing-session');
    expect(mocks.createLocalSession).not.toHaveBeenCalled();
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it.each([undefined, 'sid=expired-session'])('binds the one local user without a valid session (%s)', async cookie => {
    mocks.canIssueBootstrapSession.mockReturnValue(true);
    mocks.getUserBySessionId.mockResolvedValue(null);
    mocks.createLocalSession.mockResolvedValue({ user: { id: 'local-owner' }, session: { id: 'local-session' } });
    expect(await bootstrap(cookie)).toEqual({ status: 200, body: { userId: 'local-owner' } });
    expect(mocks.createLocalSession).toHaveBeenCalledOnce();
    expect(mocks.setSessionCookie).toHaveBeenCalledWith(expect.anything(), 'local-session', expect.anything());
  });

  it('preserves the bootstrap authorization boundary even with an existing cookie', async () => {
    mocks.canIssueBootstrapSession.mockReturnValue(false);
    expect((await bootstrap('sid=existing-session')).status).toBe(403);
    expect(mocks.getUserBySessionId).not.toHaveBeenCalled();
    expect(mocks.createLocalSession).not.toHaveBeenCalled();
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });
});
