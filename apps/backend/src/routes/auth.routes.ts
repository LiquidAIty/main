import { Router } from 'express';
import {
  canIssueBootstrapSession,
} from '../security/requestAccess';
import {
  clearSessionCookie,
  createAnonymousSession,
  createSession,
  getUserBySessionId,
  removeSession,
  setSessionCookie,
} from '../auth/sessionStore';
import {
  createUser,
  getUserByEmail,
  verifyPassword,
} from '../auth/userService';

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

authRouter.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email.trim().toLowerCase());
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create user
    const user = await createUser(email.trim().toLowerCase(), password, name);

    // Create session
    const session = await createSession(user.id);
    setSessionCookie(res, session.id, req);

    return res.json({ userId: user.id, email: user.email, name: user.name });
  } catch (error: any) {
    console.error('[auth] Signup error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Verify credentials
    const user = await verifyPassword(email.trim().toLowerCase(), password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create session
    const session = await createSession(user.id);
    setSessionCookie(res, session.id, req);

    return res.json({ userId: user.id, email: user.email, name: user.name });
  } catch (error: any) {
    console.error('[auth] Login error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default authRouter;
