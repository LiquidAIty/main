/**
 * Entity: Card Terminals
 * Relationship: Authenticates one saved Card and proxies its visible CLI to the same profile and canonical Hermes session.
 * Entity: Shared Gateway Connection
 * Relationship: Opens each terminal socket with a fresh one-use Gateway ticket against the already-running shared owner.
 */

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { Router } from 'express';
import WebSocket, { WebSocketServer, type RawData } from 'ws';

import { getUserBySessionId } from '../auth/sessionStore';
import { resolveCardSession } from '../cardRuntime/cardSessions';
import {
  CARD_RUNTIME_CONTRACT,
  cardRuntimeGateway,
  openCardTerminalSocket,
} from '../services/cardRuntimeGateway';
import { getOwnedProjectByReference } from '../services/projectStore';
import {
  projectCardAuthority,
  type ProjectCardBinding,
} from '../services/projectCardAuthority';
import { requireOwnedProject } from './projectAccess';

const router = Router();
const terminalSockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
let installedServer: Server | null = null;

type TerminalIdentity = { projectId: string; deckId: string; cardId: string };
type TerminalBinding = TerminalIdentity & {
  profile: string;
  sessionId: string;
};

function required(value: unknown, code: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > 128) throw new Error(code);
  return result;
}

function terminalDimension(value: unknown, fallback: number, maximum: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? Math.min(number, maximum) : fallback;
}

function exactCard(cards: ProjectCardBinding[], cardId: string): ProjectCardBinding {
  const matches = cards.filter((card) => card.card.id === cardId);
  if (matches.length !== 1 || matches[0].card.runtime.kind !== CARD_RUNTIME_CONTRACT.kind) {
    throw new Error('card_terminal_card_not_found');
  }
  return matches[0];
}

async function resolveTerminalBinding(
  ownerUserId: string,
  identity: TerminalIdentity,
): Promise<TerminalBinding> {
  const project = await getOwnedProjectByReference(identity.projectId, ownerUserId);
  if (!project || project.ownerUserId !== ownerUserId) throw new Error('card_terminal_access_denied');
  const authority = await projectCardAuthority(project.id, identity.deckId);
  const card = exactCard(authority.cards, identity.cardId);
  const client = await cardRuntimeGateway();
  const session = await resolveCardSession(client, authority, card, {
    projectId: project.id,
    projectSessionId: project.id,
    userId: ownerUserId,
  });
  return {
    projectId: project.id,
    deckId: identity.deckId,
    cardId: identity.cardId,
    profile: card.profile,
    sessionId: session.sessionId,
  };
}

function terminalStreamPath(identity: TerminalIdentity): string {
  return `/api/card-terminals/${encodeURIComponent(identity.projectId)}`
    + `/${encodeURIComponent(identity.deckId)}/${encodeURIComponent(identity.cardId)}/stream`;
}

router.post('/:projectId/:deckId/:cardId/open', async (req, res) => {
  try {
    const projectId = required(req.params.projectId, 'card_terminal_project_required');
    const deckId = required(req.params.deckId, 'card_terminal_deck_required');
    const cardId = required(req.params.cardId, 'card_terminal_card_required');
    const access = await requireOwnedProject(req, res, projectId);
    if (!access) return undefined;
    const binding = await resolveTerminalBinding(access.ownerUserId, {
      projectId: access.projectId,
      deckId,
      cardId,
    });
    return res.json({
      projectId: binding.projectId,
      deckId: binding.deckId,
      cardId: binding.cardId,
      profile: binding.profile,
      sessionId: binding.sessionId,
      cols: terminalDimension(req.body?.cols, 80, 400),
      rows: terminalDimension(req.body?.rows, 24, 200),
      websocketPath: terminalStreamPath(binding),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'card_terminal_open_failed';
    const status = code.endsWith('_required') ? 400
      : code.endsWith('_not_found') ? 404
        : code.endsWith('_denied') ? 403 : 503;
    return res.status(status).json({ error: code });
  }
});

function upgradeIdentity(request: IncomingMessage): TerminalIdentity | null {
  let parts: string[];
  try {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (
    parts.length !== 6
    || parts[0] !== 'api'
    || parts[1] !== 'card-terminals'
    || parts[5] !== 'stream'
  ) return null;
  return { projectId: parts[2], deckId: parts[3], cardId: parts[4] };
}

function cookie(request: IncomingMessage, name: string): string {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

async function authorizeUpgrade(
  request: IncomingMessage,
  identity: TerminalIdentity,
): Promise<TerminalBinding> {
  const user = await getUserBySessionId(cookie(request, 'sid'));
  if (!user) throw new Error('card_terminal_authentication_required');
  return resolveTerminalBinding(user.id, identity);
}

function refuseUpgrade(socket: Duplex, status = 401): void {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} ${status === 404 ? 'Not Found' : 'Unauthorized'}\r\nConnection: close\r\n\r\n`);
  }
}

function bridgeTerminal(browser: WebSocket, binding: TerminalBinding): void {
  let gateway: WebSocket | null = null;
  const queued: Array<{ data: RawData; binary: boolean }> = [];
  const close = (code = 1011, reason = 'card_terminal_connection_closed') => {
    if (browser.readyState === WebSocket.OPEN) browser.close(code, reason);
    if (gateway?.readyState === WebSocket.OPEN || gateway?.readyState === WebSocket.CONNECTING) {
      gateway.close();
    }
  };
  browser.on('message', (data, binary) => {
    if (gateway?.readyState === WebSocket.OPEN) gateway.send(data, { binary });
    else queued.push({ data, binary });
  });
  browser.once('close', () => close(1000, 'card_terminal_browser_closed'));
  browser.once('error', () => close());
  void openCardTerminalSocket(binding.profile, binding.sessionId).then((socket) => {
    gateway = socket;
    socket.on('open', () => {
      queued.splice(0).forEach(({ data, binary }) => socket.send(data, { binary }));
    });
    socket.on('message', (data, binary) => {
      if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary });
    });
    socket.once('close', (code, reason) => {
      const text = reason.toString().slice(0, 100) || 'card_terminal_gateway_closed';
      if (browser.readyState === WebSocket.OPEN) browser.close(code >= 1000 ? code : 1011, text);
    });
    socket.once('error', () => close());
  }).catch(() => close());
}

function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const identity = upgradeIdentity(request);
  if (!identity) return;
  void authorizeUpgrade(request, identity).then((binding) => {
    terminalSockets.handleUpgrade(request, socket, head, (browser) => {
      bridgeTerminal(browser, binding);
    });
  }).catch((error) => {
    const code = error instanceof Error ? error.message : '';
    refuseUpgrade(socket, code.endsWith('_not_found') ? 404 : 401);
  });
}

export function installCardTerminalUpgrade(server: Server): void {
  if (installedServer === server) return;
  if (installedServer) installedServer.off('upgrade', handleUpgrade);
  installedServer = server;
  server.on('upgrade', handleUpgrade);
}

export function closeCardTerminalProxy(): void {
  if (installedServer) installedServer.off('upgrade', handleUpgrade);
  installedServer = null;
  for (const socket of terminalSockets.clients) socket.close(1001, 'backend_shutdown');
}

export default router;
