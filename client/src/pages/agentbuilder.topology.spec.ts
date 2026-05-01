import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/worldsignal/WorldSignalSurface', () => ({
  default: () => null,
}));

vi.mock('../components/energy/EnergyFacadeSurface', () => ({
  default: () => null,
}));

import {
  deriveVisibleRailItems,
  INITIAL_DECK,
  isEnergyWorkbenchActive,
  isKnowledgeChainActive,
  isPlanAgentActive,
  isWorldSignalsAgentActive,
  shouldShowEnergyRailButton,
  type ActivationProposalState,
} from './agentbuilder';

function connectToBus(
  deck = INITIAL_DECK,
  target: string,
  id: string,
) {
  return {
    ...deck,
    edges: [
      ...deck.edges,
      {
        id,
        source: 'card_magentic',
        target,
        edgeType: 'magentic_option' as const,
      },
    ],
  };
}

describe('agentbuilder progressive activation startup', () => {
  it('keeps system cards left of the bus and workbench NRGSim right of it', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const bus = byId.get('card_magentic');
    const energy = byId.get('card_energy_workbench');
    const plan = byId.get('card_plan_agent');
    const worldsignals = byId.get('card_worldsignals_agent');

    expect(bus?.position).toEqual({ x: 140, y: 120 });
    expect(energy?.position).toEqual({ x: 220, y: 140 });
    expect(plan?.position).toEqual({ x: -140, y: 20 });
    expect(worldsignals?.position).toEqual({ x: 0, y: 20 });
    expect(byId.get('card_knowgraph_agent')?.position).toEqual({ x: -420, y: 140 });
    expect(byId.get('card_research_agent')?.position).toEqual({ x: -280, y: 140 });
    expect(byId.get('card_codegraph_agent')?.position).toEqual({ x: -140, y: 140 });
    expect(byId.get('card_thinkgraph_agent')?.position).toEqual({ x: 0, y: 140 });
  });

  it('starts with only the horizontal knowledge backbone and no default bus activation edge', () => {
    const busEdges = INITIAL_DECK.edges.filter(
      (edge) => edge.source === 'card_magentic' || edge.target === 'card_magentic',
    );
    const systemBackboneEdges = INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'flow');
    expect(busEdges).toHaveLength(0);
    expect(systemBackboneEdges.map((edge) => [edge.source, edge.target])).toEqual([
      ['card_knowgraph_agent', 'card_research_agent'],
      ['card_research_agent', 'card_codegraph_agent'],
      ['card_codegraph_agent', 'card_thinkgraph_agent'],
    ]);
  });

  it('shows only plus and hamburger in the cold-start baseline', () => {
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'chat',
        pendingActivationProposal: null,
      }),
    ).toEqual({
      showKnowledge: false,
      showPlan: false,
      showWorldsignal: false,
      showEnergy: false,
    });
  });

  it('keeps Energy hidden until NRGSim is connected or open', () => {
    expect(isEnergyWorkbenchActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(shouldShowEnergyRailButton(INITIAL_DECK, 'canvas')).toBe(false);
    expect(shouldShowEnergyRailButton(INITIAL_DECK, 'energy')).toBe(true);
  });

  it('shows Energy when NRGSim is connected to the bus', () => {
    const connectedDeck = connectToBus(
      INITIAL_DECK,
      'card_energy_workbench',
      'edge_magentic_energy',
    );

    expect(isEnergyWorkbenchActive(connectedDeck.nodes, connectedDeck.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: connectedDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showEnergy,
    ).toBe(true);
  });

  it('keeps Knowledge hidden until the system chain is activated from the bus', () => {
    expect(isKnowledgeChainActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showKnowledge,
    ).toBe(false);
  });

  it('shows Knowledge when ThinkGraph activates the connected chain', () => {
    const connectedDeck = connectToBus(
      INITIAL_DECK,
      'card_thinkgraph_agent',
      'edge_magentic_thinkgraph_manual',
    );

    expect(isKnowledgeChainActive(connectedDeck.nodes, connectedDeck.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: connectedDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showKnowledge,
    ).toBe(true);
  });

  it('keeps Plan hidden with no proposal and no bus connection', () => {
    expect(isPlanAgentActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showPlan,
    ).toBe(false);
  });

  it('shows Plan when a pending activation proposal exists', () => {
    const proposal: ActivationProposalState = {
      capability: 'energy',
      title: 'Enable Energy',
      sourceText: 'enable energy',
      status: 'pending',
    };

    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'chat',
        pendingActivationProposal: proposal,
      }).showPlan,
    ).toBe(true);
  });

  it('shows Plan when the plan workspace is open even if no plan card is connected', () => {
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'plan',
        pendingActivationProposal: null,
      }).showPlan,
    ).toBe(true);
  });

  it('shows WorldSignals only when connected or already open', () => {
    expect(isWorldSignalsAgentActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showWorldsignal,
    ).toBe(false);

    const connectedDeck = connectToBus(
      INITIAL_DECK,
      'card_worldsignals_agent',
      'edge_magentic_worldsignals',
    );
    expect(isWorldSignalsAgentActive(connectedDeck.nodes, connectedDeck.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: connectedDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showWorldsignal,
    ).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'worldsignal',
        pendingActivationProposal: null,
      }).showWorldsignal,
    ).toBe(true);
  });
});
