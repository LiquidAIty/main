/**
 * Entity: Main Chat
 * Relationship: Owns authenticated Main chat, history, stop, and voice HTTP transport while the connected runtime owns profile sessions and agent delivery.
 * Entity: Run Ledger
 * Relationship: Records one outer saved-Card Run around the actual Main turn and canonical completion.
 */

import { Router, type Request, type Response } from 'express';

import { resolveExternalIdentityProjectGrant } from '../auth/externalIdentityGrantStore';
import {
  appendConversationReplyOnce,
  appendConversationTurn,
  getConversationMessages,
  settleConversationMessage,
  type ConversationMessage,
  type ConversationParticipant,
} from '../conversations/store';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import {
  resolveMainSession,
  type CardSessionBinding,
} from '../cardRuntime/cardSessions';
import { attachMainImages, executeMainTurn } from '../cardRuntime/mainTurn';
import { savedCardAgentRoster } from '../cardRuntime/profileMaterialization';
import { cardRuntimeGateway, type CardRuntimeClient } from '../services/cardRuntimeGateway';
import {
  finishCardRun,
  cardRuntimeUsageFields,
  prepareCardRun,
  startCardRun,
  type PreparedCardRun,
} from '../services/cardRunLifecycle';
import { getOwnedProjectByReference } from '../services/projectStore';
import {
  projectCardAuthority,
  type ProjectCardAuthority,
  type ProjectCardBinding,
} from '../services/projectCardAuthority';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';

export const mainSessionRoutes = Router();
const USER: ConversationParticipant = { kind: 'user', label: 'You' };

type ProjectAuthorization = {
  userId: string;
  projectSessionId: string;
  expectedMainCardId?: string;
};

type LiveMainTurn = {
  runId: string;
  client: CardRuntimeClient;
  binding: CardSessionBinding;
  profile: string;
};

type MainAdmission = {
  runId: string;
  inputMessageIds: string[];
  nextInputOrdinal: number;
  ready: Promise<LiveMainTurn>;
  resolveReady(value: LiveMainTurn): void;
  rejectReady(error: Error): void;
  readySettled: boolean;
};

type ActiveRun = LiveMainTurn & {
  abortController: AbortController;
};

const activeMainByScope = new Map<string, MainAdmission>();
const activeRuns = new Map<string, ActiveRun>();

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function validMessageId(value: string): boolean {
  if (!value.startsWith('msg_')) return false;
  const parts = value.slice(4).split('-');
  const lengths = [8, 4, 4, 4, 12];
  if (parts.length !== lengths.length) return false;
  return parts.every((part, index) => (
    part.length === lengths[index]
    && [...part.toLowerCase()].every((character) => (
      (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')
    ))
  ));
}

function participant(card: ProjectCardBinding): ConversationParticipant {
  return {
    kind: 'card',
    label: card.title,
    cardId: card.card.id,
    profile: card.profile,
    ...(card.address ? { address: card.address } : {}),
  };
}

function agentRosterCards(
  authority: ProjectCardAuthority,
  source: ProjectCardBinding,
): ProjectCardBinding[] {
  const byProfile = new Map(authority.cards.map((card) => [card.profile.toLowerCase(), card]));
  return savedCardAgentRoster(authority.deck, source.card).map((profile) => {
    const card = byProfile.get(profile.toLowerCase());
    if (!card) throw new Error(`card_agent_roster_identity_missing:${profile}`);
    return card;
  });
}

function requestedParticipant(
  message: string,
  authority: ProjectCardAuthority,
): ConversationParticipant {
  const trimmed = message.trimStart();
  if (!trimmed.startsWith('@')) return participant(authority.main);
  let address = '';
  for (const character of trimmed.slice(1, 65)) {
    const lower = character.toLowerCase();
    const allowed = (lower >= 'a' && lower <= 'z')
      || (character >= '0' && character <= '9')
      || character === '_'
      || character === '-';
    if (!allowed) break;
    address += character;
  }
  const following = trimmed[address.length + 1];
  if (!address || (following && ![' ', '\t', '\r', '\n'].includes(following))) {
    throw new Error('main_address_invalid');
  }
  const matches = agentRosterCards(authority, authority.main).filter((card) => (
    String(card.address || '').toLowerCase() === address.toLowerCase()
  ));
  if (matches.length !== 1) throw new Error(`main_address_not_authorized:${address.toLowerCase()}`);
  return participant(matches[0]);
}

function scopeKey(
  projectId: string,
  deckId: string,
  conversationId: string,
  userId: string,
): string {
  return JSON.stringify([projectId, deckId, conversationId, userId]);
}

function runKey(projectId: string, deckId: string, userId: string, runId: string): string {
  return JSON.stringify([projectId, deckId, userId, runId]);
}

function createAdmission(): MainAdmission {
  let resolveReady!: (value: LiveMainTurn) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<LiveMainTurn>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  return {
    runId: '',
    inputMessageIds: [],
    nextInputOrdinal: 1,
    ready,
    resolveReady,
    rejectReady,
    readySettled: false,
  };
}

function resolveAdmission(admission: MainAdmission, value: LiveMainTurn): void {
  if (admission.readySettled) return;
  admission.readySettled = true;
  admission.resolveReady(value);
}

function rejectAdmission(admission: MainAdmission, error: unknown): void {
  if (admission.readySettled) return;
  admission.readySettled = true;
  admission.rejectReady(error instanceof Error ? error : new Error(String(error)));
}

function writeSse(res: Response, name: string, payload: Record<string, unknown>): boolean {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  return true;
}

function openSse(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

async function authorizeProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<ProjectAuthorization | null> {
  let userId = String((req as Request & { userId?: string }).userId || '').trim();
  let expectedMainCardId = '';
  if (!userId && internalMcpProcessSecretAuthorized(
    req.headers['x-liquidaity-internal-mcp-secret'],
  )) {
    const issuer = String(req.body?.externalIssuer || '').trim();
    const subject = String(req.body?.externalSubject || '').trim();
    expectedMainCardId = String(req.body?.expectedMainCardId || '').trim();
    if (!issuer || !subject || !expectedMainCardId) {
      res.status(401).json({ ok: false, error: 'main_external_identity_required' });
      return null;
    }
    const grant = await resolveExternalIdentityProjectGrant(issuer, subject);
    if (!grant) {
      res.status(403).json({ ok: false, error: 'external_identity_grant_required' });
      return null;
    }
    userId = grant.userId;
  }
  if (!userId) {
    res.status(401).json({ ok: false, error: 'main_owner_authentication_required' });
    return null;
  }
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'main_project_access_denied' });
    return null;
  }
  const projectSessionId = String(project.id || '').trim();
  if (!projectSessionId) throw new Error('main_project_identity_missing');
  return {
    userId,
    projectSessionId,
    ...(expectedMainCardId ? { expectedMainCardId } : {}),
  };
}

function participantFromStoredMessage(
  message: ConversationMessage,
  kind: 'conversation_speaker' | 'conversation_target',
): ConversationParticipant | null {
  const activity = message.visibleActivities?.find((item) => item.kind === kind);
  if (!activity?.label) return null;
  return {
    kind: activity.status === 'user' ? 'user' : 'card',
    label: activity.label,
    ...(activity.cardId ? { cardId: activity.cardId } : {}),
    ...(activity.profile ? { profile: activity.profile } : {}),
    ...(activity.address ? { address: activity.address } : {}),
  };
}

function visibleMessage(message: ConversationMessage) {
  const speaker = participantFromStoredMessage(message, 'conversation_speaker')
    || (message.role === 'user' ? USER : null);
  if (!speaker || (message.role !== 'user' && message.role !== 'assistant')) return null;
  const target = participantFromStoredMessage(message, 'conversation_target');
  return {
    messageId: message.messageId,
    seq: message.seq,
    role: message.role,
    text: message.content,
    speaker,
    ...(target ? { target } : {}),
    ...(message.linkedEvidenceIds?.length
      ? { linkedEvidenceIds: [...message.linkedEvidenceIds] }
      : {}),
  };
}

function inputProviderMessageId(runId: string, ordinal: number): string {
  return `run:${runId}:input:${ordinal}`;
}

async function settleRun(args: {
  run: PreparedCardRun;
  binding: CardSessionBinding | null;
  result?: Awaited<ReturnType<typeof executeMainTurn>>;
  error?: unknown;
  cancelled?: boolean;
  inputMessageIds: string[];
}): Promise<void> {
  const provider = record(args.binding?.info);
  const requestedProvider = record(args.run.request.provider);
  await finishCardRun({
    runId: args.run.runId,
    state: args.cancelled ? 'cancelled' : args.error ? 'failed' : 'completed',
    finalResult: args.result?.text,
    errorCode: args.cancelled ? 'card_turn_cancelled' : args.error ? 'card_turn_failed' : undefined,
    errorSummary: args.cancelled
      ? 'card_turn_cancelled'
      : args.error instanceof Error ? args.error.message : args.error ? String(args.error) : undefined,
    hermesSessionRef: args.binding?.sessionId,
    providerTurnRef: args.result?.providerTurnRef,
    effectiveProvider: String(provider.provider || requestedProvider.provider || ''),
    provider: String(provider.provider || requestedProvider.provider || ''),
    model: String(provider.model || requestedProvider.providerModelId || ''),
    toolCallCount: args.result?.toolCalls || 0,
    inputMessageIds: args.inputMessageIds,
    ...(args.result ? cardRuntimeUsageFields(args.result.event.payload?.usage) : {}),
  });
}

async function handleSteer(args: {
  admission: MainAdmission;
  projectId: string;
  deckId: string;
  conversationId: string;
  message: string;
  clientMessageId: string;
  clientReplyMessageId: string;
  requested: ConversationParticipant;
  main: ProjectCardBinding;
  res: Response;
}): Promise<void> {
  const live = await args.admission.ready;
  const ordinal = args.admission.nextInputOrdinal + 1;
  args.admission.nextInputOrdinal = ordinal;
  const providerMessageId = inputProviderMessageId(live.runId, ordinal);
  await appendConversationTurn({
    projectId: args.projectId,
    conversationId: args.conversationId,
    messages: [{
      messageId: args.clientMessageId,
      role: 'user',
      content: args.message,
      speaker: USER,
      target: args.requested,
      status: 'pending',
      providerMessageId,
    }],
  });
  try {
    const submitted = record(await live.client.request('prompt.submit', {
      session_id: live.binding.liveHandle,
      profile: live.profile,
      text: args.message,
    }));
    const status = String(submitted.status || '');
    if (!['steered', 'redirected', 'queued'].includes(status)) {
      throw new Error(`card_steer_rejected:${status || 'unknown'}`);
    }
    args.admission.inputMessageIds.push(args.clientMessageId);
    await settleConversationMessage({
      projectId: args.projectId,
      conversationId: args.conversationId,
      messageId: args.clientMessageId,
      providerMessageId,
      status: 'complete',
    });
    openSse(args.res);
    const identity = {
      projectId: args.projectId,
      deckId: args.deckId,
      cardId: args.main.card.id,
      runId: live.runId,
      participant: participant(args.main),
      requestedParticipant: args.requested,
      userMessageId: args.clientMessageId,
      assistantMessageId: args.clientReplyMessageId,
    };
    writeSse(args.res, 'run', { ...identity, state: status });
    writeSse(args.res, 'done', { ...identity, fullText: '' });
    writeSse(args.res, 'end', identity);
    args.res.end();
  } catch (error) {
    await settleConversationMessage({
      projectId: args.projectId,
      conversationId: args.conversationId,
      messageId: args.clientMessageId,
      providerMessageId,
      status: 'error',
    }).catch(() => undefined);
    throw error;
  }
}

mainSessionRoutes.post('/chat', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const message = String(req.body?.message || '');
  const clientMessageId = String(req.body?.clientMessageId || '').trim();
  const clientReplyMessageId = String(req.body?.clientReplyMessageId || '').trim();
  if (!projectId || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'project_message_required' });
  }
  if (!validMessageId(clientMessageId) || !validMessageId(clientReplyMessageId)) {
    return res.status(400).json({ ok: false, error: 'conversation_message_identity_invalid' });
  }
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  const { userId, projectSessionId: conversationId } = authorization;
  let authority: ProjectCardAuthority;
  let requested: ConversationParticipant;
  try {
    authority = await projectCardAuthority(projectId, deckId);
    if (authorization.expectedMainCardId
      && authorization.expectedMainCardId !== authority.main.card.id) {
      return res.status(409).json({ ok: false, error: 'main_card_identity_changed' });
    }
    requested = requestedParticipant(message, authority);
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_authority_failed',
    });
  }
  const main = authority.main;
  const key = scopeKey(projectId, deckId, conversationId, userId);
  const existingAdmission = activeMainByScope.get(key);
  if (existingAdmission) {
    try {
      await handleSteer({
        admission: existingAdmission,
        projectId,
        deckId,
        conversationId,
        message,
        clientMessageId,
        clientReplyMessageId,
        requested,
        main,
        res,
      });
      return undefined;
    } catch (error) {
      return res.status(409).json({
        ok: false,
        error: error instanceof Error ? error.message : 'main_steer_failed',
      });
    }
  }

  const admission = createAdmission();
  activeMainByScope.set(key, admission);
  let run: PreparedCardRun;
  try {
    run = await prepareCardRun({
      projectId,
      deckId,
      conversationId,
      message,
      target: main,
      dataAnchors: Array.isArray(req.body?.dataAnchors) ? req.body.dataAnchors : [],
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    admission.runId = run.runId;
  } catch (error) {
    activeMainByScope.delete(key);
    rejectAdmission(admission, error);
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'saved_card_preparation_failed',
    });
  }
  const initialProviderMessageId = inputProviderMessageId(run.runId, 1);
  try {
    await appendConversationTurn({
      projectId,
      conversationId,
      messages: [{
        messageId: clientMessageId,
        role: 'user',
        content: message,
        speaker: USER,
        target: requested,
        status: 'pending',
        providerMessageId: initialProviderMessageId,
      }],
    });
    admission.inputMessageIds.push(clientMessageId);
  } catch (error) {
    activeMainByScope.delete(key);
    rejectAdmission(admission, error);
    await settleRun({ run, binding: null, error, inputMessageIds: [] }).catch(() => undefined);
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_message_persist_failed',
    });
  }

  openSse(res);
  const identity = {
    projectId,
    deckId,
    cardId: main.card.id,
    runId: run.runId,
    participant: participant(main),
    requestedParticipant: requested,
    userMessageId: clientMessageId,
    assistantMessageId: clientReplyMessageId,
  };
  writeSse(res, 'run', { ...identity, state: 'preparing' });
  let binding: CardSessionBinding | null = null;
  let userSettled = false;
  let runSettled = false;
  let streamedText = '';
  const abortController = new AbortController();
  const activeKey = runKey(projectId, deckId, userId, run.runId);
  try {
    const client = await cardRuntimeGateway();
    binding = await resolveMainSession(client, authority, {
      projectId,
      projectSessionId: conversationId,
      userId,
    });
    const live: LiveMainTurn = { runId: run.runId, client, binding, profile: main.profile };
    resolveAdmission(admission, live);
    const active: ActiveRun = { ...live, abortController };
    activeRuns.set(activeKey, active);
    await attachMainImages(client, binding, main.profile, run.request.images);
    writeSse(res, 'session', {
      ...identity,
      sessionId: binding.sessionId,
      configuration: {
        profile: main.profile,
        unavailableTools: Array.isArray(run.request.unavailableTools)
          ? run.request.unavailableTools.map(String).filter(Boolean)
          : [],
      },
    });
    const result = await executeMainTurn({
      client,
      binding,
      profile: main.profile,
      text: String(run.request.message || message),
      runId: run.runId,
      stopSignal: abortController.signal,
      onAdmitted: async () => {
        await Promise.all([
          startCardRun({
            runId: run.runId,
            submissionId: run.runId,
            hermesSessionRef: binding!.sessionId,
          }),
          settleConversationMessage({
            projectId,
            conversationId,
            messageId: clientMessageId,
            providerMessageId: initialProviderMessageId,
            status: 'complete',
          }),
        ]);
        userSettled = true;
        writeSse(res, 'run', { ...identity, state: 'running' });
      },
      onEvent: (event) => {
        if (event.type === 'message.delta') {
          const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
          streamedText += text;
          writeSse(res, 'text', { ...identity, text });
        } else if (event.type.includes('reasoning')) {
          writeSse(res, 'reasoning', { ...identity, event });
        } else if (event.type === 'tool.start') {
          writeSse(res, 'tool_start', { ...identity, event });
        } else if (event.type === 'tool.complete') {
          writeSse(res, 'tool_result', { ...identity, event });
        }
      },
    });
    await settleRun({
      run,
      binding,
      result,
      inputMessageIds: [...admission.inputMessageIds],
    });
    runSettled = true;
    if (result.text.trim()) {
      await appendConversationReplyOnce({
        projectId,
        conversationId,
        message: {
          messageId: clientReplyMessageId,
          role: 'assistant',
          content: result.text,
          speaker: participant(main),
          target: USER,
          providerContinuationRef: binding.sessionId,
          providerMessageId: result.providerTurnRef,
        },
      });
    }
    writeSse(res, 'done', { ...identity, fullText: result.text });
  } catch (error) {
    const cancelled = error instanceof Error && error.message === 'card_turn_cancelled';
    rejectAdmission(admission, error);
    if (!userSettled) {
      await settleConversationMessage({
        projectId,
        conversationId,
        messageId: clientMessageId,
        providerMessageId: initialProviderMessageId,
        status: 'error',
      }).catch(() => undefined);
    }
    if (!runSettled) {
      await settleRun({
        run,
        binding,
        error,
        cancelled,
        inputMessageIds: [...admission.inputMessageIds],
      }).catch(() => undefined);
    }
    if (cancelled) {
      writeSse(res, 'done', { ...identity, fullText: streamedText, state: 'cancelled' });
    } else {
      writeSse(res, 'error', {
        ...identity,
        code: error instanceof Error ? error.message : 'card_turn_failed',
        message: error instanceof Error ? error.message : 'The Card turn failed.',
        correlationId: run.runId,
        route: '/api/main/session/chat',
        status: 502,
      });
    }
  } finally {
    if (activeMainByScope.get(key) === admission) activeMainByScope.delete(key);
    activeRuns.delete(activeKey);
    writeSse(res, 'end', identity);
    res.end();
  }
  return undefined;
});

mainSessionRoutes.get('/history', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const deckId = String(req.query.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  if (!projectId) return res.status(400).json({ ok: false, error: 'project_required' });
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const messages = (await getConversationMessages(projectId, authorization.projectSessionId))
      .map(visibleMessage)
      .filter((message): message is NonNullable<ReturnType<typeof visibleMessage>> => message !== null);
    return res.json({
      ok: true,
      mainCardId: authority.main.card.id,
      addressableAgents: agentRosterCards(authority, authority.main).flatMap((card) => (
        card.address ? [{
          cardId: card.card.id,
          cardRevisionId: card.cardRevisionId,
          profile: card.profile,
          title: card.title,
          address: card.address,
        }] : []
      )),
      messages,
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'conversation_history_read_failed',
    });
  }
});

mainSessionRoutes.post('/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const expectedRunId = String(req.body?.expectedRunId || '').trim();
  if (!projectId || !deckId || !expectedRunId) {
    return res.status(400).json({ ok: false, error: 'project_and_expected_run_required' });
  }
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  const key = runKey(projectId, deckId, authorization.userId, expectedRunId);
  const active = activeRuns.get(key);
  if (!active) return res.status(409).json({ ok: false, error: 'no_active_turn' });
  try {
    const interrupted = record(await active.client.request('session.interrupt', {
      session_id: active.binding.liveHandle,
      profile: active.profile,
    }));
    if (String(interrupted.status || '') !== 'interrupted') {
      throw new Error('card_interrupt_not_confirmed');
    }
    active.abortController.abort();
    return res.json({ ok: true, runId: expectedRunId, state: 'stopping' });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'main_run_stop_failed',
    });
  }
});

mainSessionRoutes.post('/voice/start', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const ttsRequested = req.body?.tts !== false;
  if (!projectId || !deckId) return res.status(400).json({ ok: false, error: 'voice_scope_required' });
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  let client: CardRuntimeClient;
  let binding: CardSessionBinding;
  let main: ProjectCardBinding;
  let status: Record<string, any>;
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    main = authority.main;
    client = await cardRuntimeGateway();
    binding = await resolveMainSession(client, authority, {
      projectId,
      projectSessionId: authorization.projectSessionId,
      userId: authorization.userId,
    });
    status = record(await client.request('voice.toggle', {
      action: 'status', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000));
    if (status.available === false || status.stt_available === false) {
      return res.status(503).json({ ok: false, error: 'card_voice_unavailable' });
    }
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'voice_start_failed',
    });
  }
  openSse(res);
  const identity = { projectId, deckId, cardId: main.card.id, sessionId: binding.sessionId };
  let closed = false;
  const detach = client.onEvent((event) => {
    if (event.session_id !== binding.liveHandle) return;
    if (event.type === 'voice.status') writeSse(res, 'status', { ...identity, event });
    else if (event.type === 'voice.transcript') writeSse(res, 'transcript', { ...identity, event });
    else if (event.type === 'voice.interrupted') {
      writeSse(res, 'status', { ...identity, event: { ...event, payload: { state: 'interrupted' } } });
    }
  });
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    detach();
    void client.request('voice.toggle', {
      action: 'off', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000).catch(() => undefined);
  };
  req.once('aborted', cleanup);
  res.once('close', cleanup);
  try {
    let voiceState = record(await client.request('voice.toggle', {
      action: 'on', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000));
    if (ttsRequested && voiceState.tts !== true) {
      voiceState = record(await client.request('voice.toggle', {
        action: 'tts', profile: main.profile, session_id: binding.liveHandle,
      }, 60_000));
    }
    const recording = record(await client.request('voice.record', {
      action: 'start', profile: main.profile, session_id: binding.liveHandle,
    }, 60_000));
    if (recording.status !== 'recording') throw new Error('voice_capture_busy');
    writeSse(res, 'ready', {
      ...identity,
      state: {
        enabled: voiceState.enabled === true,
        tts: voiceState.tts === true,
        available: status.available === true,
        audioAvailable: status.audio_available === true,
        sttAvailable: status.stt_available === true,
        details: String(status.details || ''),
        recordStatus: recording.status,
      },
    });
  } catch (error) {
    writeSse(res, 'error', {
      ...identity,
      error: error instanceof Error ? error.message : 'voice_start_failed',
    });
    res.end();
  }
  return undefined;
});

mainSessionRoutes.post('/voice/stop', async (req, res) => {
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || DEFAULT_PROJECT_DECK_ID).trim();
  const cancel = req.body?.cancel === true;
  if (!projectId || !deckId) return res.status(400).json({ ok: false, error: 'voice_scope_required' });
  const authorization = await authorizeProject(req, res, projectId);
  if (!authorization) return undefined;
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const main = authority.main;
    const client = await cardRuntimeGateway();
    const binding = await resolveMainSession(client, authority, {
      projectId,
      projectSessionId: authorization.projectSessionId,
      userId: authorization.userId,
    });
    const result = record(await client.request(
      cancel ? 'voice.toggle' : 'voice.record',
      cancel
        ? { action: 'off', profile: main.profile, session_id: binding.liveHandle }
        : { action: 'stop', profile: main.profile, session_id: binding.liveHandle },
      60_000,
    ));
    return res.json({ ok: true, state: String(result.status || (cancel ? 'off' : 'stopped')) });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'voice_stop_failed',
    });
  }
});

export default mainSessionRoutes;
