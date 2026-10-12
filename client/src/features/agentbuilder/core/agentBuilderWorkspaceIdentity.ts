import { isWorldSignalsAgentCard, isWorldViewCard } from '../rail/railVisibility';
import type { DeckDocument } from '../../../types/agentgraph';

export function deriveAgentBuilderWorkspaceIdentity(deck: DeckDocument) {
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
  const worldViewCard = worldViewOwners.length === 1 ? worldViewOwners[0] : null;
  const tradingCard = deck.nodes.find(
    (card) => card.id === 'card_trading_workbench',
  ) || null;
  return {
    cardTitlesByProfile: Object.fromEntries(titles),
    worldSignalsCardId,
    worldViewCard,
    tradingCard,
  };
}
