/**
 * Entity: Saved Cards
 * Relationship: Loads one Project's persisted deck and resolves every enabled Card to its exact revision, profile, display address, and unique Main authority.
 */

import { getDeckDocument } from '../decks/deckDomainClient';
import type { DeckCard, DeckDocument } from '../types';

export type ProjectCardBinding = {
  card: DeckCard;
  cardRevisionId: string;
  profile: string;
  title: string;
  address?: string;
};

export type ProjectCardAuthority = {
  deck: DeckDocument;
  main: ProjectCardBinding;
  cards: ProjectCardBinding[];
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
  return card.enabled !== false;
}

function projectCardBinding(card: DeckCard): ProjectCardBinding {
  const cardId = String(card.id || '').trim();
  const cardRevisionId = String(card._cardRevisionId || '').trim();
  const profile = String(card.runtime?.profile || '').trim();
  const title = String(card.title || '').trim();
  if (!cardId || !cardRevisionId || !profile || !title || !enabledCard(card)) {
    throw new Error('project_card_authority_invalid');
  }
  const address = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(title) ? title : undefined;
  return {
    card,
    cardRevisionId,
    profile,
    title,
    ...(address ? { address } : {}),
  };
}

export async function projectCardAuthority(
  projectId: string,
  deckId: string,
): Promise<ProjectCardAuthority> {
  const loaded = await getDeckDocument(projectId, deckId);
  if (!loaded.deck) throw new Error('deck_not_found');
  const cards = loaded.deck.nodes.filter(enabledCard).map(projectCardBinding);
  const mains = cards.filter(({ card }) => card.runtime.kind === 'hermes' && card.runtime.mode === 'main');
  if (mains.length !== 1) throw new Error('main_card_identity_invalid');
  return { deck: loaded.deck, main: mains[0], cards };
}
