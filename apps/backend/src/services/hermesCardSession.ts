import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

import { BUILDER_CARD_ID } from '../decks/deckDomainClient';
import {
  materializeSavedCardProfile,
  savedCardBotRoster,
} from '../hermes/profileMaterialization';
import type { HermesGatewayClient } from './hermesGateway';
import {
  objectRecord,
  sharedChatAuthority,
  type AddressableCard,
  type SharedChatAuthority,
} from './savedCardAuthority';
import {
  resolveBuilderProjectCodeDirectory,
  resolveProductChatWorkingDirectory,
} from './workingDirectories';

export type SessionBinding = {
  sessionId: string;
  storedSessionId: string;
  info: Record<string, unknown>;
  botModeRoster: string[];
  profileCapabilityFingerprint: string;
};

// Serialize only the list/create critical section for one deterministic Card
// conversation. This map caches no session identity and never reports runtime
// state; Hermes remains the sole session authority.
const profileMaterializationTails = new Map<string, Promise<void>>();

async function withProfileMaterializationLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = profileMaterializationTails.get(key) || Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => completion);
  profileMaterializationTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (profileMaterializationTails.get(key) === tail) profileMaterializationTails.delete(key);
  }
}

function savedCardSessionTitle(args: {
  userId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId: string;
}): string {
  const digest = createHash('sha256').update(JSON.stringify([
    args.userId,
    args.projectId,
    args.deckId,
    args.cardId,
    args.conversationId,
  ])).digest('hex');
  return `Card Chat:${digest}`;
}

function cardWorkingDirectory(
  authority: SharedChatAuthority,
  card: AddressableCard,
  userId: string,
  projectId: string,
  conversationId: string,
): string {
  if (card.card.id === BUILDER_CARD_ID) {
    try {
      return resolveBuilderProjectCodeDirectory(
        projectId,
        authority.deck.projectCodeFolder,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('builder_project_')) throw error;
      throw new Error('builder_project_code_folder_unavailable');
    }
  }
  return resolveProductChatWorkingDirectory(
    `${userId}:${projectId}:${card.card.id}:${conversationId}`,
  );
}

function hermesSessionRows(value: unknown): Array<Record<string, any>> {
  const rows = objectRecord(value).sessions;
  if (!Array.isArray(rows)) throw new Error('hermes_session_list_invalid');
  return rows.map(objectRecord);
}

function hermesSessionResult(
  value: unknown,
  botModeRoster: string[],
  profileCapabilityFingerprint: string,
): SessionBinding {
  const result = objectRecord(value);
  const sessionId = String(result.session_id || '').trim();
  const storedSessionId = String(result.stored_session_id || result.session_key || '').trim();
  if (!sessionId || !storedSessionId) throw new Error('hermes_session_binding_invalid');
  return {
    sessionId,
    storedSessionId,
    info: objectRecord(result.info),
    botModeRoster: [...botModeRoster],
    profileCapabilityFingerprint,
  };
}

async function bindCardSession(
  client: HermesGatewayClient,
  authority: SharedChatAuthority,
  card: AddressableCard,
  owner: { userId: string; projectId: string; deckId: string; conversationId: string },
): Promise<SessionBinding> {
  const title = savedCardSessionTitle({ ...owner, cardId: card.card.id });
  const roster = savedCardBotRoster(authority.deck, card.card);
  const profile = card.profile;
  const profileState = objectRecord(await materializeSavedCardProfile(
    (method, params = {}) => client.request(method, params),
    card.card,
    roster,
  ));
  const profileModel = objectRecord(profileState.model);
  const profileCapabilityFingerprint = String(
    profileState.capability_fingerprint || '',
  );
  const completeBinding = (binding: SessionBinding): SessionBinding => {
    const info: Record<string, unknown> = {
      provider: String(profileModel.provider || ''),
      model: String(profileModel.default || ''),
      ...binding.info,
    };
    return { ...binding, info };
  };
  const listed = hermesSessionRows(await client.request('session.list', {
    profile,
    title,
    include_hidden: true,
    limit: 200,
  }));
  if (listed.length > 1) throw new Error('hermes_session_binding_ambiguous');
  if (listed.length === 1) {
    const stored = String(listed[0].resolved_id || listed[0].id || '').trim();
    if (!stored) throw new Error('hermes_session_binding_invalid');
    if (card.card.id === BUILDER_CARD_ID) {
      const desiredCwd = cardWorkingDirectory(
        authority,
        card,
        owner.userId,
        owner.projectId,
        owner.conversationId,
      );
      const storedCwd = String(listed[0].cwd || '').trim();
      if (storedCwd !== desiredCwd) {
        const moved = objectRecord(await client.request('session.workspace.move', {
          session_key: stored,
          profile,
          cwd: desiredCwd,
        }));
        const movedCwd = String(moved.cwd || '').trim();
        if (!movedCwd || realpathSync(movedCwd) !== desiredCwd) {
          throw new Error('builder_workspace_rebind_failed');
        }
      }
    }
    return completeBinding(hermesSessionResult(await client.request('session.resume', {
      session_id: stored,
      profile,
      omit_messages: true,
      close_on_disconnect: false,
    }), roster, profileCapabilityFingerprint));
  }
  return completeBinding(hermesSessionResult(await client.request('session.create', {
    profile,
    title,
    cwd: cardWorkingDirectory(
      authority,
      card,
      owner.userId,
      owner.projectId,
      owner.conversationId,
    ),
    source: 'desktop',
    hidden: true,
    close_on_disconnect: false,
    follow_profile_config: true,
    bot_mode_roster: roster,
  }), roster, profileCapabilityFingerprint));
}

export async function cardSession(
  client: HermesGatewayClient,
  card: AddressableCard,
  owner: { userId: string; projectId: string; deckId: string; conversationId: string },
): Promise<SessionBinding> {
  return withProfileMaterializationLock(
    card.profile,
    async () => {
      const currentAuthority = await sharedChatAuthority(owner.projectId, owner.deckId);
      const currentCards = currentAuthority.cards.filter(
        (candidate) => candidate.card.id === card.card.id,
      );
      if (
        currentCards.length !== 1
        || currentCards[0].cardRevisionId !== card.cardRevisionId
        || currentCards[0].profile !== card.profile
      ) {
        throw new Error('card_revision_changed');
      }
      return bindCardSession(client, currentAuthority, currentCards[0], owner);
    },
  );
}


export async function attachHermesImages(
  client: HermesGatewayClient,
  binding: SessionBinding,
  profile: string,
  images: unknown,
): Promise<void> {
  if (!Array.isArray(images)) return;
  for (const [index, raw] of images.entries()) {
    const image = objectRecord(raw);
    const dataUrl = String(image.dataUrl || '').trim();
    if (!dataUrl) continue;
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw new Error('attachment_image_invalid');
    await client.request('image.attach_bytes', {
      session_id: binding.sessionId,
      profile,
      content_base64: match[2],
      filename: String(image.name || `attachment-${index + 1}.png`),
    });
  }
}


export async function interruptSavedCardRun(
  client: HermesGatewayClient,
  target: AddressableCard,
  owner: { userId: string; projectId: string; deckId: string; conversationId: string },
  expectedRunId: string,
): Promise<boolean> {
  const title = savedCardSessionTitle({ ...owner, cardId: target.card.id });
  const storedRows = hermesSessionRows(await client.request('session.list', {
    profile: target.profile,
    title,
    include_hidden: true,
    limit: 200,
  }));
  if (storedRows.length !== 1) return false;
  const storedSessionId = String(storedRows[0].resolved_id || storedRows[0].id || '').trim();
  const active = objectRecord(await client.request('session.active_list', {
    profile: target.profile,
  })).sessions;
  const sessions = Array.isArray(active) ? active.map(objectRecord) : [];
  const matches = sessions.filter((item) => (
    String(item.session_key || '').trim() === storedSessionId
  ));
  if (matches.length !== 1) return false;
  const sessionId = String(matches[0].id || '').trim();
  if (!sessionId) return false;
  const interrupted = objectRecord(await client.request('session.interrupt', {
    session_id: sessionId,
    expected_submission_id: expectedRunId,
  }));
  return interrupted.status === 'interrupted';
}

export async function savedCardOwnsLiveSession(
  client: HermesGatewayClient,
  card: AddressableCard,
  owner: { userId: string; projectId: string; deckId: string; conversationId: string },
  liveSessionId: string,
): Promise<boolean> {
  if (!liveSessionId) return false;
  const title = savedCardSessionTitle({ ...owner, cardId: card.card.id });
  const storedRows = hermesSessionRows(await client.request('session.list', {
    profile: card.profile,
    title,
    include_hidden: true,
    limit: 200,
  }));
  if (storedRows.length !== 1) return false;
  const storedSessionId = String(storedRows[0].resolved_id || storedRows[0].id || '').trim();
  if (!storedSessionId) return false;
  const active = objectRecord(await client.request('session.active_list', {
    profile: card.profile,
  })).sessions;
  const sessions = Array.isArray(active) ? active.map(objectRecord) : [];
  return sessions.some((session) => (
    String(session.id || '').trim() === liveSessionId
    && String(session.session_key || '').trim() === storedSessionId
  ));
}
