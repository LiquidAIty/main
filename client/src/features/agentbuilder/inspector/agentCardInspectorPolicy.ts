import { readCardSubsystemAttachments } from '../deck/cardSubsystems';
import type { DeckCard } from '../../../types/agentgraph';

export const CARD_CONFIGURATION_TABS = [
  'Prompt',
  'Runtime',
] as const;

export function isTaskLedgerCard(card: DeckCard | null | undefined): boolean {
  return card?.id === 'card_magentic' || card?.id === 'card_team';
}

export function cardInspectorTabs({
  card,
}: {
  card: DeckCard | null | undefined;
}): string[] {
  if (!card) return [];
  return [
    ...CARD_CONFIGURATION_TABS,
    ...(isTaskLedgerCard(card) ? ['Tasks'] : []),
    ...readCardSubsystemAttachments(card.runtimeOptions)
      .filter((attachment) => attachment.cardTab.enabled)
      .map((attachment) => attachment.label),
  ];
}
