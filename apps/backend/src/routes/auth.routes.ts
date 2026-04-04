import { Router } from 'express';
import {
  canIssueBootstrapSession,
} from '../security/requestAccess';
import {
  clearSessionCookie,
  createAnonymousSession,
  getUserBySessionId,
  removeSession,
  setSessionCookie,
} from '../auth/sessionStore';

const authRouter = Router();

authRouter.post('/start', async (req, res) => {
  try {
    if (!canIssueBootstrapSession(req)) {
      return res.status(403).json({
        error: 'bootstrap_disabled',
        message: 'Session bootstrap is only available for local development or with an explicit bootstrap token.',
      });
    }

    const { user, session } = await createAnonymousSession();
    setSessionCookie(res, session.id, req);
    return res.json({ userId: user.id });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

authRouter.get('/me', async (req, res) => {
  try {
    const sessionId = req.cookies.sid;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await getUserBySessionId(sessionId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    return res.json({ userId: user.id });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

authRouter.post('/logout', async (req, res) => {
  try {
    const sessionId = req.cookies.sid;
    if (sessionId) {
      await removeSession(sessionId);
    }

    clearSessionCookie(res, req);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default authRouter;
