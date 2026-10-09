import { Router } from 'express';

import { getConversationMessages } from '../conversations/store';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { hermesGateway } from '../services/hermesGateway';
import { sharedChatAuthority, sharedMessage } from '../services/savedCardAuthority';
import { interruptSavedCardRun, savedCardOwnsLiveSession } from '../services/hermesCardSession';
import { authorizeSharedChatProject } from './sharedChatAuthorization';
import { sharedChatTurn } from './sharedChatTurn';

const sharedChatRoutes = Router();

sharedChatRoutes.post('/turn', sharedChatTurn);

sharedChatRoutes.get('/history', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || 'main').trim();
  if (!projectId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'project_conversation_required' });
  }
  const userId = await authorizeSharedChatProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const messages = (await getConversationMessages(projectId, conversationId))
      .map(sharedMessage)
      .filter((message): message is NonNullable<ReturnType<typeof sharedMessage>> => message !== null);
    return res.json({
      ok: true,
      mainCardId: authority.main.card.id,
      addressableAgents: authority.cards
        .filter((card) => card.card.id !== authority.main.card.id)
        .map((card) => ({
          cardId: card.card.id,
          cardRevisionId: card.cardRevisionId,
          profile: card.profile,
          title: card.title,
          address: card.address || '',
          aliases: card.aliases,
        })),
      messages,
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_history_read_failed',
    });
  }
});

sharedChatRoutes.get('/events', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || 'main').trim();
  const liveSessionId = String(req.query.liveSessionId || '').trim();
  if (!projectId || !conversationId || !liveSessionId) {
    return res.status(400).json({ ok: false, error: 'main_hermes_event_scope_invalid' });
  }
  const userId = await authorizeSharedChatProject(req, res, projectId);
  if (!userId) return undefined;
  const authority = await sharedChatAuthority(projectId, deckId);
  const client = await hermesGateway();
  if (!await savedCardOwnsLiveSession(client, authority.main, {
    userId,
    projectId,
    deckId,
    conversationId,
  }, liveSessionId)) {
    return res.status(409).json({ ok: false, error: 'main_hermes_event_scope_invalid' });
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const detach = client.onEvent((event) => {
    if (event.session_id !== liveSessionId || !Number.isSafeInteger(event.seq)) return;
    res.write(`event: gateway\ndata: ${JSON.stringify({
      projectId,
      deckId,
      conversationId,
      cardId: authority.main.card.id,
      liveSessionId,
      event,
    })}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    detach();
  });
  return undefined;
});

sharedChatRoutes.post('/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || '').trim();
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  const expectedCardId = String(req.body?.expectedCardId || '').trim();
  if (!projectId || !deckId || !conversationId || !expectedRunId) {
    return res.status(400).json({ ok: false, error: 'project_conversation_and_expected_run_required' });
  }
  const userId = await authorizeSharedChatProject(req, res, projectId);
  if (!userId) return undefined;
  try {
    const authority = await sharedChatAuthority(projectId, deckId);
    const matches = expectedCardId
      ? authority.cards.filter((item) => item.card.id === expectedCardId)
      : [authority.main];
    if (matches.length !== 1) {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    const target = matches[0];
    const client = await hermesGateway();
    const interrupted = await interruptSavedCardRun(client, target, {
      userId,
      projectId,
      deckId,
      conversationId,
    }, expectedRunId);
    if (!interrupted) {
      return res.status(409).json({ ok: false, error: 'no_active_turn' });
    }
    return res.json({ ok: true, runId: expectedRunId, state: 'stopping' });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'shared_chat_run_stop_failed',
    });
  }
});


export default sharedChatRoutes;
