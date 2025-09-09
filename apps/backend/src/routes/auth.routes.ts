import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await promisify(fs.mkdir)(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

// Read and write JSON files
async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  await ensureDataDir();
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error) {
    await writeJsonFile(filePath, defaultValue);
    return defaultValue;
  }
}

async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await ensureDataDir();
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tempFile, filePath);
}

interface User {
  id: string;
  created: string;
}

interface Session {
  id: string;
  userId: string;
  created: string;
}

async function getUsers(): Promise<User[]> {
  return readJsonFile(USERS_FILE, []);
}

async function saveUsers(users: User[]): Promise<void> {
  await writeJsonFile(USERS_FILE, users);
}

async function addUser(user: User): Promise<void> {
  const users = await getUsers();
  users.push(user);
  await saveUsers(users);
}

async function getSessions(): Promise<Session[]> {
  return readJsonFile(SESSIONS_FILE, []);
}

async function saveSessions(sessions: Session[]): Promise<void> {
  await writeJsonFile(SESSIONS_FILE, sessions);
}

async function addSession(session: Session): Promise<void> {
  const sessions = await getSessions();
  sessions.push(session);
  await saveSessions(sessions);
}

async function removeSession(sessionId: string): Promise<void> {
  const sessions = await getSessions();
  const updatedSessions = sessions.filter(s => s.id !== sessionId);
  await saveSessions(updatedSessions);
}

async function getUserBySessionId(sessionId: string): Promise<User | null> {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return null;
  const users = await getUsers();
  return users.find(u => u.id === session.userId) || null;
}

const authRouter = Router();

authRouter.post('/start', async (req, res) => {
  try {
    const userId = uuidv4();
    const user = {
      id: userId,
      created: new Date().toISOString()
    };
    await addUser(user);

    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      userId: userId,
      created: new Date().toISOString()
    };
    await addSession(session);

    // Set cookie with security attributes
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('sid', sessionId, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/'
    });

    return res.json({ userId });
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

    res.clearCookie('sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default authRouter;
