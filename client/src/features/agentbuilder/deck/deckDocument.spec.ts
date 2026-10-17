// @vitest-environment node

/**
 * Entity: Agent Builder
 * Relationship: Verifies the client-only Assist quick-add mutation without treating browser fixtures as persisted Project seed authority.
 */

import { describe, expect, it } from 'vitest';

import type { DeckDocument } from '../../../types/agentgraph';
import { buildQuickAddAssistCard } from './deckDocument';
import { PROJECTLESS_DECK } from './newProjectDeck';

function quickAddDeck(): DeckDocument {
  return {
    ...structuredClone(PROJECTLESS_DECK),
    nodes: [
      {
        id: 'card_existing',
        kind: 'agent',
        templateId: 'template_existing',
        runtime: { kind: 'hermes', mode: 'main', profile: 'existing-main' },
        title: 'Existing',
        position: { x: 20, y: 40 },
      },
      {
        id: 'card_recipient',
        kind: 'agent',
        templateId: 'template_recipient',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'recipient' },
        title: 'Recipient',
        position: { x: 340, y: 40 },
      },
    ],
    edges: [
      {
        id: 'edge_existing_recipient',
        source: 'card_existing',
        target: 'card_recipient',
        edgeType: 'flow',
      },
    ],
  };
}

describe('buildQuickAddAssistCard', () => {
  it('creates exactly one new unattached Hermes Card from client-local defaults', () => {
    const deck = quickAddDeck();
    const { nextDeck, nextNode } = buildQuickAddAssistCard(
      deck,
      { kind: 'hermes', mode: 'delegate' },
    );

    expect(nextDeck.nodes).toHaveLength(deck.nodes.length + 1);
    expect(nextNode.runtime).toEqual({
      kind: 'hermes',
      mode: 'delegate',
      profile: expect.stringMatching(/^agent-/),
    });
    expect(nextNode.kind).toBe('agent');
    expect(nextDeck.edges).toEqual(deck.edges);
  });

  it('uses a unique stable Card identity without mutating the input deck', () => {
    const deck = quickAddDeck();
    const before = structuredClone(deck);
    const first = buildQuickAddAssistCard(deck, { kind: 'hermes', mode: 'delegate' });
    const second = buildQuickAddAssistCard(deck, { kind: 'hermes', mode: 'delegate' });

    expect(first.nextNode.id).toMatch(/^card_assist_[a-z0-9]+$/);
    expect(second.nextNode.id).not.toBe(first.nextNode.id);
    expect(second.nextNode.runtime).not.toEqual(first.nextNode.runtime);
    expect(deck).toEqual(before);
  });

  it('carries the explicit Assist template and blank grant collections', () => {
    const { nextNode } = buildQuickAddAssistCard(
      quickAddDeck(),
      { kind: 'hermes', mode: 'delegate' },
    );

    expect(nextNode.templateId).toBe('template_assist');
    expect(nextNode.prompt).toContain('You are Assist, a general-purpose worker.');
    expect(nextNode.runtimeOptions).toMatchObject({
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      subagentType: 'none',
      tools: [],
      skills: [],
      toolsets: [],
      mcpConnectionIds: [],
    });
    expect('status' in nextNode).toBe(false);
  });

  it('preserves existing Cards and topology while incrementing the local version', () => {
    const deck = quickAddDeck();
    const { nextDeck } = buildQuickAddAssistCard(
      deck,
      { kind: 'hermes', mode: 'delegate' },
    );

    expect(nextDeck.nodes.slice(0, deck.nodes.length)).toEqual(deck.nodes);
    expect(nextDeck.edges).toEqual(deck.edges);
    expect(nextDeck.version).toBe(deck.version + 1);
  });

  it('places the new Card to the right of the current rightmost Card', () => {
    const deck = quickAddDeck();
    const rightMost = Math.max(...deck.nodes.map((node) => node.position.x));
    const { nextNode } = buildQuickAddAssistCard(
      deck,
      { kind: 'hermes', mode: 'delegate' },
    );

    expect(nextNode.position.x).toBeGreaterThan(rightMost);
  });

  it('returns only the new document and Card without emitting runtime work', () => {
    const result = buildQuickAddAssistCard(
      quickAddDeck(),
      { kind: 'hermes', mode: 'delegate' },
    );

    expect(Object.keys(result)).toEqual(['nextDeck', 'nextNode']);
  });
});
