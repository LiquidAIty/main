// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildQuickAddAssistCard } from './deckDocument';
import { INITIAL_DECK } from './newProjectDeck';

describe('requested initial Card topology', () => {
  it('keeps unique profiles, only Builder/Graph orange targets, and existing Mag One edges', () => {
    const main = INITIAL_DECK.nodes.find(card => card.id === 'card_main_chat')!;
    expect(main.runtimeOptions?.profileDelegationEnabled).toBe(true);
    expect(main.runtimeOptions?.tools).toContain('canvas.inspect');
    expect(INITIAL_DECK.edges.filter(edge => edge.edgeType === 'flow')).toEqual([
      { id: 'edge_main_chat_hermes', source: main.id, target: 'card_hermes_steward', edgeType: 'flow' },
      { id: 'edge_main_chat_agent_builder', source: main.id, target: 'card_agent_builder', edgeType: 'flow' },
    ]);
    expect(INITIAL_DECK.edges.find(edge => edge.edgeType === 'magentic_control')).toMatchObject({
      source: main.id, target: 'card_magentic', targetHandle: 'task-bus-top',
    });
    expect(INITIAL_DECK.edges.filter(edge => edge.edgeType === 'magentic_option').map(edge => edge.id))
      .toEqual(['edge_worldsignals_magentic_bus', 'edge_trading_magentic_bus', 'edge_coder_magentic_option']);
    for (const edge of INITIAL_DECK.edges.filter(edge => edge.edgeType === 'magentic_option')) {
      const busHandle = edge.source === 'card_magentic' ? edge.sourceHandle : edge.targetHandle;
      const cardHandle = edge.source === 'card_magentic' ? edge.targetHandle : edge.sourceHandle;
      expect(busHandle).toMatch(/^bus-(in|out)-\d+$/);
      expect(cardHandle).toBeUndefined();
    }
    const profiles = INITIAL_DECK.nodes.flatMap(card => card.runtime.kind === 'hermes' ? [card.runtime.profile] : []);
    expect(new Set(profiles).size).toBe(profiles.length);
    for (const id of ['card_main_chat', 'card_agent_builder', 'card_hermes_steward']) {
      expect(INITIAL_DECK.nodes.find(card => card.id === id)?.parentGraphId).toBeNull();
    }
  });
});

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

describe('initial Magentic-One account binding', () => {
  it('uses the official ChatGPT account model without changing other Cards', () => {
    const magentic = INITIAL_DECK.nodes.find((node) => node.id === 'card_magentic');
    expect(magentic?.runtime).toEqual({ kind: 'autogen', mode: 'magentic_one' });
    expect(magentic?.runtimeOptions?.provider).toBe('openai');
    expect(magentic?.runtimeOptions?.accessMode).toBe('chatgpt-account');
    expect(magentic?.runtimeOptions?.modelKey).toBe('gpt-5.6-sol');
  });
});
