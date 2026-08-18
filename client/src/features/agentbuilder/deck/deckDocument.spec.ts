// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildQuickAddAssistCard } from './deckDocument';
import { INITIAL_DECK } from './newProjectDeck';

describe('buildQuickAddAssistCard (hex-plus add agent)', () => {
  it('creates exactly one new Assistant Agent card', () => {
    const { nextDeck, nextNode } = buildQuickAddAssistCard(INITIAL_DECK);
    expect(nextDeck.nodes.length).toBe(INITIAL_DECK.nodes.length + 1);
    expect(nextNode).toBeDefined();
    expect(nextNode.runtime).toEqual({ kind: 'autogen', mode: 'assistant' });
    expect(nextNode.kind).toBe('agent');
  });

  it('uses a unique stable card id in the canonical schema', () => {
    const { nextNode } = buildQuickAddAssistCard(INITIAL_DECK);
    expect(nextNode.id).toMatch(/^card_assist_[a-z0-9]+$/);
    expect(INITIAL_DECK.nodes.map((n) => n.id)).not.toContain(nextNode.id);
    // two successive calls yield different ids
    const { nextNode: second } = buildQuickAddAssistCard(INITIAL_DECK);
    expect(second.id).not.toBe(nextNode.id);
  });

  it('carries valid template/model defaults (no hardcoded model)', () => {
    const { nextNode } = buildQuickAddAssistCard(INITIAL_DECK);
    expect(nextNode.templateId).toBe('template_assist');
    expect(nextNode.runtimeOptions?.provider).toBeTruthy();
    expect(nextNode.runtimeOptions?.modelKey).toBeTruthy();
    expect(Array.isArray(nextNode.runtimeOptions?.tools)).toBe(true);
    expect(nextNode.runtimeOptions?.skills).toEqual([]);
    expect(nextNode.runtimeOptions?.toolsets).toEqual([]);
    expect(nextNode.runtimeOptions?.mcpConnectionIds).toEqual([]);
    expect(nextNode.status).toBe('ready');
    expect(typeof nextNode.position.x).toBe('number');
    expect(typeof nextNode.position.y).toBe('number');
  });

  it('leaves existing nodes byte-equivalent and marks the deck dirty (version bump)', () => {
    const before = JSON.stringify(INITIAL_DECK.nodes);
    const { nextDeck } = buildQuickAddAssistCard(INITIAL_DECK);
    expect(JSON.stringify(nextDeck.nodes.slice(0, INITIAL_DECK.nodes.length))).toBe(before);
    expect(nextDeck.version).toBe(INITIAL_DECK.version + 1);
  });

  it('does not touch existing edges or create one', () => {
    const before = JSON.stringify(INITIAL_DECK.edges);
    const { nextDeck } = buildQuickAddAssistCard(INITIAL_DECK);
    expect(JSON.stringify(nextDeck.edges)).toBe(before);
    expect(nextDeck.edges).toHaveLength(INITIAL_DECK.edges.length);
  });

  it('places the new card in an open canvas position', () => {
    const { nextNode } = buildQuickAddAssistCard(INITIAL_DECK);
    const rightMost = INITIAL_DECK.nodes.reduce(
      (max, n) => Math.max(max, n.position.x || 0),
      -220,
    );
    expect(nextNode.position.x).toBeGreaterThan(rightMost);
  });

  it('does not emit runtime work or assignments (pure data mutation)', () => {
    // The factory only returns deck + node: no assignments, no runs, no processes.
    const result = buildQuickAddAssistCard(INITIAL_DECK);
    expect(Object.keys(result)).toEqual(['nextDeck', 'nextNode']);
  });
});
