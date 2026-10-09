import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { appendSharedConversationReplyOnce, appendSharedConversationUserMessageOnce, getConversationMessages, type ConversationMessage } from '../conversations/store';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { hermesGateway } from '../services/hermesGateway';
import { internalMcpAuthorization, resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';
import { exactStrings, objectRecord, participant, selectSharedChatTarget, sharedChatAuthority, SHARED_CHAT_USER, MESSAGE_ID_PATTERN, type AddressableCard, type SharedChatAuthority } from '../services/savedCardAuthority';
import { attachHermesImages, cardSession, type SessionBinding } from '../services/hermesCardSession';
import {
  failAcceptedSavedCardRun,
  finishSavedCardRun,
  prepareSavedCardRun,
  type PreparedCardRun,
} from '../services/savedCardRunLedger';
import {
  hermesCallbackToolNames,
  hermesCardScriptDefinition,
  hermesDynamicToolDefinitions,
} from '../services/savedCardHermesToolProjection';
import { submitHermesTurn } from '../services/savedCardHermesTurn';
import { authorizeSharedChatProject } from './sharedChatAuthorization';
import { processCompletedMainPairWithThinkGraph } from '../services/thinkGraphCompletedPair';

function writeSse(res: Response, eventName: string, payload: Record<string, unknown>): boolean {
  if (res.destroyed || res.writableEnded) return false;
  res.write('event: ' + eventName + '\ndata: ' + JSON.stringify(payload) + '\n\n');
  return true;
}

function runFailureCode(error: unknown): string {
  const summary = error instanceof Error ? error.message : String(error || '');
  const candidate = summary.split(':', 1)[0];
  return /^[a-z][a-z0-9_]{2,120}$/.test(candidate) ? candidate : 'hermes_inference_failed';
}

export async function sharedChatTurn(req: Request, res: Response) {
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
    userId = await authorizeSharedChatProject(req, res, projectId);
  } catch {
    return res.status(503).json({ ok: false, error: 'shared_chat_project_authority_unavailable' });
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
      try {
        await finishSavedCardRun({ run, binding, result, error });
      } catch (settlementError) {
        await failAcceptedSavedCardRun(run.runId, settlementError);
        throw settlementError;
      }
      return;
    }
    await failAcceptedSavedCardRun(run.runId, error || new Error('hermes_session_unavailable'));
  };
  try {
    const client = await hermesGateway();
    binding = await cardSession(client, target, {
      userId,
      projectId,
      deckId,
      conversationId,
    });
    await attachHermesImages(client, binding, target.profile, run.request.images);
    const dynamicTools = hermesDynamicToolDefinitions(run.request.toolDefinitions);
    const cardScript = hermesCardScriptDefinition(run.request);
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
      presentedTools: hermesCallbackToolNames(dynamicTools, cardScript),
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
    const result = await submitHermesTurn({
      client,
      binding,
      profile: target.profile,
      runRequest: run.request,
      text: String(run.request.message),
      submissionId: run.runId,
      dynamicTools,
      cardScript,
      toolEndpoint: resolveInternalMcpUrl(),
      toolAuthorization,
      onSubmissionStarted: () => {
        writeSse(res, 'run', { ...identity, state: 'running' });
      },
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
      void processCompletedMainPairWithThinkGraph({
        userId,
        projectId,
        deckId,
        conversationId,
        mainCardId: authority.main.card.id,
        originatingRunId: run.runId,
        mainHermesSessionId: binding.sessionId,
        userMessage: message,
        mainResponse: result.text,
      });
    }
  } catch (error) {
    let reportedError: unknown = error;
    try {
      await settleRun(undefined, error);
    } catch (settlementError) {
      reportedError = settlementError;
    }
    writeSse(res, 'error', {
      ...identity,
      code: runFailureCode(reportedError),
      message: reportedError instanceof Error
        ? reportedError.message
        : 'The Hermes turn failed.',
      correlationId: run.runId,
      route: '/api/shared-chat/turn',
      status: 502,
    });
  } finally {
    writeSse(res, 'end', identity);
    res.end();
  }
  return undefined;
}
