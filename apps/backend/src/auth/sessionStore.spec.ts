/**
 * Entity: Authentication
 * Relationship: Verifies session bearer tokens are digest-only at rest, expired records are removed, delete failures remain honest, and cookie attributes match lifecycle.
 */

import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../services/database', () => ({
  prisma: { session: db },
}));

import {
  clearSessionCookie,
  createSession,
  getUserBySessionId,
  removeSession,
  setSessionCookie,
} from './sessionStore';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('server session authority', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('stores only the digest of a new 256-bit bearer token', async () => {
    db.create.mockImplementation(async ({ data }: { data: { id: string; userId: string } }) => ({
      ...data,
      createdAt: new Date(),
    }));

    const session = await createSession('owner-one');

    expect(session.id).toMatch(/^[a-f0-9]{64}$/);
    const persisted = db.create.mock.calls[0]?.[0].data;
    expect(persisted.id).toBe(digest(session.id));
    expect(persisted.id).not.toBe(session.id);
    expect(persisted.userId).toBe('owner-one');
  });

  it('resolves an active digest and deletes an expired session', async () => {
    const user = {
      id: 'owner-one', email: 'owner@example.test', name: 'Owner', createdAt: new Date(),
    };
    db.findUnique
      .mockResolvedValueOnce({ createdAt: new Date('2026-10-01T12:00:00.000Z'), user })
      .mockResolvedValueOnce({ createdAt: new Date('2026-09-01T12:00:00.000Z'), user });
    db.delete.mockResolvedValue({});

    await expect(getUserBySessionId('active-token')).resolves.toEqual(user);
    await expect(getUserBySessionId('expired-token')).resolves.toBeNull();

    expect(db.findUnique.mock.calls[0]?.[0].where).toEqual({ id: digest('active-token') });
    expect(db.findUnique.mock.calls[1]?.[0].where).toEqual({ id: digest('expired-token') });
    expect(db.delete).toHaveBeenCalledWith({ where: { id: digest('expired-token') } });
  });

  it('ignores only an exact missing-session delete and propagates storage failures', async () => {
    db.delete.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'P2025' }));
    await expect(removeSession('already-gone')).resolves.toBeUndefined();

    db.delete.mockRejectedValueOnce(Object.assign(new Error('database offline'), { code: 'P1001' }));
    await expect(removeSession('still-live')).rejects.toThrow('database offline');
  });

  it('uses matching bounded cookie attributes for set and clear', () => {
    const response = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as unknown as Response;
    const request = {
      secure: false,
      headers: {},
    } as Request;

    setSessionCookie(response, 'session-token', request);
    clearSessionCookie(response, request);

    expect(response.cookie).toHaveBeenCalledWith('sid', 'session-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    expect(response.clearCookie).toHaveBeenCalledWith('sid', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });
});
