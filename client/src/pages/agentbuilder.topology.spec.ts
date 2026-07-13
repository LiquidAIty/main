import { describe, expect, it } from 'vitest';

import { INITIAL_DECK } from '../features/agentbuilder/deck/deckSeed';
import {
  deriveVisibleRailItems,
  isHermesConnectedToMainChat,
} from '../features/agentbuilder/rail/railVisibility';

describe('Main / Hermes / graph authority topology', () => {
  it('seeds no graph-agent card, template, prompt, or runtime binding', () => {
    const serialized = JSON.stringify(INITIAL_DECK);
    expect(serialized).not.toMatch(/thinkgraph_agent|codegraph_agent|knowgraph_agent/);
    expect(INITIAL_DECK.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'card_main_chat',
      'card_hermes_steward',
      'card_research_agent',
      'card_magentic',
      'card_local_coder',
    ]));
  });

  it('uses the directed Main to Hermes orange edge as graph-workspace availability', () => {
    expect(isHermesConnectedToMainChat(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(true);
    expect(deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' }).showKnowledge).toBe(true);
    const disconnected = { ...INITIAL_DECK, edges: INITIAL_DECK.edges.filter((edge) => edge.target !== 'card_hermes_steward') };
    expect(isHermesConnectedToMainChat(disconnected.nodes, disconnected.edges)).toBe(false);
    expect(deriveVisibleRailItems({ deck: disconnected, workspaceView: 'chat' }).showKnowledge).toBe(false);
  });

  it('seeds Hermes to Search as orange direct-agent flow and keeps workers blue', () => {
    expect(INITIAL_DECK.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_hermes_steward', target: 'card_research_agent', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_research_agent', target: 'card_magentic', edgeType: 'magentic_option' }),
      expect.objectContaining({ source: 'card_local_coder', target: 'card_magentic', edgeType: 'magentic_option' }),
    ]));
  });

  it('grants Main ThinkGraph write authority, Hermes investigation tools, and Search web only', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const hermesTools = byId.get('card_hermes_steward')?.runtimeOptions?.tools ?? [];
    const searchTools = byId.get('card_research_agent')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual(expect.arrayContaining(['thinkgraph.get_graph_slice', 'thinkgraph.submit_update', 'knowgraph.query', 'codegraph.search']));
    expect(mainTools).not.toEqual(expect.arrayContaining(['knowgraph.ingest', 'web_search']));
    expect(hermesTools).toEqual(expect.arrayContaining(['thinkgraph.get_graph_slice', 'knowgraph.ingest', 'card.run_assistant_agent']));
    expect(hermesTools).not.toEqual(expect.arrayContaining(['thinkgraph.submit_update', 'web_search', 'run_mag_one', 'run_coder_subagent']));
    expect(searchTools).toEqual(['web_search']);
  });
});
