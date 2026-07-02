// Focused persisted-card resolution coverage: the ThinkGraph card is identified
// STRUCTURALLY from persisted deck nodes via the existing runtimeBinding
// classification — never display-name matching, never a browser-supplied id.
import { describe, expect, it } from 'vitest';

import { resolveThinkGraphCardFromDeck } from './thinkGraphFrontDoor';

const TG_CARD = {
  id: 'card_thinkgraph_agent',
  kind: 'agent',
  title: 'Anything At All', // display text must be irrelevant
  runtimeBinding: 'thinkgraph_agent',
  runtimeType: 'assistant_agent',
  runtimeOptions: { modelKey: 'openai/gpt-5.1-chat', tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'] },
};

const OTHER_CARD = {
  id: 'card_research',
  kind: 'agent',
  title: 'ThinkGraph Agent', // deceptive display name — must NOT match
  runtimeBinding: 'research_agent',
  runtimeType: 'assistant_agent',
};

describe('resolveThinkGraphCardFromDeck — structural, persisted, never by name', () => {
  it('resolves exactly one card by persisted runtimeBinding', () => {
    const res = resolveThinkGraphCardFromDeck([OTHER_CARD, TG_CARD]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.card.id).toBe('card_thinkgraph_agent');
  });

  it('a deceptive display name never matches (no display-name matching path exists)', () => {
    const res = resolveThinkGraphCardFromDeck([OTHER_CARD]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('thinkgraph_card_not_found');
  });

  it('zero matches → honest not-found', () => {
    const res = resolveThinkGraphCardFromDeck([]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('thinkgraph_card_not_found');
  });

  it('multiple matches → honest ambiguity (no silent pick)', () => {
    const res = resolveThinkGraphCardFromDeck([TG_CARD, { ...TG_CARD, id: 'card_tg_2' }]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('thinkgraph_card_ambiguous');
      expect(res.error).toContain('card_thinkgraph_agent');
      expect(res.error).toContain('card_tg_2');
    }
  });

  it('runtimeOptions.binding variant is honored (same persisted mechanism)', () => {
    const viaOptions = {
      id: 'card_tg_opt',
      kind: 'agent',
      runtimeOptions: { binding: 'thinkgraph_agent' },
    };
    const res = resolveThinkGraphCardFromDeck([viaOptions]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.card.id).toBe('card_tg_opt');
  });
});
