/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Agent Builder
 * Relationship: Verifies optional rail icons follow enabled connections and update on disconnect/reconnect.
 * Entity: Saved Cards
 * Relationship: Preserves stable Card identification and proves KnowGraph alone cannot enable Graphs.
 */
import { describe, expect, it } from 'vitest';
import type { AgentCardInstance, DeckDocument } from '../../../types/agentgraph';
import { deriveVisibleRailItems, isWorldViewCard } from './railVisibility';

const card = (id: string, profile: string): AgentCardInstance => ({
  id, title: profile, role: '', prompt: '', templateId: 'template_assist',
  runtime: { kind: 'hermes', mode: 'delegate', profile }, runtimeOptions: {}, position: { x: 0, y: 0 },
});
const main = card('card_main_chat', 'main');
const worldView = card('generated-worldview-id', 'worldview');
const worldSignals = card('card_worldsignals_agent', 'worldsignals');
const trading = card('card_trading_workbench', 'trading');
const think = card('card_thinkgraph', 'thinkgraph');
const know = card('card_knowgraph', 'knowgraph');
const nodes = [main, worldView, worldSignals, trading, think, know];
const hidden = { showKnowledge: false, showWorldsignal: false, showWorldview: false, showTrading: false };
const wire = (target: string, edgeType: 'flow' | 'magentic_option' = 'flow'): DeckDocument['edges'][number] =>
  ({ id: target, source: main.id, target, edgeType });

describe('product rail visibility', () => {
  it('recognizes WorldView by its stable profile, not its Card id', () => {
    expect(isWorldViewCard(worldView)).toBe(true);
    expect(isWorldViewCard({ ...worldView, id: 'another-id' })).toBe(true);
    expect(isWorldViewCard(worldSignals)).toBe(false);
  });

  it('hides disconnected optional surfaces even while their Cards still exist', () => {
    expect(deriveVisibleRailItems({ deck: { nodes, edges: [] } })).toEqual(hidden);
  });

  it.each(['flow', 'magentic_option'] as const)('accepts an enabled %s wire and reacts to disconnect/reconnect', edgeType => {
    const edges = [worldView, worldSignals, trading, think].map(node => wire(node.id, edgeType));
    const deck = { nodes, edges };
    const shown = { showKnowledge: true, showWorldsignal: true, showWorldview: true, showTrading: true };
    expect(deriveVisibleRailItems({ deck })).toEqual(shown);
    expect(deriveVisibleRailItems({ deck: { ...deck, edges: [] } })).toEqual(hidden);
    expect(deriveVisibleRailItems({ deck })).toEqual(shown);
  });

  it('uses ThinkGraph alone for Graphs, independently of KnowGraph', () => {
    expect(deriveVisibleRailItems({ deck: { nodes, edges: [wire(know.id)] } }).showKnowledge).toBe(false);
    expect(deriveVisibleRailItems({ deck: { nodes, edges: [wire(think.id)] } }).showKnowledge).toBe(true);
  });

  it('ignores disabled Cards, disabled wires, dangling endpoints and self-wires', () => {
    for (const deck of [
      { nodes: nodes.map(node => ({ ...node, enabled: false })), edges: [wire(worldView.id)] },
      { nodes, edges: [{ ...wire(worldView.id), enabled: false }] },
      { nodes, edges: [{ ...wire(worldView.id), edgeType: 'invalid' as const }] },
      { nodes, edges: [{ ...wire(worldView.id), source: 'missing' }] },
      { nodes, edges: [{ ...wire(worldView.id), source: worldView.id }] },
      { nodes: nodes.map(node => node.id === main.id ? { ...node, enabled: false } : node), edges: [wire(worldView.id)] },
    ]) expect(deriveVisibleRailItems({ deck })).toEqual(hidden);
  });

  it('keeps an icon while another valid connection remains, regardless of edge direction', () => {
    expect(deriveVisibleRailItems({ deck: { nodes, edges: [
      { ...wire(worldView.id), enabled: false },
      { id: 'reverse', source: worldView.id, target: main.id, edgeType: 'flow' },
    ] } }).showWorldview).toBe(true);
  });
});
