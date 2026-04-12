import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import type { User } from './userService';

const prisma = new PrismaClient();

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
}

export async function createSession(userId: string): Promise<Session> {
  const session = await prisma.session.create({
    data: {
      userId,
    },
  });

  return {
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt,
  };
}

export async function getUserBySessionId(sessionId: string): Promise<User | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
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

  return session.user;
}

export async function removeSession(sessionId: string): Promise<void> {
  await prisma.session.delete({
    where: { id: sessionId },
  }).catch(() => {
    // Session might not exist, ignore error
  });
}

// For backward compatibility with dev/bootstrap flow
export async function createAnonymousSession(): Promise<{ user: User; session: Session }> {
  // Create a temporary anonymous user
  const { createUser } = await import('./userService.js');
  const anonymousEmail = `anon-${Date.now()}-${Math.random().toString(36).substring(7)}@localhost`;
  const user = await createUser(anonymousEmail, Math.random().toString(36), 'Anonymous User');
  
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
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
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

// Export for backward compatibility
export { User };
