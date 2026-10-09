import { BUILDER_CARD_ID } from '../deck/newProjectDeck';
import { projectCardChatTargets } from '../console/sharedChatClient';
import { isWorldSignalsAgentCard, isWorldViewCard } from '../rail/railVisibility';
import type { DeckDocument } from '../../../types/agentgraph';

export function deriveAgentBuilderWorkspaceIdentity(deck: DeckDocument) {
  const mainCardId = deck.nodes.find((card) => (
    card.runtime.kind === 'hermes' && card.runtime.mode === 'main'
  ))?.id || null;
  const directChatTargets = projectCardChatTargets(deck.nodes);
  const builderCard = deck.nodes.find((card) => (
    card.runtime.kind === 'hermes' && card.id === BUILDER_CARD_ID
  )) || null;
  const titles = new Map<string, string>();
  const ambiguousProfiles = new Set<string>();
  for (const card of deck.nodes) {
    const profile = String(card.runtime.profile || '').trim();
    const title = String(card.title || '').trim();
    if (!profile || !title) continue;
    const previous = titles.get(profile);
    if (previous && previous !== title) ambiguousProfiles.add(profile);
    else titles.set(profile, title);
  }
  for (const profile of ambiguousProfiles) titles.delete(profile);
  const worldSignalsCardId = deck.nodes.find(isWorldSignalsAgentCard)?.id ?? null;
  const worldViewOwners = deck.nodes.filter(isWorldViewCard);
  const worldViewCard = worldViewOwners.length === 1
    && directChatTargets.some((target) => target.cardId === worldViewOwners[0].id)
    ? worldViewOwners[0]
    : null;
  const tradingCard = deck.nodes.find(
    (card) => card.id === 'card_trading_workbench',
  ) || null;
  return {
    mainCardId,
    directChatTargets,
    builderCard,
    cardTitlesByProfile: Object.fromEntries(titles),
    worldSignalsCardId,
    worldViewCard,
    tradingCard,
  };
}
