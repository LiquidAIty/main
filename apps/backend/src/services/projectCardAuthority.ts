/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Saved Cards
 * Relationship: This file loads one Project's persisted deck and resolves every enabled Card to its exact saved revision, profile, title, and address.
 * Entity: Main Chat
 * Relationship: This file requires exactly one enabled Main Card and exposes that saved identity as the Project's chat authority.
 * Entity: Card Profiles
 * Relationship: This file binds each enabled saved Card to its exact stable profile without deriving a second runtime identity.
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
  projectId: string;
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

function validCardAddress(value: string): boolean {
  if (!value || value.length > 64) return false;
  return [...value].every((character, index) => {
    const lower = character.toLowerCase();
    const letter = lower >= 'a' && lower <= 'z';
    const digit = character >= '0' && character <= '9';
    return index === 0 ? letter || digit : letter || digit || character === '_' || character === '-';
  });
}

function projectCardBinding(card: DeckCard): ProjectCardBinding {
  const cardId = String(card.id || '').trim();
  const cardRevisionId = String(card._cardRevisionId || '').trim();
  const profile = String(card.runtime?.profile || '').trim();
  const title = String(card.title || '').trim();
  if (!cardId || !cardRevisionId || !profile || !title || !enabledCard(card)) {
    throw new Error('project_card_authority_invalid');
  }
  const address = validCardAddress(title) ? title : undefined;
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
  const mains = cards.filter(({ card }) => (
    card.runtime.kind === 'hermes' && card.runtime.mode === 'main'
  ));
  if (mains.length !== 1) throw new Error('main_card_identity_invalid');
  return { projectId, deck: loaded.deck, main: mains[0], cards };
}
