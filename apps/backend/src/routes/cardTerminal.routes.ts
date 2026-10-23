// Entity: Card Terminals
// Relationship: This file authorizes one non-Main saved Card terminal and proxies bounded browser input, output, resize frames, close states, and WebSocket upgrades.
// Entity: Hermes Card Sessions
// Relationship: This file resolves the exact Project/Card/profile session and attaches the terminal to that existing Hermes session and Bot Mode roster.
// Entity: Credentials
// Relationship: This file keeps the reusable Gateway token server-side while issuing only the application-owned same-origin terminal stream path to the browser.

import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import WebSocket, { WebSocketServer, type RawData } from 'ws';

import { getUserBySessionId } from '../auth/sessionStore';
import { BUILDER_CARD_ID } from '../decks/deckDomainClient';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { hermesGateway } from '../services/hermesGateway';
import { getOwnedProjectByReference } from '../services/projectStore';
import { projectCardAuthority } from '../services/projectCardAuthority';
import {
  resolveBuilderProjectCodeDirectory,
  resolveProductChatWorkingDirectory,
} from '../services/workingDirectories';
import { cardProjectSession } from './mainSession.routes';

const cardTerminalRoutes = Router();
const terminalProxyServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const installedServers = new WeakSet<Server>();
const activeBrowserSockets = new Set<WebSocket>();
const activeHermesSockets = new Set<WebSocket>();

type ProjectAuthorization = { userId: string; projectSessionId: string };

type TerminalBinding = {
  projectId: string;
  deckId: string;
  cardId: string;
  profile: string;
  sessionId: string;
  cols: number;
  rows: number;
  upstreamUrl: string;
};

async function authorizeProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<ProjectAuthorization | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'terminal_owner_authentication_required' });
    return null;
  }
  try {
    return await authorizeProjectOwner(projectId, userId);
  } catch (error) {
    if (error instanceof Error && error.message === 'terminal_project_access_denied') {
      res.status(403).json({ ok: false, error: error.message });
      return null;
    }
    throw error;
  }
}

async function authorizeProjectOwner(
  projectId: string,
  userId: string,
): Promise<ProjectAuthorization> {
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    throw new Error('terminal_project_access_denied');
  }
  const projectSessionId = String(project.id || '').trim();
  if (!projectSessionId) throw new Error('terminal_project_identity_missing');
  return { userId, projectSessionId };
}

function terminalDimension(value: unknown, defaultValue: number, maximum: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 1
    ? Math.min(Number(value), maximum)
    : defaultValue;
}

function hermesTerminalUrl(query: URLSearchParams): string {
  const gateway = new URL(
    String(process.env.HERMES_GATEWAY_URL || 'ws://127.0.0.1:9119/api/ws').trim(),
  );
  if (
    (gateway.protocol !== 'ws:' && gateway.protocol !== 'wss:')
    || !['127.0.0.1', 'localhost', '::1'].includes(gateway.hostname)
  ) {
    throw new Error('hermes_gateway_url_invalid');
  }
  gateway.pathname = '/api/pty';
  gateway.search = query.toString();
  gateway.hash = '';
  return gateway.toString();
}

async function resolveTerminalBinding(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  userId: string;
  cols?: unknown;
  rows?: unknown;
}): Promise<TerminalBinding> {
  const authorization = await authorizeProjectOwner(input.projectId, input.userId);
  const authority = await projectCardAuthority(input.projectId, input.deckId);
  const matches = authority.cards.filter((item) => item.card.id === input.cardId);
  if (
    matches.length !== 1
    || matches[0].card.runtime.kind !== 'hermes'
    || matches[0].card.runtime.mode === 'magentic_one'
  ) throw new Error('terminal_card_unavailable');
  const target = matches[0];
  if (target.card.runtime.mode === 'main') throw new Error('terminal_main_headless');
  const cwd = input.cardId === BUILDER_CARD_ID
    ? resolveBuilderProjectCodeDirectory(
      authorization.projectSessionId,
      authority.deck.projectCodeFolder,
    )
    : resolveProductChatWorkingDirectory(
      `${input.userId}:${authorization.projectSessionId}:${input.cardId}`,
    );
  const client = await hermesGateway();
  const binding = await cardProjectSession(client, authority, target, {
    cwd,
    projectId: input.projectId,
    projectSessionId: authorization.projectSessionId,
    userId: input.userId,
  });
  const token = String(process.env.HERMES_DASHBOARD_SESSION_TOKEN || '').trim();
  if (
    token.length !== 64
    || [...token.toLowerCase()].some((character) => !'0123456789abcdef'.includes(character))
  ) throw new Error('hermes_gateway_credential_missing');
  const channel = createHash('sha256').update(JSON.stringify([
    input.userId,
    authorization.projectSessionId,
    input.deckId,
    input.cardId,
    target.profile,
  ])).digest('hex');
  const query = new URLSearchParams({
    token,
    profile: target.profile,
    project_session: binding.sessionId,
    channel,
    cwd,
    attach: channel,
    bot_mode_roster: binding.botModeRoster.join(','),
  });
  return {
    projectId: input.projectId,
    deckId: input.deckId,
    cardId: input.cardId,
    profile: target.profile,
    sessionId: binding.sessionId,
    cols: terminalDimension(input.cols, 80, 2_000),
    rows: terminalDimension(input.rows, 24, 1_000),
    upstreamUrl: hermesTerminalUrl(query),
  };
}

function terminalStreamPath(binding: Pick<TerminalBinding, 'projectId' | 'deckId' | 'cardId'>): string {
  return `/api/card-terminals/${encodeURIComponent(binding.projectId)}`
    + `/${encodeURIComponent(binding.deckId)}/${encodeURIComponent(binding.cardId)}/stream`;
}

cardTerminalRoutes.post('/:projectId/:deckId/:cardId/open', async (req, res) => {
  const projectId = String(req.params.projectId || '').trim();
  const deckId = String(req.params.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const cardId = String(req.params.cardId || '').trim();
  if (!projectId || !deckId || !cardId) {
    return res.status(400).json({ ok: false, error: 'terminal_identity_incomplete' });
  }
  let authorization: ProjectAuthorization | null;
  try {
    authorization = await authorizeProject(req, res, projectId);
  } catch {
    return res.status(503).json({ ok: false, error: 'terminal_project_authority_unavailable' });
  }
  if (!authorization) return undefined;

  try {
    const binding = await resolveTerminalBinding({
      projectId,
      deckId,
      cardId,
      userId: authorization.userId,
      cols: req.body?.cols,
      rows: req.body?.rows,
    });
    return res.json({
      ok: true,
      projectId: binding.projectId,
      deckId: binding.deckId,
      cardId: binding.cardId,
      profile: binding.profile,
      sessionId: binding.sessionId,
      cols: binding.cols,
      rows: binding.rows,
      websocketPath: terminalStreamPath(binding),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'terminal_open_failed';
    const status = ['terminal_card_unavailable', 'terminal_main_headless'].includes(message)
      ? 409
      : message === 'terminal_project_access_denied' ? 403 : 503;
    return res.status(status).json({ ok: false, error: message });
  }
});

function cookieValue(header: string | undefined, name: string): string {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function upgradeIdentity(urlValue: string | undefined): {
  projectId: string;
  deckId: string;
  cardId: string;
} | null {
  let path: string;
  try {
    path = new URL(String(urlValue || '/'), 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  const parts = path.split('/').filter(Boolean);
  if (
    parts.length !== 6
    || parts[0] !== 'api'
    || parts[1] !== 'card-terminals'
    || parts[5] !== 'stream'
  ) return null;
  try {
    const projectId = decodeURIComponent(parts[2]).trim();
    const deckId = decodeURIComponent(parts[3]).trim();
    const cardId = decodeURIComponent(parts[4]).trim();
    return projectId && deckId && cardId ? { projectId, deckId, cardId } : null;
  } catch {
    return null;
  }
}

function refuseUpgrade(socket: Duplex, status: number, message: string): void {
  if (!socket.destroyed) {
    socket.end(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
}

function rawDataSize(data: RawData): number {
  return Array.isArray(data)
    ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
    : data.byteLength;
}

export function terminalCloseFrame(code: number, reason: string): {
  code: number;
  reason: string;
} {
  const validCode = code === 1000
    || (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code))
    || (code >= 3000 && code <= 4999);
  const normalizedCode = code === 0 || code === 1005
    ? 1000
    : validCode ? code : 1011;
  let normalizedReason = '';
  for (const character of String(reason || '')) {
    if (Buffer.byteLength(normalizedReason + character, 'utf8') > 123) break;
    normalizedReason += character;
  }
  return { code: normalizedCode, reason: normalizedReason };
}

function closeTerminalSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) return;
  const frame = terminalCloseFrame(code, reason);
  try {
    socket.close(frame.code, frame.reason);
  } catch {
    socket.terminate();
  }
}

function bridgeTerminal(browser: WebSocket, binding: TerminalBinding): void {
  const hermes = new WebSocket(binding.upstreamUrl, { maxPayload: 256 * 1024 });
  activeBrowserSockets.add(browser);
  activeHermesSockets.add(hermes);
  const pending: Array<{ data: RawData; binary: boolean }> = [];
  let pendingBytes = 0;
  let closed = false;
  const close = (code = 1000, reason = '') => {
    if (closed) return;
    closed = true;
    activeBrowserSockets.delete(browser);
    activeHermesSockets.delete(hermes);
    closeTerminalSocket(browser, code, reason);
    closeTerminalSocket(hermes, code, reason);
  };
  browser.on('message', (data, binary) => {
    if (hermes.readyState === WebSocket.OPEN) {
      hermes.send(data, { binary });
      return;
    }
    const size = rawDataSize(data);
    if (pendingBytes + size > 256 * 1024) {
      close(1009, 'terminal input limit exceeded');
      return;
    }
    pending.push({ data, binary });
    pendingBytes += size;
  });
  hermes.on('open', () => {
    for (const frame of pending.splice(0)) {
      hermes.send(frame.data, { binary: frame.binary });
    }
    pendingBytes = 0;
  });
  hermes.on('message', (data, binary) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary });
  });
  browser.on('close', (code, reason) => close(code || 1000, reason.toString()));
  hermes.on('close', (code, reason) => close(code || 1000, reason.toString()));
  browser.on('error', () => close(1011, 'browser terminal transport failed'));
  hermes.on('error', () => close(1011, 'Hermes terminal transport failed'));
}

async function authorizeUpgrade(
  request: IncomingMessage,
  identity: { projectId: string; deckId: string; cardId: string },
): Promise<TerminalBinding> {
  const sessionId = cookieValue(request.headers.cookie, 'sid');
  if (!sessionId) throw new Error('terminal_owner_authentication_required');
  const user = await getUserBySessionId(sessionId);
  if (!user) throw new Error('terminal_owner_authentication_required');
  return resolveTerminalBinding({ ...identity, userId: user.id });
}

export function installCardTerminalUpgrade(server: Server): void {
  if (installedServers.has(server)) return;
  installedServers.add(server);
  server.on('upgrade', (request, socket, head) => {
    const identity = upgradeIdentity(request.url);
    if (!identity) return;
    void authorizeUpgrade(request, identity).then((binding) => {
      terminalProxyServer.handleUpgrade(request, socket, head, (browser) => {
        bridgeTerminal(browser, binding);
      });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'terminal_upgrade_failed';
      refuseUpgrade(
        socket,
        message === 'terminal_owner_authentication_required' ? 401
          : message === 'terminal_project_access_denied' ? 403 : 409,
        'Terminal upgrade refused',
      );
    });
  });
}

export function closeCardTerminalProxy(): void {
  for (const socket of activeBrowserSockets) socket.close(1001, 'backend shutting down');
  for (const socket of activeHermesSockets) socket.close(1001, 'backend shutting down');
  activeBrowserSockets.clear();
  activeHermesSockets.clear();
}

export default cardTerminalRoutes;
