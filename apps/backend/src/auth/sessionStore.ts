/**
 * Entity: Authentication
 * Relationship: This file creates, resolves, expires, and removes owner sessions and applies the bounded secure session cookie lifecycle.
 * Entity: Credentials
 * Relationship: This file persists only a digest of each session bearer token and never returns the stored digest as the browser credential.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { User } from './userService';
import { prisma } from '../services/database';

const LOCAL_USER_EMAIL = 'local-user@localhost';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sessionDigest(sessionId: string): string {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
}

export async function createSession(userId: string): Promise<Session> {
  const sessionId = randomBytes(32).toString('hex');
  const session = await prisma.session.create({
    data: {
      id: sessionDigest(sessionId),
      userId,
    },
  });

  return {
    id: sessionId,
    userId: session.userId,
    createdAt: session.createdAt,
  };
}

export async function getUserBySessionId(sessionId: string): Promise<User | null> {
  const digest = sessionDigest(sessionId);
  const session = await prisma.session.findUnique({
    where: { id: digest },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }
  if (Date.now() - session.createdAt.getTime() >= SESSION_MAX_AGE_MS) {
    await prisma.session.delete({ where: { id: digest } }).catch((error: any) => {
      if (String(error?.code || '') !== 'P2025') throw error;
    });
    return null;
  }

  return session.user;
}

export async function removeSession(sessionId: string): Promise<void> {
  await prisma.session.delete({
    where: { id: sessionDigest(sessionId) },
  }).catch((error: any) => {
    if (String(error?.code || '') !== 'P2025') throw error;
  });
}

// Loopback development is one local product owner, not a new anonymous account
// per browser, host spelling, or cleared cookie. Future multi-user identity is a
// separate authenticated product boundary.
export async function createLocalSession(): Promise<{ user: User; session: Session }> {
  const { ensureLocalDevelopmentUser } = await import('./userService.js');
  const user = await ensureLocalDevelopmentUser(LOCAL_USER_EMAIL);
  const session = await createSession(user.id);

  return { user, session };
}

function shouldUseSecureCookie(req?: Request): boolean {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') return true;
  if (req?.secure) return true;
  const forwardedProto = String(req?.headers['x-forwarded-proto'] || '').toLowerCase();
  return forwardedProto === 'https';
}

export function setSessionCookie(res: Response, sessionId: string, req?: Request) {
  res.cookie('sid', sessionId, {
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response, req?: Request) {
  res.clearCookie('sid', {
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
    path: '/',
  });
}
