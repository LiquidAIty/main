import { readCardSubsystemAttachments } from '../deck/cardSubsystems';
import type { DeckCard } from '../../../types/agentgraph';

export const CARD_CONFIGURATION_TABS = [
  'Prompt',
  'Runtime',
  'Memory',
  'Skills',
  'Tools',
] as const;

export function isTaskLedgerCard(card: DeckCard | null | undefined): boolean {
  return card?.id === 'card_magentic' || card?.id === 'card_team';
}

export function isCardCliEligible({
  card,
  mainCardId,
  builderCardId,
}: {
  card: DeckCard | null | undefined;
  mainCardId: string | null;
  builderCardId: string | null;
}): boolean {
  return Boolean(
    card
    && card.runtime.kind === 'hermes'
    && !isTaskLedgerCard(card)
    && card.id !== mainCardId
    && card.id !== builderCardId,
  );
}

export function cardInspectorTabs({
  card,
  mainCardId,
  builderCardId,
}: {
  card: DeckCard | null | undefined;
  mainCardId: string | null;
  builderCardId: string | null;
}): string[] {
  if (!card) return [];
  return [
    ...CARD_CONFIGURATION_TABS,
    ...(isTaskLedgerCard(card) ? ['Tasks'] : []),
    ...(isCardCliEligible({ card, mainCardId, builderCardId }) ? ['CLI'] : []),
    ...readCardSubsystemAttachments(card.runtimeOptions)
      .filter((attachment) => attachment.cardTab.enabled)
      .map((attachment) => attachment.label),
  ];
}
