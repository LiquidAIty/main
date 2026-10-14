import { getDeckDocument } from '../decks/deckDomainClient';
import type { DeckCard, DeckDocument } from '../types';

export type AddressableCard = {
  card: DeckCard;
  cardRevisionId: string;
  profile: string;
  title: string;
  address?: string;
  aliases: string[];
};

export type SharedChatAuthority = {
  deck: DeckDocument;
  main: AddressableCard;
  cards: AddressableCard[];
};

export function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function exactStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

function enabledCard(card: DeckCard): boolean {
  return card.enabled !== false && card.runtimeOptions?.enabled !== false;
}

function addressableCard(card: DeckCard): AddressableCard {
  const cardId = String(card.id || '').trim();
  const cardRevisionId = String(card._cardRevisionId || '').trim();
  const profile = String(card.runtime?.profile || '').trim();
  const title = String(card.title || '').trim();
  if (!cardId || !cardRevisionId || !profile || !title || !enabledCard(card)) {
    throw new Error('shared_chat_card_invalid');
  }
  const address = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(title) ? title : undefined;
  return {
    card,
    cardRevisionId,
    profile,
    title,
    ...(address ? { address } : {}),
    aliases: [...new Set([cardId, profile, ...(address ? [address] : [])]
      .map((value) => value.toLowerCase()))],
  };
}

export async function sharedChatAuthority(
  projectId: string,
  deckId: string,
): Promise<SharedChatAuthority> {
  const loaded = await getDeckDocument(projectId, deckId);
  if (!loaded.deck) throw new Error('deck_not_found');
  const cards = loaded.deck.nodes.filter(enabledCard).map(addressableCard);
  const mains = cards.filter(({ card }) => card.runtime.kind === 'hermes' && card.runtime.mode === 'main');
  if (mains.length !== 1) throw new Error('main_card_identity_invalid');
  return { deck: loaded.deck, main: mains[0], cards };
}
