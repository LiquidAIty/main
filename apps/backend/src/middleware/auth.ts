import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);

const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error) {
    return defaultValue;
  }
}

interface Session {
  id: string;
  userId: string;
  created: string;
}

interface User {
  id: string;
  created: string;
}

async function getSessions(): Promise<Session[]> {
  return readJsonFile(SESSIONS_FILE, []);
}

async function getUsers(): Promise<User[]> {
  return readJsonFile(USERS_FILE, []);
}

async function getUserBySessionId(sessionId: string): Promise<User | null> {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return null;
  const users = await getUsers();
  return users.find(u => u.id === session.userId) || null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sessionId = req.cookies.sid;
  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  getUserBySessionId(sessionId).then(user => {
    if (!user) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }

    // Attach userId to request for downstream handlers
    (req as any).userId = user.id;
    next();
  }).catch(error => {
    res.status(500).json({ error: error.message || 'Internal server error' });
    return;
  });
}
