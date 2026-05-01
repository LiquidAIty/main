import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/worldsignal/WorldSignalSurface', () => ({
  default: () => null,
}));

vi.mock('../components/energy/EnergyFacadeSurface', () => ({
  default: () => null,
}));

import {
  INITIAL_DECK,
  isEnergyWorkbenchActive,
  shouldShowEnergyRailButton,
} from './agentbuilder';

describe('agentbuilder default topology', () => {
  it('places system agents left of the bus and NRGSim/Energy right of the bus', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const bus = byId.get('card_magentic');
    const energy = byId.get('card_energy_workbench');

    expect(bus?.position).toEqual({ x: 140, y: 120 });
    expect(energy?.position).toEqual({ x: 220, y: 140 });
    expect(byId.get('card_knowgraph_agent')?.position).toEqual({ x: -420, y: 140 });
    expect(byId.get('card_research_agent')?.position).toEqual({ x: -280, y: 140 });
    expect(byId.get('card_codegraph_agent')?.position).toEqual({ x: -140, y: 140 });
    expect(byId.get('card_thinkgraph_agent')?.position).toEqual({ x: 0, y: 140 });

    for (const id of [
      'card_thinkgraph_agent',
      'card_codegraph_agent',
      'card_research_agent',
      'card_knowgraph_agent',
    ]) {
      expect(byId.get(id)?.position.x).toBeLessThan(bus!.position.x);
    }

    expect(energy!.position.x).toBeGreaterThan(bus!.position.x);
  });

  it('uses one bus edge and a horizontal system-agent backbone by default', () => {
    const busEdges = INITIAL_DECK.edges.filter(
      (edge) => edge.source === 'card_magentic' || edge.target === 'card_magentic',
    );
    const systemBackboneEdges = INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'flow');
    const expectedBackbone = [
      ['card_knowgraph_agent', 'card_research_agent'],
      ['card_research_agent', 'card_codegraph_agent'],
      ['card_codegraph_agent', 'card_thinkgraph_agent'],
    ];
    const nodeYById = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node.position.y]));

    expect(busEdges).toHaveLength(1);
    expect(busEdges[0]).toMatchObject({
      source: 'card_magentic',
      target: 'card_thinkgraph_agent',
      edgeType: 'magentic_option',
    });
    expect(systemBackboneEdges.map((edge) => [edge.source, edge.target])).toEqual(expectedBackbone);

    for (const [source, target] of expectedBackbone) {
      expect(nodeYById.get(source)).toBe(nodeYById.get(target));
    }
  });

  it('keeps the Energy rail hidden until the workbench is graph-active', () => {
    expect(isEnergyWorkbenchActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(shouldShowEnergyRailButton(INITIAL_DECK, 'canvas')).toBe(false);
    expect(shouldShowEnergyRailButton(INITIAL_DECK, 'energy')).toBe(true);
  });

  it('shows the Energy rail when NRGSim is connected to the bus graph', () => {
    const connectedDeck = {
      ...INITIAL_DECK,
      edges: [
        ...INITIAL_DECK.edges,
        {
          id: 'edge_magentic_energy',
          source: 'card_magentic',
          target: 'card_energy_workbench',
          edgeType: 'magentic_option' as const,
        },
      ],
    };

    expect(isEnergyWorkbenchActive(connectedDeck.nodes, connectedDeck.edges)).toBe(true);
    expect(shouldShowEnergyRailButton(connectedDeck, 'canvas')).toBe(true);
  });
});
