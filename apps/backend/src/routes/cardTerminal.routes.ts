import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

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

type ProjectAuthorization = { userId: string; projectSessionId: string };

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
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'terminal_project_access_denied' });
    return null;
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

function terminalWebSocketUrl(query: URLSearchParams): string {
  const gateway = new URL(
    String(process.env.HERMES_GATEWAY_URL || 'ws://127.0.0.1:9119/api/ws').trim(),
  );
  if (gateway.protocol !== 'ws:' && gateway.protocol !== 'wss:') {
    throw new Error('hermes_gateway_url_invalid');
  }
  gateway.pathname = '/api/pty';
  gateway.search = query.toString();
  gateway.hash = '';
  return gateway.toString();
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
  const { userId, projectSessionId } = authorization;

  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const matches = authority.cards.filter((item) => item.card.id === cardId);
    if (
      matches.length !== 1
      || matches[0].card.runtime.kind !== 'hermes'
      || matches[0].card.runtime.mode === 'magentic_one'
    ) return res.status(409).json({ ok: false, error: 'terminal_card_unavailable' });
    const target = matches[0];
    if (target.card.runtime.mode === 'main') {
      return res.status(409).json({ ok: false, error: 'terminal_main_headless' });
    }
    const cwd = cardId === BUILDER_CARD_ID
      ? resolveBuilderProjectCodeDirectory(projectSessionId, authority.deck.projectCodeFolder)
      : resolveProductChatWorkingDirectory(`${userId}:${projectSessionId}:${cardId}`);
    const client = await hermesGateway();
    const binding = await cardProjectSession(client, authority, target, {
      cwd,
      projectId,
      projectSessionId,
      userId,
    });
    const token = String(process.env.HERMES_DASHBOARD_SESSION_TOKEN || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('hermes_gateway_credential_missing');
    // Hermes requires a filesystem-safe channel and PTY reconnect key. This is
    // transport state only; the actual persisted Hermes session remains
    // `binding.sessionId`.
    const terminalChannelKey = createHash('sha256').update(JSON.stringify([
      userId,
      projectSessionId,
      deckId,
      cardId,
      target.profile,
    ])).digest('hex');
    const query = new URLSearchParams({
      token,
      profile: target.profile,
      project_session: binding.sessionId,
      channel: terminalChannelKey,
      cwd,
      attach: terminalChannelKey,
      bot_mode_roster: binding.botModeRoster.join(','),
      bot_mode_sessions: Object.entries(binding.botModeSessions)
        .map(([profile, sessionId]) => `${profile}=${sessionId}`).join(','),
    });
    return res.json({
      ok: true,
      cardId,
      profile: target.profile,
      sessionId: binding.sessionId,
      terminalChannelKey,
      cols: terminalDimension(req.body?.cols, 80, 2_000),
      rows: terminalDimension(req.body?.rows, 24, 1_000),
      websocketUrl: terminalWebSocketUrl(query),
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'terminal_open_failed',
    });
  }
});

export default cardTerminalRoutes;
