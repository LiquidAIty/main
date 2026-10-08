import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import {
  appendSharedConversationReplyOnce,
  appendSharedConversationUserMessageOnce,
  getConversationMessages,
  listConversations,
  type ConversationMessage,
} from '../conversations/store';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getOwnedProjectByReference } from '../services/projectStore';
import { hermesGateway } from '../services/hermesGateway';
import { internalMcpAuthorization, resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';
import {
  exactStrings,
  objectRecord,
  participant,
  selectSharedChatTarget,
  sharedChatAuthority,
  sharedMessage,
  SHARED_CHAT_USER,
  MESSAGE_ID_PATTERN,
  type AddressableCard,
  type SharedChatAuthority,
} from '../services/savedCardAuthority';
import {
  attachHermesImages,
  cardSession,
  interruptSavedCardRun,
  savedCardOwnsLiveSession,
  type SessionBinding,
} from '../services/hermesCardSession';
import {
  failAcceptedSavedCardRun,
  finishSavedCardRun,
  hermesDynamicToolDefinitions,
  prepareSavedCardRun,
  submitHermesTurn,
  type PreparedCardRun,
} from '../services/savedCardRun';
import { runCompletedPairThinkGraphLifecycle } from './thinkGraphRevision.routes';

export const sharedChatRoutes = Router();

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

function writeSse(res: Response, eventName: string, payload: Record<string, unknown>): boolean {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  return true;
}

sharedChatRoutes.post('/turn', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.body?.conversationId || 'main').trim();
  const message = String(req.body?.message || '');
  const clientMessageId = String(req.body?.clientMessageId || '').trim();
  const clientReplyMessageId = String(req.body?.clientReplyMessageId || '').trim();
  const targetCardId = typeof req.body?.targetCardId === 'string'
    ? req.body.targetCardId.trim()
    : '';
  if (!projectId || !conversationId || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'project_conversation_message_required' });
  }
  if (
    !MESSAGE_ID_PATTERN.test(clientMessageId)
    || !MESSAGE_ID_PATTERN.test(clientReplyMessageId)
    || clientMessageId === clientReplyMessageId
  ) {
    return res.status(400).json({ ok: false, error: 'shared_chat_message_identity_invalid' });
  }
  let userId: string | null;
  try {
    userId = await authorizeProject(req, res, projectId);
  } catch {
    return res.status(503).json({ ok: false, error: 'main_project_authority_unavailable' });
  }
  if (!userId) return undefined;

  let authority: SharedChatAuthority;
  let target: AddressableCard;
  let priorMessages: ConversationMessage[];
  try {
    authority = await sharedChatAuthority(projectId, deckId);
    target = selectSharedChatTarget(authority, message, targetCardId);
    priorMessages = await getConversationMessages(projectId, conversationId);
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'shared_chat_authority_unavailable',
    });
  }

  try {
    await appendSharedConversationUserMessageOnce({
      projectId,
      conversationId,
      message: {
        messageId: clientMessageId,
        role: 'user',
        content: message,
        speaker: SHARED_CHAT_USER,
        target: participant(target),
      },
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'shared_chat_message_persist_failed',
    });
  }

  const runId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  let runAccepted = false;
  let run: PreparedCardRun;
  try {
    run = await prepareSavedCardRun({
      projectId,
      deckId,
      conversationId,
      message,
      target,
      main: authority.main,
      priorMessages,
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      runId,
      onAccepted: () => { runAccepted = true; },
    });
  } catch (error) {
    if (runAccepted) {
      await failAcceptedSavedCardRun(runId, error).catch(() => undefined);
    }
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'saved_card_preparation_failed',
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const directAddressed = target.card.id !== authority.main.card.id;
  const identity = {
    projectId,
    deckId,
    conversationId,
    cardId: target.card.id,
    runId: run.runId,
    participant: participant(target),
    directAddressed,
    userMessageId: clientMessageId,
    assistantMessageId: clientReplyMessageId,
  };
  writeSse(res, 'run', { ...identity, state: 'preparing' });

  let binding: SessionBinding | null = null;
  let settlementAttempted = false;
  const settleRun = async (
    result?: Parameters<typeof finishSavedCardRun>[0]['result'],
    error?: unknown,
  ): Promise<void> => {
    if (settlementAttempted) return;
    settlementAttempted = true;
    if (binding) {
      await finishSavedCardRun({ run, binding, result, error });
      return;
    }
    await failAcceptedSavedCardRun(run.runId, error || new Error('hermes_session_unavailable'));
  };
  try {
    const client = await hermesGateway();
    binding = await cardSession(client, authority, target, {
      userId,
      projectId,
      deckId,
      conversationId,
    });
    await attachHermesImages(client, binding, target.profile, run.request.images);
    const dynamicTools = hermesDynamicToolDefinitions(run.request.toolDefinitions);
    const runtime = objectRecord(run.request.runtime);
    const runtimeMode = String(runtime.mode || '').trim();
    if (!['main', 'delegate', 'magentic_one'].includes(runtimeMode)) {
      throw new Error('dynamic_tool_runtime_mode_invalid');
    }
    const toolAuthorization = internalMcpAuthorization({
      kind: 'card-runtime',
      projectId,
      deckId,
      conversationId,
      parentRunId: run.runId,
      callerCardId: target.card.id,
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: runtimeMode as 'main' | 'delegate' | 'magentic_one',
      grantedTools: exactStrings(run.request.enabledTools),
      presentedTools: dynamicTools.map((tool) => tool.canonical_name),
    });
    writeSse(res, 'session', {
      ...identity,
      liveSessionId: binding.sessionId,
      storedSessionId: binding.storedSessionId,
      configuration: {
        profile: target.profile,
        unavailableTools: exactStrings(run.request.unavailableTools),
      },
    });
    writeSse(res, 'run', { ...identity, state: 'running' });
    const result = await submitHermesTurn({
      client,
      binding,
      profile: target.profile,
      text: String(run.request.message),
      submissionId: run.runId,
      dynamicTools,
      toolEndpoint: resolveInternalMcpUrl(),
      toolAuthorization,
      onEvent: (event) => {
        if (event.type === 'message.delta') {
          writeSse(res, 'text', { ...identity, text: String(event.payload?.text || '') });
        } else if (event.type.includes('reasoning')) {
          writeSse(res, 'reasoning', { ...identity, event });
        } else if (event.type === 'tool.start') {
          writeSse(res, 'tool_start', { ...identity, event });
        } else if (event.type === 'tool.complete') {
          writeSse(res, 'tool_result', { ...identity, event });
        }
      },
    });
    if (!result.text.trim()) throw new Error('hermes_empty_response');
    await settleRun(result);
    await appendSharedConversationReplyOnce({
      projectId,
      conversationId,
      message: {
        messageId: clientReplyMessageId,
        role: 'assistant',
        content: result.text,
        speaker: participant(target),
        target: SHARED_CHAT_USER,
        providerContinuationRef: binding.storedSessionId,
        providerMessageId: `run:${run.runId}`,
      },
    });
    writeSse(res, 'done', { ...identity, fullText: result.text });
    if (!directAddressed) {
      void runCompletedPairThinkGraphLifecycle({
        userId,
        projectId,
        deckId,
        conversationId,
        authority,
        main: authority.main,
        originatingRunId: run.runId,
        mainSessionId: binding.sessionId,
        userMessage: message,
        mainResponse: result.text,
      });
    }
  } catch (error) {
    await settleRun(undefined, error).catch(() => undefined);
    writeSse(res, 'error', {
      ...identity,
      code: error instanceof Error ? error.message : 'hermes_turn_failed',
      message: error instanceof Error ? error.message : 'The Hermes turn failed.',
      correlationId: run.runId,
      route: '/api/shared-chat/turn',
      status: 502,
    });
  } finally {
    writeSse(res, 'end', identity);
    res.end();
  }
  return undefined;
});

sharedChatRoutes.get('/history', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || 'main').trim();
  if (!projectId || !conversationId) {
    return res.status(400).json({ ok: false, error: 'project_conversation_required' });
  }
  const userId = await authorizeProject(req, res, projectId);
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

sharedChatRoutes.get('/conversations', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'project_id_required' });
  const userId = await authorizeProject(req, res, projectId);
  if (!userId) return undefined;
  return res.json({ ok: true, conversations: await listConversations(projectId) });
});

sharedChatRoutes.get('/events', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const conversationId = String(req.query.conversationId || 'main').trim();
  const liveSessionId = String(req.query.liveSessionId || '').trim();
  if (!projectId || !conversationId || !liveSessionId) {
    return res.status(400).json({ ok: false, error: 'main_hermes_event_scope_invalid' });
  }
  const userId = await authorizeProject(req, res, projectId);
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
  const userId = await authorizeProject(req, res, projectId);
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
      error: error instanceof Error ? error.message : 'main_run_stop_failed',
    });
  }
});


export default sharedChatRoutes;
