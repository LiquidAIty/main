import { describe, expect, it } from 'vitest';

import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import {
  deriveVisibleRailItems,
  hasDirectedRuntimeBindingConnection,
} from '../features/agentbuilder/rail/railVisibility';

const mainToHermesConnected = (nodes: typeof INITIAL_DECK.nodes, edges: typeof INITIAL_DECK.edges) =>
  hasDirectedRuntimeBindingConnection(nodes, edges, 'main_chat', 'hermes_steward');

describe('Main / Hermes / graph authority topology', () => {
  it('defines no graph-agent card, template, prompt, or runtime binding', () => {
    const serialized = JSON.stringify(INITIAL_DECK);
    expect(serialized).not.toMatch(/thinkgraph_agent|codegraph_agent|knowgraph_agent/);
    expect(INITIAL_DECK.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'card_main_chat',
      'card_hermes_steward',
      'card_magentic',
      'card_local_coder',
    ]));
  });

  it('keeps the graph workspace owner-visible regardless of Hermes topology', () => {
    expect(mainToHermesConnected(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(true);
    expect(deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' }).showKnowledge).toBe(true);
    const disconnected = { ...INITIAL_DECK, edges: INITIAL_DECK.edges.filter((edge) => edge.target !== 'card_hermes_steward') };
    expect(mainToHermesConnected(disconnected.nodes, disconnected.edges)).toBe(false);
    expect(deriveVisibleRailItems({ deck: disconnected, workspaceView: 'chat' }).showKnowledge).toBe(true);
  });

  it('shows the Hermes rail destination only for a typed, connected runtime card', () => {
    const visible = deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' });
    expect(visible.showHermesKanban).toBe(true);

    const withoutHermes = {
      ...INITIAL_DECK,
      nodes: INITIAL_DECK.nodes.filter((node) => node.id !== 'card_hermes_steward'),
    };
    expect(
      deriveVisibleRailItems({ deck: withoutHermes, workspaceView: 'chat' }).showHermesKanban,
    ).toBe(false);
    const disconnected = {
      ...INITIAL_DECK,
      edges: INITIAL_DECK.edges.filter((edge) => edge.id !== 'edge_main_chat_hermes'),
    };
    expect(deriveVisibleRailItems({ deck: disconnected, workspaceView: 'chat' }).showHermesKanban).toBe(false);
    const renamed = {
      ...INITIAL_DECK,
      nodes: INITIAL_DECK.nodes.map((node) =>
        node.id === 'card_hermes_steward' ? { ...node, title: 'Operations' } : node
      ),
    };
    expect(deriveVisibleRailItems({ deck: renamed, workspaceView: 'chat' }).showHermesKanban).toBe(true);
  });

  it('requires the directed Main to Hermes flow edge', () => {
    const withoutHermesFlow = INITIAL_DECK.edges.filter((edge) => edge.id !== 'edge_main_chat_hermes');
    const replacement = (edgeType: string, source = 'card_main_chat', target = 'card_hermes_steward') => ({
      id: `test:${edgeType}:${source}:${target}`,
      source,
      target,
      edgeType,
    });
    expect(mainToHermesConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('flow', 'card_hermes_steward', 'card_main_chat'),
    ] as any)).toBe(false);
    expect(mainToHermesConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('invalid'),
    ] as any)).toBe(false);
  });

  it('defines Main→Hermes invocation and only the intended workers on the blue bus', () => {
    expect(INITIAL_DECK.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_local_coder', target: 'card_magentic', edgeType: 'magentic_option' }),
      expect.objectContaining({ source: 'card_worldsignals_agent', target: 'card_magentic', edgeType: 'magentic_option' }),
    ]));
  });

  it('grants Main and the one real Hermes card progressive graph tools without ordinary web search', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const hermesTools = byId.get('card_hermes_steward')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual(expect.arrayContaining([
      'engraphis.recall',
      'canvas.inspect',
    ]));
    expect(mainTools).not.toContain('web_search');
    expect(hermesTools).toEqual(expect.arrayContaining([
      'graphiti.search_nodes',
      'graphiti.add_memory',
      'graphiti.add_triplet',
    ]));
    expect(hermesTools).not.toContain('agentgraph.inspect');
    expect(hermesTools).not.toEqual(expect.arrayContaining(['web_search', 'run_mag_one']));
    expect(byId.has('card_research_agent')).toBe(false);
    const hermesPrompt = byId.get('card_hermes_steward')?.prompt ?? '';
    expect(hermesPrompt).toContain('saved Hermes steward');
    expect(hermesPrompt).toContain('Kanban is an execution mode on an ordinary card, not your identity');
    expect(hermesPrompt).toContain('Before Magentic-One');
    expect(hermesPrompt).toContain('After Magentic-One');
    expect(byId.get('card_hermes_steward')?.title).toBe('Kanban');
    expect(hermesPrompt).not.toContain('external Hermes agent runtime');
  });

  it('publishes explicit role grants that are filtered before Python MCP startup', () => {
    const cards = INITIAL_DECK.nodes.filter((node) =>
      node.runtimeBinding === 'main_chat' || node.runtimeBinding === 'hermes_steward'
    );
    const granted = [...new Set(cards.flatMap((card) => card.runtimeOptions?.tools ?? []))];
    expect(granted.length).toBeGreaterThan(0);
    expect(granted.every((tool) => typeof tool === 'string' && tool.trim() === tool)).toBe(true);
    expect(granted).not.toContain('web_search');
    expect(INITIAL_DECK.edges).toContainEqual(expect.objectContaining({
      source: 'card_main_chat',
      target: 'card_magentic',
      targetHandle: 'task-bus-top',
      edgeType: 'magentic_control',
    }));
  });
});
