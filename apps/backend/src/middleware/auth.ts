import { Request, Response, NextFunction } from 'express';
import {
  createAnonymousSession,
  getUserBySessionId,
  setSessionCookie,
} from '../auth/sessionStore';
import { isLocalDevLoopbackRequest } from '../security/requestAccess';
import { internalMcpBridgeSecretAuthorized } from '../services/mcp/internalMcpAuth';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const requestPath = String(req.originalUrl || '').split('?', 1)[0];
  const cardRunAction = String(req.body?.action || '').trim();
  if (
    req.method === 'POST'
    && requestPath === '/api/cards/run'
    && (cardRunAction === 'execute' || cardRunAction === 'status')
    && isLocalDevLoopbackRequest(req)
    && internalMcpBridgeSecretAuthorized(req.headers['x-liquidaity-internal-mcp-secret'])
  ) {
    (req as any).internalMcpBridgeAuthenticated = true;
    next();
    return;
  }
  const sessionId = req.cookies.sid;
  if (sessionId) {
    try {
      const user = await getUserBySessionId(sessionId);
      if (user) {
        (req as any).userId = user.id;
        next();
        return;
      }
      // Session is invalid/expired - fall through to create new session for local dev
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal server error' });
      return;
    }
  }

  if (isLocalDevLoopbackRequest(req)) {
    try {
      const { user, session } = await createAnonymousSession();
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
