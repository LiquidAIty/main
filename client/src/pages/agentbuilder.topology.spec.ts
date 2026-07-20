import { describe, expect, it } from 'vitest';

import { INITIAL_DECK } from '../features/agentbuilder/deck/deckSeed';
import { deriveVisibleRailItems } from '../features/agentbuilder/rail/railVisibility';

describe('current Agent Canvas topology', () => {
  it('seeds no graph-agent or pretend planner card', () => {
    const identities = INITIAL_DECK.nodes.map((node) => ({
      id: node.id,
      binding: node.runtimeBinding,
      templateId: node.templateId,
    }));
    expect(JSON.stringify(identities)).not.toMatch(
      /thinkgraph_agent|codegraph_agent|knowgraph_agent|hermes|steward/,
    );
    expect(INITIAL_DECK.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'card_main_chat',
        'card_research_agent',
        'card_magentic',
        'card_local_coder',
      ]),
    );
  });

  it('keeps the graph workspace owner-visible without special agent topology', () => {
    expect(
      deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' }).showKnowledge,
    ).toBe(true);
  });

  it('keeps real workers on Mag One option edges while Main has no execution edge', () => {
    expect(INITIAL_DECK.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'card_research_agent',
          target: 'card_magentic',
          edgeType: 'magentic_option',
        }),
        expect.objectContaining({
          source: 'card_local_coder',
          target: 'card_magentic',
          edgeType: 'magentic_option',
        }),
      ]),
    );
    expect(
      INITIAL_DECK.edges.some(
        (edge) =>
          edge.source === 'card_main_chat' &&
          edge.target === 'card_magentic' &&
          edge.edgeType === 'magentic_control',
      ),
    ).toBe(false);
  });

  it('grants Main graph access and direct Coder delegation, but no orchestration launch', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const searchTools = byId.get('card_research_agent')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual(
      expect.arrayContaining([
        'thinkgraph.get_graph_slice',
        'thinkgraph.submit_update',
        'knowgraph.query',
        'codegraph.search',
        'run_coder_subagent',
      ]),
    );
    expect(mainTools).not.toEqual(
      expect.arrayContaining(['knowgraph.ingest', 'web_search', 'run_mag_one']),
    );
    expect(searchTools).toEqual(['web_search']);
  });
});
