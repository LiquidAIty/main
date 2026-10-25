/**
 * Entity: Main Chat
 * Relationship: Authenticates one Project and transports its saved Main Card conversation through the existing Hermes Gateway.
 * Entity: Conversation Store
 * Relationship: Projects confirmed Hermes transcript rows into the existing Project conversation exactly once by provider row identity.
 */

import { Router, type Request, type Response } from 'express';

import { resolveMainSession } from '../cardRuntime/cardSessions';
import { savedCardAgentRoster } from '../cardRuntime/profileMaterialization';
import {
  appendConversationReplyOnce,
  appendConversationTurn,
  getConversationMessages,
  type ConversationMessage,
  type ConversationMessageWrite,
  type ConversationParticipant,
} from '../conversations/store';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { cardRuntimeGateway, type CardRuntimeClient, type CardRuntimeEvent } from '../services/cardRuntimeGateway';
import { objectRecord, projectCardAuthority, type ProjectCardAuthority } from '../services/projectCardAuthority';
import { requireOwnedProject } from './projectAccess';

const router = Router();
const USER: ConversationParticipant = { kind: 'user', label: 'You' };
const MESSAGE_ID = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = {
  projectId: string; authority: ProjectCardAuthority; client: CardRuntimeClient;
  session: Awaited<ReturnType<typeof resolveMainSession>>;
};

type TranscriptRow = { role: 'user' | 'assistant'; text: string; rowId: number };

function required(value: unknown, code: string, limit = 120_000): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > limit) throw new Error(code);
  return result;
}

function failure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return code && code.length <= 160 && /^[a-z0-9_:-]+$/i.test(code) ? code : 'main_session_failed';
}

function mainParticipant(authority: ProjectCardAuthority): ConversationParticipant {
  return {
    kind: 'card', label: authority.main.title,
    cardId: authority.main.card.id, profile: authority.main.profile,
    ...(authority.main.address ? { address: authority.main.address } : {}),
  };
}

async function authorizedContext(req: Request, res: Response, projectValue: unknown, deckValue: unknown):
Promise<Context | null> {
  const reference = required(projectValue, 'main_project_required', 128);
  const deckId = required(deckValue || DEFAULT_PROJECT_DECK_ID, 'main_deck_required', 128);
  const project = await requireOwnedProject(req, res, reference);
  if (!project) return null;
  const authority = await projectCardAuthority(project.projectId, deckId);
  const client = await cardRuntimeGateway();
  const scope = { projectId: project.projectId, projectSessionId: project.projectId, userId: project.ownerUserId };
  const session = await resolveMainSession(client, authority, scope);
  return { projectId: project.projectId, authority, client, session };
}

async function transcript(ctx: Context): Promise<TranscriptRow[]> {
  const result = objectRecord(await ctx.client.request('session.history', {
    session_id: ctx.session.liveHandle,
    profile: ctx.authority.main.profile,
  }));
  const messages = (Array.isArray(result.messages) ? result.messages : []).map(objectRecord);
  return messages.flatMap((row): TranscriptRow[] => {
    const role = String(row.role || '');
    const text = typeof row.text === 'string'
      ? row.text : typeof row.content === 'string' ? row.content : '';
    const rowId = Number(row.row_id);
    if (
      !['user', 'assistant'].includes(role)
      || !text.trim()
      || row.display_kind
      || !Number.isSafeInteger(rowId)
      || rowId <= 0
    ) return [];
    return [{ role: role as TranscriptRow['role'], text, rowId }];
  });
}

function providerId(ctx: Context, rowId: number): string {
  return `hermes:${ctx.session.sessionId}:row:${rowId}`;
}

function write(ctx: Context, row: TranscriptRow): ConversationMessageWrite {
  return {
    role: row.role, content: row.text,
    speaker: row.role === 'user' ? USER : mainParticipant(ctx.authority),
    status: 'complete', providerMessageId: providerId(ctx, row.rowId),
  };
}

async function projectTranscript(ctx: Context, rows: TranscriptRow[]): Promise<ConversationMessage[]> {
  let stored = await getConversationMessages(ctx.projectId, ctx.projectId);
  if (!stored.length && rows.length) {
    await appendConversationTurn({
      projectId: ctx.projectId,
      conversationId: ctx.projectId,
      messages: rows.map((row) => write(ctx, row)),
    });
  } else {
    for (const row of rows) {
      if (row.role !== 'assistant') continue;
      await appendConversationReplyOnce({
        projectId: ctx.projectId,
        conversationId: ctx.projectId,
        message: { ...write(ctx, row), role: 'assistant', providerMessageId: providerId(ctx, row.rowId) },
      });
    }
  }
  stored = await getConversationMessages(ctx.projectId, ctx.projectId);
  return stored;
}

function participant(message: ConversationMessage, kind: string): ConversationParticipant | null {
  const item = message.visibleActivities?.find((activity) => activity.kind === kind);
  if (!item || !['user', 'card'].includes(String(item.status || ''))) return null;
  return {
    kind: item.status as ConversationParticipant['kind'], label: item.label,
    ...(item.cardId ? { cardId: item.cardId } : {}),
    ...(item.profile ? { profile: item.profile } : {}), ...(item.address ? { address: item.address } : {}),
  };
}

function visibleMessage(message: ConversationMessage): Record<string, unknown>[] {
  if (!['user', 'assistant'].includes(message.role) || !message.content.trim()) return [];
  const speaker = participant(message, 'conversation_speaker');
  const target = participant(message, 'conversation_target');
  if (!speaker) return [];
  return [{
    role: message.role, text: message.content, speaker,
    ...(target ? { target } : {}),
    ...(message.linkedEvidenceIds?.length ? { linkedEvidenceIds: message.linkedEvidenceIds } : {}),
  }];
}

function addressableAgents(authority: ProjectCardAuthority) {
  const profiles = new Set(savedCardAgentRoster(authority.deck, authority.main.card));
  return authority.cards.flatMap((card) => profiles.has(card.profile) && card.address ? [{
    cardId: card.card.id, cardRevisionId: card.cardRevisionId,
    profile: card.profile, title: card.title, address: card.address,
  }] : []);
}

function send(res: Response, kind: string, payload: Record<string, unknown>): void {
  if (!res.destroyed && !res.writableEnded) res.write(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function openStream(res: Response): void {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

router.get('/history', async (req, res) => {
  try {
    const ctx = await authorizedContext(req, res, req.query.projectId, req.query.deckId);
    if (!ctx) return undefined;
    const history = await transcript(ctx);
    const stored = await projectTranscript(ctx, history);
    return res.json({
      mainCardId: ctx.authority.main.card.id,
      addressableAgents: addressableAgents(ctx.authority),
      messages: stored.flatMap(visibleMessage),
    });
  } catch (error) {
    return res.status(503).json({ error: failure(error) });
  }
});

router.post('/chat', async (req, res) => {
  let detach = () => undefined;
  try {
    const ctx = await authorizedContext(req, res, req.body?.projectId, req.body?.deckId);
    if (!ctx) return undefined;
    const text = required(req.body?.message, 'main_prompt_empty');
    const messageId = required(req.body?.clientMessageId, 'main_message_identity_required', 128);
    if (!MESSAGE_ID.test(messageId)) throw new Error('main_message_identity_invalid');
    if (req.body?.images?.length || req.body?.dataAnchors?.length) throw new Error('main_text_only');
    const before = await transcript(ctx);

    openStream(res);

    let ready = false;
    let finished = false;
    const buffered: CardRuntimeEvent[] = [];
    let resolveTurn!: () => void;
    let rejectTurn!: (error: Error) => void;
    const turn = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });

    const complete = async (runtimeEvent: CardRuntimeEvent) => {
      if (finished) return;
      finished = true;
      const payload = objectRecord(runtimeEvent.payload);
      const textValue = typeof payload.text === 'string'
        ? payload.text : typeof payload.rendered === 'string' ? payload.rendered : '';
      if (payload.status === 'error') throw new Error(String(payload.failure_reason || 'main_turn_failed'));
      if (!textValue.trim()) throw new Error('main_runtime_reply_missing');
      await projectTranscript(ctx, await transcript(ctx));
      send(res, 'done', { fullText: textValue, participant: mainParticipant(ctx.authority) });
      res.end();
      resolveTurn();
    };

    const receive = (runtimeEvent: CardRuntimeEvent) => {
      if (runtimeEvent.session_id !== ctx.session.liveHandle || finished) return;
      if (!ready) {
        buffered.push(runtimeEvent);
        return;
      }
      const payload = objectRecord(runtimeEvent.payload);
      if (runtimeEvent.type === 'message.delta') {
        const chunk = typeof payload.text === 'string'
          ? payload.text : typeof payload.rendered === 'string' ? payload.rendered : '';
        if (chunk) send(res, 'text', { text: chunk, participant: mainParticipant(ctx.authority) });
      } else if (runtimeEvent.type === 'message.complete') {
        void complete(runtimeEvent).catch(rejectTurn);
      }
    };

    const offEvent = ctx.client.onEvent(receive);
    const offState = ctx.client.onState((state) => {
      if (state === 'closed' || state === 'error') rejectTurn(new Error('main_runtime_connection_lost'));
    });
    detach = () => { offEvent(); offState(); };
    res.once('close', () => { if (!finished) resolveTurn(); detach(); });

    const receipt = objectRecord(await ctx.client.request('prompt.submit', {
      session_id: ctx.session.liveHandle,
      profile: ctx.authority.main.profile,
      submission_id: messageId,
      text,
    }));
    const userRowId = Number(receipt.user_row_id);
    const receiptId = typeof receipt.admission_id === 'string' ? receipt.admission_id.trim() : '';
    const userProviderId = Number.isSafeInteger(userRowId) && userRowId > 0
      ? providerId(ctx, userRowId)
      : receiptId ? `hermes:${ctx.session.sessionId}:receipt:${receiptId}:user` : messageId;
    await appendConversationTurn({
      projectId: ctx.projectId,
      conversationId: ctx.projectId,
      seedMessages: before.map((row) => write(ctx, row)),
      messages: [{
        messageId,
        role: 'user',
        content: text,
        speaker: USER,
        status: 'complete',
        providerMessageId: userProviderId,
      }],
    });
    send(res, 'session', { sessionId: ctx.session.sessionId, participant: mainParticipant(ctx.authority) });
    ready = true;
    buffered.splice(0).forEach(receive);
    await turn;
    return undefined;
  } catch (error) {
    const code = failure(error);
    if (!res.headersSent) return res.status(503).json({ error: code });
    send(res, 'error', { code, message: code, route: '/api/main/session/chat', status: 502 });
    res.end();
    return undefined;
  } finally {
    detach();
  }
});

export default router;
