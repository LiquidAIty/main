/**
 * Entity: Card Sessions
 * Relationship: Binds each enabled saved Card to its one persistent external runtime session.
 * Entity: Saved Cards
 * Relationship: Materializes saved profile authority before opening or resuming its session.
 */

import { BUILDER_CARD_ID } from '../decks/deckDomainClient';
import {
  CARD_RUNTIME_CONTRACT,
  type CardRuntimeClient,
} from '../services/cardRuntimeGateway';
import { assertCardProfileOwner } from '../services/projectStore';
import type { ProjectCardAuthority, ProjectCardBinding } from '../services/projectCardAuthority';
import { objectRecord } from '../services/projectCardAuthority';
import { readToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import {
  resolveBuilderProjectCodeDirectory,
  resolveProductChatWorkingDirectory,
} from '../services/workingDirectories';
import {
  ensureSavedCardProfile,
  cardModelSelection,
  materializeSavedCardProfile,
  savedCardAgentRoster,
  type CardProfileState,
} from './profileMaterialization';

const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const CARD_SESSION_RESUME_TIMEOUT_MS = 60_000;
const profileTails = new Map<string, Promise<void>>();

export type CardSessionScope = {
  cwd?: string;
  projectId?: string;
  projectSessionId?: string;
  userId?: string;
};

export type CardSessionBinding = {
  sessionId: string;
  liveHandle: string;
  info: Record<string, any>;
};

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
    throw new Error(`card_reasoning_effort_invalid:${card.profile}`);
  }
  return value;
}

function cardWorkingDirectory(
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: CardSessionScope,
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

function sessionBinding(value: unknown, storedFallback = ''): CardSessionBinding {
  const result = objectRecord(value);
  const liveHandle = String(result.session_id || '').trim();
  const sessionId = String(storedFallback || result.stored_session_id || result.session_key).trim();
  if (!liveHandle || !sessionId) throw new Error('card_session_binding_invalid');
  return { liveHandle, sessionId, info: objectRecord(result.info) };
}

function profileRequest(client: CardRuntimeClient) {
  return <T>(method: string, params: Record<string, unknown> = {}) => (
    client.request<T>(method, params)
  );
}

async function ensureProfile(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  ownerUserId: string,
): Promise<CardProfileState> {
  await assertCardProfileOwner(card.profile, ownerUserId);
  return ensureSavedCardProfile(profileRequest(client), authority.deck, card.card, ownerUserId);
}

async function materializeProfile(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  ownerUserId: string,
  current: CardProfileState,
  catalog: Awaited<ReturnType<typeof readToolCatalog>>,
): Promise<CardProfileState> {
  return materializeSavedCardProfile(
    profileRequest(client),
    authority.deck,
    card.card,
    ownerUserId,
    current,
    catalog.tools,
    catalog.unavailableFamilies,
    savedCardAgentRoster(authority.deck, card.card),
  );
}

async function bindProfileSession(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: CardSessionScope,
  profile: CardProfileState,
): Promise<CardSessionBinding> {
  const listed = objectRecord(await client.request('session.list', {
    profile: card.profile,
    title: CARD_RUNTIME_CONTRACT.messageSessionTitle,
    limit: 200,
    include_hidden: true,
  }));
  const matches = (Array.isArray(listed.sessions) ? listed.sessions : [])
    .map(objectRecord)
    .filter((row) => (
      String(row.root_title || '').trim() === CARD_RUNTIME_CONTRACT.messageSessionTitle
      || (!row.root_title
        && String(row.title || '').trim() === CARD_RUNTIME_CONTRACT.messageSessionTitle)
    ));
  if (matches.length > 1) throw new Error(`card_session_identity_ambiguous:${card.profile}`);
  const canonical = matches[0];
  const registryId = String(canonical?.id || '').trim();
  const resumeId = String(canonical?.resolved_id || registryId).trim();
  if (canonical && (!registryId || !resumeId)) {
    throw new Error(`card_session_identity_invalid:${card.profile}`);
  }
  let live: CardSessionBinding;
  if (registryId) {
    live = sessionBinding(await client.request('session.resume', {
      session_id: resumeId,
      profile: card.profile,
      cols: 96,
      defer_history: true,
      omit_messages: true,
    }, CARD_SESSION_RESUME_TIMEOUT_MS), registryId);
  } else {
    live = sessionBinding(await client.request('session.create', {
      profile: card.profile,
      title: CARD_RUNTIME_CONTRACT.messageSessionTitle,
      cwd: cardWorkingDirectory(authority, card, scope),
      cwd_explicit: true,
      hidden: true,
      follow_profile_config: true,
      ...(reasoningEffort(card) ? { reasoning_effort: reasoningEffort(card) } : {}),
    }));
    await client.request('session.title', {
      session_id: live.liveHandle,
      profile: card.profile,
      title: CARD_RUNTIME_CONTRACT.messageSessionTitle,
    });
  }
  if (card.card.runtime.mode === 'main') {
    const busy = objectRecord(await client.request('config.set', {
      profile: card.profile,
      session_id: live.liveHandle,
      key: 'busy',
      value: 'steer',
    }));
    if (busy.key !== 'busy' || busy.value !== 'steer') {
      throw new Error('main_steer_configuration_failed');
    }
  }
  const desired = cardModelSelection(objectRecord(card.card.runtimeOptions));
  const provider = String(live.info.provider || profile.model?.provider || '').trim();
  const model = String(live.info.model || profile.model?.default || '').trim();
  if (provider !== desired.provider || model !== desired.model) {
    throw new Error(`card_session_readback_mismatch:${card.profile}`);
  }
  return { ...live, info: { ...live.info, provider, model } };
}

export async function resolveCardSession(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: CardSessionScope,
): Promise<CardSessionBinding> {
  const ownerUserId = String(scope.userId || '').trim();
  if (!ownerUserId) throw new Error('card_profile_owner_required');
  return withProfileLock(`${ownerUserId}:${card.profile.toLowerCase()}`, async () => {
    const catalog = await readToolCatalog();
    const existing = await ensureProfile(client, authority, card, ownerUserId);
    const profile = await materializeProfile(
      client, authority, card, ownerUserId, existing, catalog,
    );
    return bindProfileSession(client, authority, card, scope, profile);
  });
}

export async function resolveMainSession(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  scope: CardSessionScope,
): Promise<CardSessionBinding> {
  return resolveCardSession(client, authority, authority.main, scope);
}

export async function startProjectCardSessions(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  scope: CardSessionScope,
): Promise<void> {
  const ownerUserId = String(scope.userId || '').trim();
  if (!ownerUserId) throw new Error('card_profile_owner_required');
  const cards = authority.cards.filter((card) => (
    card.card.runtime.kind === CARD_RUNTIME_CONTRACT.kind
  ));
  const catalog = await readToolCatalog();
  const ensured = await Promise.all(cards.map((card) => withProfileLock(
    `${ownerUserId}:${card.profile.toLowerCase()}`,
    () => ensureProfile(client, authority, card, ownerUserId),
  )));
  const results = await Promise.allSettled(cards.map((card, index) => withProfileLock(
    `${ownerUserId}:${card.profile.toLowerCase()}`,
    async () => {
      const profile = await materializeProfile(
        client, authority, card, ownerUserId, ensured[index], catalog,
      );
      return bindProfileSession(client, authority, card, scope, profile);
    },
  )));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Card session startup failed:${cards[index].profile}`, result.reason);
    }
  });
}
