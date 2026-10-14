import { describe, expect, it } from 'vitest';

import type { DeckCard } from '../../../types/agentgraph';
import { cardInspectorTabs } from './agentCardInspectorPolicy';

function card(id: string, mode: 'main' | 'delegate' | 'magentic_one'): DeckCard {
  return {
    id,
    title: id,
    runtime: { kind: 'hermes', mode, profile: id },
  } as DeckCard;
}

describe('saved Card CLI visibility', () => {
  it('keeps Main headless and gives every other Hermes Card a CLI', () => {
    expect(cardInspectorTabs({ card: card('card_main_chat', 'main') })).not.toContain('CLI');
    expect(cardInspectorTabs({ card: card('builder', 'delegate') })).toContain('CLI');
    expect(cardInspectorTabs({ card: card('card_knowgraph', 'delegate') })).toContain('CLI');
    expect(cardInspectorTabs({ card: card('card_team', 'delegate') })).toContain('CLI');
    expect(cardInspectorTabs({ card: card('card_magentic', 'magentic_one') })).toContain('CLI');
  });
});
