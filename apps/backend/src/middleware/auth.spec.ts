import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  createAnonymousSession: vi.fn(),
  getUserBySessionId: vi.fn(),
  setSessionCookie: vi.fn(),
}));

vi.mock('../auth/sessionStore', () => session);

import { authMiddleware } from './auth';

const previousSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;

afterEach(() => {
  vi.clearAllMocks();
  if (previousSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
  else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = previousSecret;
});

describe('backend authentication middleware', () => {
  it.each(['execute', 'status'])(
    'accepts the established loopback process bridge for %s without creating an anonymous user',
    async (action) => {
    const secret = 'internal-process-bridge-secret-0123456789abcdef';
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = secret;
    const request = {
      method: 'POST',
      originalUrl: '/api/cards/run',
      body: { action },
      cookies: {},
      headers: {
        host: '127.0.0.1:4000',
        'x-liquidaity-internal-mcp-secret': secret,
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(request, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((request as any).internalMcpBridgeAuthenticated).toBe(true);
    expect(session.createAnonymousSession).not.toHaveBeenCalled();
    expect(session.getUserBySessionId).not.toHaveBeenCalled();
    },
  );

  it.each(['inputs', 'stop', 'transcript', 'delete_transcript', ''])(
    'does not broaden the process bridge credential to the %s Card action',
    async (action) => {
      const secret = 'internal-process-bridge-secret-0123456789abcdef';
      process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = secret;
      session.createAnonymousSession.mockResolvedValue({
        user: { id: 'anonymous-owner' },
        session: { id: 'anonymous-session' },
      });
      const request = {
        method: 'POST',
        originalUrl: '/api/cards/run',
        body: { action },
        cookies: {},
        headers: {
          host: '127.0.0.1:4000',
          'x-liquidaity-internal-mcp-secret': secret,
        },
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;
      const next = vi.fn() as unknown as NextFunction;

      await authMiddleware(request, {} as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect((request as any).internalMcpBridgeAuthenticated).toBeUndefined();
      expect((request as any).userId).toBe('anonymous-owner');
      expect(session.createAnonymousSession).toHaveBeenCalledOnce();
    },
  );

  it('does not treat a foreign process secret as internal authentication', async () => {
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'internal-process-bridge-secret-0123456789abcdef';
    session.createAnonymousSession.mockResolvedValue({
      user: { id: 'anonymous-owner' },
      session: { id: 'anonymous-session' },
    });
    const request = {
      method: 'POST',
      originalUrl: '/api/cards/run',
      body: { action: 'execute' },
      cookies: {},
      headers: {
        host: '127.0.0.1:4000',
        'x-liquidaity-internal-mcp-secret': 'foreign',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(request, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((request as any).internalMcpBridgeAuthenticated).toBeUndefined();
    expect((request as any).userId).toBe('anonymous-owner');
    expect(session.createAnonymousSession).toHaveBeenCalledOnce();
  });

  it('does not broaden the process bridge credential to another backend route', async () => {
    const secret = 'internal-process-bridge-secret-0123456789abcdef';
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = secret;
    session.createAnonymousSession.mockResolvedValue({
      user: { id: 'anonymous-owner' },
      session: { id: 'anonymous-session' },
    });
    const request = {
      method: 'GET',
      originalUrl: '/api/projects/project/decks/deck',
      cookies: {},
      headers: {
        host: '127.0.0.1:4000',
        'x-liquidaity-internal-mcp-secret': secret,
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(request, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((request as any).internalMcpBridgeAuthenticated).toBeUndefined();
    expect((request as any).userId).toBe('anonymous-owner');
    expect(session.createAnonymousSession).toHaveBeenCalledOnce();
  });
});
