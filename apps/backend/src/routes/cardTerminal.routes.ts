import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getProject } from '../services/projectStore';
import { hermesGateway } from '../services/hermesGateway';
import { sharedChatAuthority } from '../services/savedCardAuthority';
import { cardSession } from '../services/hermesCardSession';

export const cardTerminalRoutes = Router();

async function authorizeProject(req: Request, res: Response, projectId: string): Promise<string | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'terminal_owner_authentication_required' });
    return null;
  }
  const project = await getProject(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'terminal_project_access_denied' });
    return null;
  }
  return userId;
}

function terminalDimension(value: unknown, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 1
    ? Math.min(Number(value), maximum)
    : fallback;
}

cardTerminalRoutes.post('/:projectId/:deckId/:cardId/open', async (req, res) => {
  const projectId = String(req.params.projectId || '').trim();
  const deckId = String(req.params.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const cardId = String(req.params.cardId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  if (!projectId || !deckId || !cardId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'terminal_identity_incomplete' });
  }
  let userId: string | null;
  try {
    userId = await authorizeProject(req, res, projectId);
  } catch {
    return res.status(503).json({ ok: false, error: 'terminal_project_authority_unavailable' });
  }
  if (!userId) return undefined;

  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const matches = authority.cards.filter((item) => item.card.id === cardId);
    if (matches.length !== 1 || matches[0].card.runtime.kind !== 'hermes') {
      return res.status(409).json({ ok: false, error: 'terminal_card_unavailable' });
    }
    const target = matches[0];
    const client = await hermesGateway();
    const binding = await cardSession(client, authority, target, {
      userId,
      projectId,
      deckId,
      conversationId,
    });
    const token = String(process.env.HERMES_DASHBOARD_SESSION_TOKEN || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('hermes_gateway_credential_missing');
    const attach = createHash('sha256').update(JSON.stringify([
      userId,
      projectId,
      deckId,
      cardId,
      conversationId,
      binding.storedSessionId,
    ])).digest('hex');
    const query = new URLSearchParams({
      token,
      profile: target.profile,
      resume: binding.storedSessionId,
      attach,
    });
    return res.json({
      ok: true,
      storedSessionId: binding.storedSessionId,
      cardId,
      profile: target.profile,
      attachIdentity: attach,
      cols: terminalDimension(req.body?.cols, 80, 2_000),
      rows: terminalDimension(req.body?.rows, 24, 1_000),
      websocketUrl: `ws://127.0.0.1:9119/api/pty?${query.toString()}`,
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'terminal_open_failed',
    });
  }
});

export default cardTerminalRoutes;
