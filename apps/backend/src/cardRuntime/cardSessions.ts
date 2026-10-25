/**
 * Entity: Card Sessions
 * Relationship: Binds one saved Card profile to its exact canonical Bot Chat through the shared Gateway connection.
 * Entity: Saved Cards
 * Relationship: Applies the existing saved profile materialization before resolving that Card's conversation.
 */

import {
  CARD_RUNTIME_CONTRACT,
  type CardRuntimeClient,
} from '../services/cardRuntimeGateway';
import { readToolCatalog } from '../services/mcp/toolCatalogMcpClient';
import { assertCardProfileOwner } from '../services/projectStore';
import {
  objectRecord,
  type ProjectCardAuthority,
  type ProjectCardBinding,
} from '../services/projectCardAuthority';
import {
  cardModelSelection,
  ensureSavedCardProfile,
  materializeSavedCardProfile,
  savedCardAgentRoster,
  type CardProfileState,
} from './profileMaterialization';

export type CardSessionScope = { userId?: string };

export type CardSessionBinding = {
  sessionId: string;
  liveHandle: string;
  info: Record<string, any>;
};

const resolutions = new Map<string, Promise<CardSessionBinding>>();

function requestWith(client: CardRuntimeClient) {
  return <T>(method: string, params: Record<string, unknown> = {}) => (
    client.request<T>(method, params)
  );
}

function binding(value: unknown, stableId = ''): CardSessionBinding {
  const result = objectRecord(value);
  const liveHandle = String(result.session_id || '').trim();
  const sessionId = String(stableId || result.stored_session_id || result.session_key || '').trim();
  if (!sessionId || !liveHandle) throw new Error('card_session_binding_invalid');
  return { sessionId, liveHandle, info: objectRecord(result.info) };
}

function exactRows(value: unknown): Record<string, any>[] {
  const result = objectRecord(value);
  return (Array.isArray(result.sessions) ? result.sessions : [])
    .map(objectRecord)
    .filter((row) => {
      const rootTitle = String(row.root_title || '').trim();
      const title = String(row.title || '').trim();
      return rootTitle === CARD_RUNTIME_CONTRACT.messageSessionTitle
        || (!rootTitle && title === CARD_RUNTIME_CONTRACT.messageSessionTitle);
    });
}

async function profileRow(client: CardRuntimeClient, profile: string): Promise<Record<string, any>> {
  const result = objectRecord(await client.request('profiles.list', {}));
  const rows = (Array.isArray(result.profiles) ? result.profiles : [])
    .map(objectRecord)
    .filter((row) => String(row.name || '').toLowerCase() === profile.toLowerCase());
  if (rows.length !== 1) throw new Error(`card_profile_identity_ambiguous:${profile}`);
  return rows[0];
}

async function findBotChat(
  client: CardRuntimeClient,
  profile: string,
): Promise<Record<string, any> | null> {
  const profileState = await profileRow(client, profile);
  const rows = exactRows(await client.request('session.list', {
    profile,
    title: CARD_RUNTIME_CONTRACT.messageSessionTitle,
    limit: 200,
    include_hidden: true,
  }));
  if (rows.length > 1) throw new Error(`card_session_identity_ambiguous:${profile}`);
  if (!rows.length && String(objectRecord(profileState.canonical_session).id || '').trim()) {
    throw new Error(`card_session_registry_unconfirmed:${profile}`);
  }
  return rows[0] || null;
}

async function resumeBotChat(
  client: CardRuntimeClient,
  profile: string,
  row: Record<string, any>,
): Promise<CardSessionBinding> {
  const sessionId = String(row.id || '').trim();
  const liveHandle = String(row.resolved_id || sessionId).trim();
  if (!sessionId || !liveHandle) throw new Error(`card_session_identity_invalid:${profile}`);
  return binding(await client.request('session.resume', {
    session_id: liveHandle,
    profile,
    defer_history: true,
    omit_messages: true,
  }), sessionId);
}

async function createBotChat(
  client: CardRuntimeClient,
  card: ProjectCardBinding,
): Promise<CardSessionBinding> {
  const created = binding(await client.request('session.create', {
    profile: card.profile,
    title: CARD_RUNTIME_CONTRACT.messageSessionTitle,
    hidden: true,
    follow_profile_config: true,
    source: 'gui',
  }));
  try {
    await client.request('session.title', {
      session_id: created.liveHandle,
      profile: card.profile,
      title: CARD_RUNTIME_CONTRACT.messageSessionTitle,
    });
    return created;
  } catch (error) {
    if (!/already in use/i.test(error instanceof Error ? error.message : String(error))) throw error;
    const winner = await findBotChat(client, card.profile);
    if (!winner) throw error;
    return resumeBotChat(client, card.profile, winner);
  }
}

async function finishBinding(
  client: CardRuntimeClient,
  card: ProjectCardBinding,
  profile: CardProfileState,
  session: CardSessionBinding,
): Promise<CardSessionBinding> {
  if (card.card.runtime.mode === 'main') {
    const busy = objectRecord(await client.request('config.set', {
      profile: card.profile,
      session_id: session.liveHandle,
      key: 'busy',
      value: 'steer',
    }));
    if (busy.key !== 'busy' || busy.value !== 'steer') {
      throw new Error('main_steer_configuration_failed');
    }
  }
  const desired = cardModelSelection(objectRecord(card.card.runtimeOptions));
  const provider = String(session.info.provider || profile.model?.provider || '').trim();
  const model = String(session.info.model || profile.model?.default || '').trim();
  if (provider !== desired.provider || model !== desired.model) {
    throw new Error(`card_session_readback_mismatch:${card.profile}`);
  }
  return { ...session, info: { ...session.info, provider, model } };
}

async function resolve(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: CardSessionScope,
  ownerUserId: string,
): Promise<CardSessionBinding> {
  await assertCardProfileOwner(card.profile, ownerUserId);
  const request = requestWith(client);
  const existingProfile = await ensureSavedCardProfile(
    request,
    authority.deck,
    card.card,
    ownerUserId,
  );
  const catalog = await readToolCatalog();
  const profile = await materializeSavedCardProfile(
    request,
    authority.deck,
    card.card,
    ownerUserId,
    existingProfile,
    catalog.tools,
    catalog.unavailableFamilies,
    savedCardAgentRoster(authority.deck, card.card),
  );
  const existing = await findBotChat(client, card.profile);
  const session = existing
    ? resumeBotChat(client, card.profile, existing)
    : createBotChat(client, card);
  return finishBinding(client, card, profile, await session);
}

export function resolveCardSession(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  card: ProjectCardBinding,
  scope: CardSessionScope,
): Promise<CardSessionBinding> {
  const ownerUserId = String(scope.userId || '').trim();
  if (!ownerUserId) return Promise.reject(new Error('card_profile_owner_required'));
  const key = `${ownerUserId}:${card.profile.toLowerCase()}`;
  const active = resolutions.get(key);
  if (active) return active;
  const current = resolve(client, authority, card, scope, ownerUserId).finally(() => {
    if (resolutions.get(key) === current) resolutions.delete(key);
  });
  resolutions.set(key, current);
  return current;
}

export function resolveMainSession(
  client: CardRuntimeClient,
  authority: ProjectCardAuthority,
  scope: CardSessionScope,
): Promise<CardSessionBinding> {
  return resolveCardSession(client, authority, authority.main, scope);
}
