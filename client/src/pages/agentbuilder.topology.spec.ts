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
  isCodeWorkbenchActive,
  isEnergyWorkbenchActive,
  isImageWorkbenchActive,
  isKnowledgeChainActive,
  isPlanAgentActive,
  isTradingWorkbenchActive,
  isVideoWorkbenchActive,
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
  it('keeps system cards left of the bus and demo workbenches on the visible right side', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const bus = byId.get('card_magentic');
    const energy = byId.get('card_energy_workbench');
    const trading = byId.get('card_trading_workbench');
    const image = byId.get('card_image_workbench');
    const code = byId.get('card_code_workbench');
    const video = byId.get('card_video_workbench');
    const assist = byId.get('card_assist');
    const localCoder = byId.get('card_local_coder');
    const telescope = byId.get('card_telescope_agent');
    const plan = byId.get('card_plan_agent');
    const worldsignals = byId.get('card_worldsignals_agent');

    expect(bus?.position).toEqual({ x: 140, y: 120 });
    expect(assist?.position).toEqual({ x: 320, y: -40 });
    expect(energy?.position).toEqual({ x: 260, y: 140 });
    expect(trading?.position).toEqual({ x: 520, y: 140 });
    expect(image?.position).toEqual({ x: 780, y: 140 });
    expect(code?.position).toEqual({ x: 1040, y: 140 });
    expect(video?.position).toEqual({ x: 780, y: 320 });
    expect(localCoder?.position).toEqual({ x: 520, y: 320 });
    expect(telescope?.position).toEqual({ x: 1040, y: 320 });
    expect(plan?.position).toEqual({ x: 0, y: 380 });
    expect(worldsignals?.position).toEqual({ x: 0, y: 260 });
    expect(byId.get('card_knowgraph_agent')?.position).toEqual({ x: -510, y: 140 });
    expect(byId.get('card_research_agent')?.position).toEqual({ x: -340, y: 140 });
    expect(byId.get('card_codegraph_agent')?.position).toEqual({ x: -170, y: 140 });
    expect(byId.get('card_thinkgraph_agent')?.position).toEqual({ x: 0, y: 140 });
  });

  it('starts with first-demo Magentic-One heads and the horizontal knowledge backbone', () => {
    const busEdges = INITIAL_DECK.edges.filter(
      (edge) => edge.source === 'card_magentic' || edge.target === 'card_magentic',
    );
    const systemBackboneEdges = INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'flow');
    expect(busEdges.map((edge) => [edge.source, edge.target, edge.edgeType])).toEqual([
      ['card_magentic', 'card_research_agent', 'magentic_option'],
      ['card_magentic', 'card_assist', 'magentic_option'],
    ]);
    expect(systemBackboneEdges.map((edge) => [edge.source, edge.target])).toEqual([
      ['card_knowgraph_agent', 'card_research_agent'],
      ['card_research_agent', 'card_codegraph_agent'],
      ['card_codegraph_agent', 'card_thinkgraph_agent'],
    ]);
  });

  it('shows Knowledge for the first-demo Research activation and keeps other rails hidden', () => {
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'chat',
        pendingActivationProposal: null,
      }),
    ).toEqual({
      showKnowledge: true,
      showPlan: false,
      showWorldsignal: false,
      showEnergy: false,
      showTrading: false,
      showImage: false,
      showCode: false,
      showVideo: false,
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

  it('keeps Trading hidden until the Trading Agent is connected or open', () => {
    expect(isTradingWorkbenchActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showTrading,
    ).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'trading',
        pendingActivationProposal: null,
      }).showTrading,
    ).toBe(true);
  });

  it('shows Trading when the Trading Agent is connected to the bus', () => {
    const connectedDeck = connectToBus(
      INITIAL_DECK,
      'card_trading_workbench',
      'edge_magentic_trading',
    );
    expect(isTradingWorkbenchActive(connectedDeck.nodes, connectedDeck.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: connectedDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showTrading,
    ).toBe(true);
  });

  it('keeps Image hidden until the Image Maker Agent is connected or open', () => {
    expect(isImageWorkbenchActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showImage,
    ).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'image',
        pendingActivationProposal: null,
      }).showImage,
    ).toBe(true);
  });

  it('shows Image when the Image Maker Agent is connected to the bus', () => {
    const connectedDeck = connectToBus(
      INITIAL_DECK,
      'card_image_workbench',
      'edge_magentic_image',
    );
    expect(isImageWorkbenchActive(connectedDeck.nodes, connectedDeck.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: connectedDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showImage,
    ).toBe(true);
  });

  it('keeps Code hidden until the Code Agent is connected or open', () => {
    expect(isCodeWorkbenchActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showCode,
    ).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'code',
        pendingActivationProposal: null,
      }).showCode,
    ).toBe(true);
  });

  it('shows Code when the Code Agent is connected to the bus', () => {
    const connectedDeck = connectToBus(
      INITIAL_DECK,
      'card_code_workbench',
      'edge_magentic_code',
    );
    expect(isCodeWorkbenchActive(connectedDeck.nodes, connectedDeck.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: connectedDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showCode,
    ).toBe(true);
  });

  it('keeps Video hidden until the Video Agent is connected or open', () => {
    expect(isVideoWorkbenchActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showVideo,
    ).toBe(false);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'video',
        pendingActivationProposal: null,
      }).showVideo,
    ).toBe(true);
  });

  it('shows Knowledge from the default first-demo Research connection', () => {
    expect(isKnowledgeChainActive(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: INITIAL_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showKnowledge,
    ).toBe(true);
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
