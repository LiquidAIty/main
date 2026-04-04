import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import type { Request, Response } from 'express';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export interface User {
  id: string;
  created: string;
}

export interface Session {
  id: string;
  userId: string;
  created: string;
}

async function ensureDataDir() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {
    // directory already exists
  }
}

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  await ensureDataDir();
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
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

export async function getUsers(): Promise<User[]> {
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

export async function getSessions(): Promise<Session[]> {
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

export async function removeSession(sessionId: string): Promise<void> {
  const sessions = await getSessions();
  const updatedSessions = sessions.filter((session) => session.id !== sessionId);
  await saveSessions(updatedSessions);
}

export async function getUserBySessionId(sessionId: string): Promise<User | null> {
  const sessions = await getSessions();
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) return null;
  const users = await getUsers();
  return users.find((user) => user.id === session.userId) || null;
}

export async function createAnonymousSession(): Promise<{ user: User; session: Session }> {
  const user: User = {
    id: uuidv4(),
    created: new Date().toISOString(),
  };
  await addUser(user);

  const session: Session = {
    id: uuidv4(),
    userId: user.id,
    created: new Date().toISOString(),
  };
  await addSession(session);

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
