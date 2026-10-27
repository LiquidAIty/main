/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Authentication
 * Relationship: This file binds authenticated session ownership to protected requests and creates the single local-development session only for loopback callers.
 */

import { Request, Response, NextFunction } from 'express';
import {
  createLocalSession,
  getUserBySessionId,
  setSessionCookie,
} from '../auth/sessionStore';
import { isLocalDevLoopbackRequest } from '../security/requestAccess';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.cookies.sid;
  if (sessionId) {
    try {
      const user = await getUserBySessionId(sessionId);
      if (user) {
        (req as any).userId = user.id;
        next();
        return;
      }
      // Session is invalid/expired - fall through to bind the one local user.
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal server error' });
      return;
    }
  }

  if (isLocalDevLoopbackRequest(req)) {
    try {
      const { user, session } = await createLocalSession();
      setSessionCookie(res, session.id, req);
      (req as any).userId = user.id;
      next();
      return;
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal server error' });
      return;
    }
  }

  res.status(401).json({ error: 'Not authenticated' });
}
