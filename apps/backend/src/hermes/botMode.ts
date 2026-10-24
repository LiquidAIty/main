/**
 * Entity: Bot Mode
 * Relationship: Binds saved Cards to canonical Hermes Bot Chat sessions and observes standard prompt events without replacing Hermes delivery.
 */

import { BUILDER_CARD_ID } from '../decks/deckDomainClient';
import {
  ensureSavedCardProfile,
  hermesProfileModelSelection,
  materializeSavedCardProfile,
  savedCardBotRoster,
} from './profileMaterialization';
import type { HermesGatewayClient, HermesGatewayEvent } from '../services/hermesGateway';
import { assertHermesProfileOwner } from '../services/projectStore';
import type { ProjectCardAuthority, ProjectCardBinding } from '../services/projectCardAuthority';
import { objectRecord } from '../services/projectCardAuthority';
import { readToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import {
  resolveBuilderProjectCodeDirectory,
  resolveProductChatWorkingDirectory,
} from '../services/workingDirectories';

const BOT_CHAT_TITLE = 'Bot Chat';
const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const BOT_REPLY_KINDS = new Set(['process_complete', 'async_delegation_complete']);
const profileTails = new Map<string, Promise<void>>();

export type SessionScope = {
  cwd?: string;
  projectId?: string;
  projectSessionId?: string;
  userId?: string;
};

export type ProjectCardSession = {
  sessionId: string;
  liveHandle: string;
  info: Record<string, any>;
};

export type HermesTurnResult = {
  text: string;
  event: HermesGatewayEvent;
  toolCalls: number;
  providerTurnRef: string;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

async function withProfileLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = profileTails.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  profileTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (profileTails.get(key) === tail) profileTails.delete(key);
  }
}

function reasoningEffort(card: ProjectCardBinding): string {
  const value = String(card.card.runtimeOptions?.reasoningEffort || '').trim().toLowerCase();
  if (value && !REASONING_EFFORTS.has(value)) {
    throw new Error(`hermes_card_reasoning_effort_invalid:${card.profile}`);
  }
  return value;
}

function cardCwd(
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: SessionScope,
): string {
  if (scope.cwd) return scope.cwd;
  if (card.card.id === BUILDER_CARD_ID && scope.projectId) {
    return resolveBuilderProjectCodeDirectory(
      String(scope.projectSessionId || scope.projectId),
      authority.deck.projectCodeFolder,
    );
  }
  if (card.card.runtime.mode === 'main') return resolveProductChatWorkingDirectory();
  const identity = [scope.userId, scope.projectSessionId || scope.projectId, card.card.id]
    .map((value) => String(value || '').trim()).filter(Boolean).join(':');
  return resolveProductChatWorkingDirectory(identity || undefined);
}

function sessionRows(value: unknown): Array<Record<string, any>> {
  const rows = objectRecord(value).sessions;
  if (!Array.isArray(rows)) throw new Error('hermes_session_list_invalid');
  return rows.map(objectRecord);
}

function sessionResult(value: unknown, storedFallback = ''): ProjectCardSession {
  const result = objectRecord(value);
  const liveHandle = String(result.session_id || '').trim();
  const sessionId = String(result.stored_session_id || result.session_key || storedFallback).trim();
  if (!liveHandle || !sessionId) throw new Error('hermes_session_binding_invalid');
  return { liveHandle, sessionId, info: objectRecord(result.info) };
}

async function bindCardSession(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: SessionScope,
  catalog: Awaited<ReturnType<typeof readToolCatalog>>,
): Promise<ProjectCardSession> {
  const ownerUserId = String(scope.userId || '').trim();
  if (!ownerUserId) throw new Error('hermes_profile_owner_required');
  return withProfileLock(`${ownerUserId}:${card.profile.toLowerCase()}`, async () => {
    await assertHermesProfileOwner(card.profile, ownerUserId);
    const request = <T>(method: string, params: Record<string, unknown> = {}) => (
      client.request<T>(method, params)
    );
    const existing = await ensureSavedCardProfile(request, authority.deck, card.card, ownerUserId);
    const roster = savedCardBotRoster(authority.deck, card.card);
    const profile = await materializeSavedCardProfile(
      request,
      authority.deck,
      card.card,
      ownerUserId,
      existing,
      catalog.tools,
      catalog.unavailableFamilies,
      roster,
    );
    const listed = sessionRows(await client.request('session.list', {
      profile: card.profile,
      title: BOT_CHAT_TITLE,
      include_hidden: true,
      limit: 5,
    }));
    if (listed.length > 1) throw new Error(`hermes_bot_chat_ambiguous:${card.profile}`);
    let live: ProjectCardSession;
    if (listed.length === 1) {
      const storedId = String(listed[0].resolved_id || listed[0].id || '').trim();
      if (!storedId) throw new Error('hermes_session_binding_invalid');
      live = sessionResult(await client.request('session.resume', {
        session_id: storedId,
        profile: card.profile,
        omit_messages: true,
        eager_build: true,
        close_on_disconnect: false,
      }), storedId);
    } else {
      live = sessionResult(await client.request('session.create', {
        profile: card.profile,
        title: BOT_CHAT_TITLE,
        cwd: cardCwd(authority, card, scope),
        source: 'desktop',
        hidden: true,
        close_on_disconnect: false,
        follow_profile_config: true,
        idempotency_key: `bot-chat:${card.profile}`,
        ...(reasoningEffort(card) ? { reasoning_effort: reasoningEffort(card) } : {}),
      }));
    }
    const activated = sessionResult(await client.request('session.activate', {
      session_id: live.liveHandle,
      profile: card.profile,
      omit_messages: true,
    }), live.sessionId);
    if (card.card.runtime.mode === 'main') {
      const busy = objectRecord(await client.request('config.set', {
        profile: card.profile,
        session_id: activated.liveHandle,
        key: 'busy',
        value: 'steer',
      }));
      if (busy.key !== 'busy' || busy.value !== 'steer') {
        throw new Error('hermes_main_steer_configuration_failed');
      }
    }
    const desired = hermesProfileModelSelection(objectRecord(card.card.runtimeOptions));
    const provider = String(activated.info.provider || profile.model?.provider || '').trim();
    const model = String(activated.info.model || profile.model?.default || '').trim();
    if (
      activated.sessionId !== live.sessionId
      || provider !== desired.provider
      || model !== desired.model
    ) throw new Error(`hermes_bot_chat_readback_mismatch:${card.profile}`);
    return {
      ...activated,
      info: { ...activated.info, provider, model },
    };
  });
}

export async function cardProjectSession(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  selected: ProjectCardBinding,
  scope: SessionScope,
): Promise<ProjectCardSession> {
  if (selected.card.runtime.mode === 'magentic_one') {
    throw new Error('magnetic_card_has_no_cli_session');
  }
  return bindCardSession(client, authority, selected, scope, await readToolCatalog());
}

export async function mainProjectSession(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  scope: SessionScope,
): Promise<ProjectCardSession> {
  return bindCardSession(client, authority, authority.main, scope, await readToolCatalog());
}

export async function startProjectCardSessions(
  client: HermesGatewayClient,
  authority: ProjectCardAuthority,
  scope: SessionScope,
): Promise<void> {
  const catalog = await readToolCatalog();
  const cards = authority.cards.filter((card) => card.card.runtime.kind === 'hermes');
  const results = await Promise.allSettled(
    cards.map((card) => bindCardSession(client, authority, card, scope, catalog)),
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Card session startup failed:${cards[index].profile}`, result.reason);
    }
  });
}

function parsedToolResult(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    return objectRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function completionError(payloadValue: unknown): Error | null {
  const payload = objectRecord(payloadValue);
  const status = String(payload.status || 'complete').trim().toLowerCase();
  if (status === 'interrupted' || status === 'cancelled') return new Error('hermes_turn_cancelled');
  if (status === 'error' || status === 'failed') {
    return new Error(String(payload.error || payload.failure_reason || payload.text || 'hermes_turn_failed'));
  }
  return null;
}

function completionText(payload: Record<string, any>, streamed: string): string {
  if (typeof payload.text === 'string') return payload.text;
  return streamed;
}

function providerTurnRef(event: HermesGatewayEvent, fallback: string): string {
  const persisted = objectRecord(event.payload?.persisted_turn);
  return String(persisted.submission_id || fallback).trim() || fallback;
}

export async function executeHermesTurn(args: {
  client: HermesGatewayClient;
  binding: ProjectCardSession;
  profile: string;
  text: string;
  runId: string;
  stopSignal?: AbortSignal;
  onAdmitted(): Promise<void>;
  onWaitingForBotReply?(): void;
  onEvent(event: HermesGatewayEvent): void;
}): Promise<HermesTurnResult> {
  const status = objectRecord(await args.client.request('session.status', {
    session_id: args.binding.liveHandle,
  }));
  if (status.running === true) throw new Error('hermes_session_active');
  let ownStarted = false;
  let phase: 'own' | 'waiting' | 'notification' = 'own';
  let ownText = '';
  let notificationText = '';
  let toolCalls = 0;
  let waitsForReply = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachEvent: () => void = () => undefined;
  let detachState: () => void = () => undefined;
  let settle!: (value: HermesTurnResult) => void;
  let fail!: (error: Error) => void;
  let settled = false;
  const done = new Promise<HermesTurnResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    detachEvent();
    detachState();
    args.stopSignal?.removeEventListener('abort', stop);
  };
  const finish = (error?: Error, result?: HermesTurnResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) fail(error);
    else settle(result!);
  };
  const stop = () => finish(new Error('hermes_turn_cancelled'));
  if (args.stopSignal?.aborted) throw new Error('hermes_turn_cancelled');
  args.stopSignal?.addEventListener('abort', stop, { once: true });
  detachState = args.client.onState((state) => {
    if (state === 'closed' || state === 'error') {
      finish(new Error(`hermes_gateway_${state}_during_turn`));
    }
  });
  detachEvent = args.client.onEvent((event) => {
    if (event.session_id !== args.binding.liveHandle || settled) return;
    const payload = objectRecord(event.payload);
    if (phase === 'waiting') {
      if (event.type !== 'message.start' || !BOT_REPLY_KINDS.has(String(payload.display_kind || ''))) {
        return;
      }
      phase = 'notification';
      ownStarted = true;
      args.onEvent(event);
      return;
    }
    if (event.type === 'message.start') {
      if (phase === 'own') ownStarted = true;
      args.onEvent(event);
      return;
    }
    if ((phase === 'own' && !ownStarted) || (phase === 'notification' && !ownStarted)) return;
    if (event.type === 'message.delta') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (phase === 'own') ownText += text;
      else {
        notificationText += text;
        args.onEvent(event);
      }
      return;
    }
    if (event.type === 'tool.start') toolCalls += 1;
    if (event.type === 'tool.complete' && String(payload.name || '') === 'message_agent') {
      const result = parsedToolResult(payload.result);
      waitsForReply = result.status === 'queued'
        && result.reply_delivery === 'notification'
        && !result.notification_error;
    }
    if (event.type.includes('reasoning') || event.type === 'tool.start' || event.type === 'tool.complete') {
      args.onEvent(event);
    }
    if (event.type === 'error') {
      finish(new Error(String(payload.message || 'hermes_turn_failed')));
      return;
    }
    if (event.type !== 'message.complete') return;
    const error = completionError(payload);
    if (error) {
      finish(error);
      return;
    }
    if (phase === 'own' && waitsForReply) {
      phase = 'waiting';
      ownStarted = false;
      args.onWaitingForBotReply?.();
      return;
    }
    const text = phase === 'notification'
      ? completionText(payload, notificationText)
      : completionText(payload, ownText);
    finish(undefined, {
      text,
      event,
      toolCalls,
      providerTurnRef: providerTurnRef(event, args.runId),
    });
  });
  timer = setTimeout(() => finish(new Error('hermes_turn_timeout')), 30 * 60_000);
  timer.unref?.();
  try {
    const submitted = objectRecord(await args.client.request('prompt.submit', {
      session_id: args.binding.liveHandle,
      profile: args.profile,
      text: args.text,
    }));
    if (String(submitted.status || '') !== 'streaming') {
      throw new Error(`hermes_submission_not_started:${String(submitted.status || 'unknown')}`);
    }
    await args.onAdmitted();
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
  return done;
}

export async function attachImages(
  client: HermesGatewayClient,
  binding: ProjectCardSession,
  profile: string,
  images: unknown,
): Promise<void> {
  if (!Array.isArray(images)) return;
  const allowedHeaders = new Set([
    'data:image/png;base64',
    'data:image/jpeg;base64',
    'data:image/webp;base64',
    'data:image/gif;base64',
  ]);
  for (const [index, raw] of images.entries()) {
    const image = objectRecord(raw);
    const dataUrl = String(image.dataUrl || '').trim();
    if (!dataUrl) continue;
    const comma = dataUrl.indexOf(',');
    const header = comma < 0 ? '' : dataUrl.slice(0, comma).toLowerCase();
    const content = comma < 0 ? '' : dataUrl.slice(comma + 1);
    const validContent = Boolean(content) && [...content].every((character) => (
      (character >= 'A' && character <= 'Z')
      || (character >= 'a' && character <= 'z')
      || (character >= '0' && character <= '9')
      || character === '+'
      || character === '/'
      || character === '='
    ));
    if (!allowedHeaders.has(header) || !validContent) throw new Error('attachment_image_invalid');
    await client.request('image.attach_bytes', {
      session_id: binding.liveHandle,
      profile,
      content_base64: content,
      filename: String(image.name || `attachment-${index + 1}.png`),
    });
  }
}

export function botRosterCards(
  authority: ProjectCardAuthority,
  source: ProjectCardBinding,
): ProjectCardBinding[] {
  const byProfile = new Map(authority.cards.map((card) => [card.profile.toLowerCase(), card]));
  return savedCardBotRoster(authority.deck, source.card).map((profile) => {
    const card = byProfile.get(profile.toLowerCase());
    if (!card) throw new Error(`hermes_bot_roster_card_missing:${profile}`);
    return card;
  });
}

export function selectedTools(value: unknown): string[] {
  return strings(value);
}
