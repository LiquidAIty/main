import { Router, type Request, type Response } from 'express';

import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getOwnedProjectByReference } from '../services/projectStore';
import { sharedChatAuthority } from '../services/savedCardAuthority';
import { subscribeThinkGraphRevisionEvents } from '../services/thinkGraphRevisionEvents';

const thinkGraphRevisionRoutes = Router();

async function authorizeProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<string | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'main_owner_authentication_required' });
    return null;
  }
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'main_project_access_denied' });
    return null;
  }
  return userId;
}

thinkGraphRevisionRoutes.get('/revisions', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || '').trim();
  if (!projectId || !deckId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'thinkgraph_stream_scope_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    await sharedChatAuthority(projectId, deckId);
  } catch {
    return res.status(409).json({ ok: false, error: 'thinkgraph_stream_deck_unavailable' });
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': ThinkGraph revisions connected\n\n');
  const unsubscribe = subscribeThinkGraphRevisionEvents(
    projectId,
    deckId,
    conversationId,
    (eventName, payload) => {
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    },
  );
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return undefined;
});

export default thinkGraphRevisionRoutes;
