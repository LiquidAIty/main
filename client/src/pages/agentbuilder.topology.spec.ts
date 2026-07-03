// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/worldsignal/WorldSignalSurface', () => ({
  default: () => null,
}));

vi.mock('../components/energy/EnergyFacadeSurface', () => ({
  default: () => null,
}));

vi.mock('../components/dataformulator/DataFormulatorSurface', () => ({
  default: () => null,
}));

import {
  deriveConnectedGraphStreams,
  deriveVisibleRailItems,
  getConnectedKnowledgeGraphKinds,
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

const ADMIN_STAGE0_DECK = {
  ...INITIAL_DECK,
  nodes: [
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_magentic')!,
      position: { x: 140, y: 120 },
      subtitle: 'Admin orchestrator / planner',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_thinkgraph_agent')!,
      position: { x: -24, y: 96 },
      subtitle: 'Provisional / planning memory (AGE)',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_research_agent')!,
      position: { x: -240, y: 120 },
      subtitle: 'Research and analysis worker',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_knowgraph_agent')!,
      position: { x: -360, y: 288 },
      subtitle: 'Grounded / evidence-backed memory (Neo4j)',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_plan_agent')!,
      position: { x: -96, y: 360 },
      subtitle: 'Approval and planning surface',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_worldsignals_agent')!,
      position: { x: -72, y: 240 },
      subtitle: 'Outside-world context surface',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_trading_workbench')!,
      position: { x: 288, y: 240 },
      subtitle: 'Market workspace',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_local_coder')!,
      position: { x: -48, y: 504 },
      subtitle: 'Controlled code patch/test execution',
    },
    {
      ...INITIAL_DECK.nodes.find((node) => node.id === 'card_codegraph_agent')!,
      position: { x: -48, y: 600 },
      subtitle: 'Structural code memory',
    },
  ],
  edges: [
    {
      id: 'edge_plan_magentic',
      source: 'card_plan_agent',
      target: 'card_magentic',
      edgeType: 'magentic_option' as const,
    },
    {
      id: 'edge_knowgraph_research',
      source: 'card_knowgraph_agent',
      target: 'card_research_agent',
      edgeType: 'flow' as const,
    },
    {
      id: 'edge_research_thinkgraph',
      source: 'card_research_agent',
      target: 'card_thinkgraph_agent',
      edgeType: 'flow' as const,
    },
    {
      id: 'edge_thinkgraph_magentic',
      source: 'card_thinkgraph_agent',
      target: 'card_magentic',
      edgeType: 'magentic_option' as const,
    },
  ],
};

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
  it('keeps the Stage 0 research cluster active and future helpers parked on the board', () => {
    const byId = new Map(ADMIN_STAGE0_DECK.nodes.map((node) => [node.id, node]));
    const bus = byId.get('card_magentic');
    const trading = byId.get('card_trading_workbench');
    const localCoder = byId.get('card_local_coder');
    const codegraph = byId.get('card_codegraph_agent');
    const plan = byId.get('card_plan_agent');
    const worldsignals = byId.get('card_worldsignals_agent');

    expect(bus?.position).toEqual({ x: 140, y: 120 });
    expect(byId.get('card_thinkgraph_agent')?.position).toEqual({ x: -24, y: 96 });
    expect(byId.get('card_research_agent')?.position).toEqual({ x: -240, y: 120 });
    expect(byId.get('card_knowgraph_agent')?.position).toEqual({ x: -360, y: 288 });
    expect(plan?.position).toEqual({ x: -96, y: 360 });
    expect(worldsignals?.position).toEqual({ x: -72, y: 240 });
    expect(trading?.position).toEqual({ x: 288, y: 240 });
    expect(localCoder?.position).toEqual({ x: -48, y: 504 });
    expect(codegraph?.position).toEqual({ x: -48, y: 600 });
  });

  it('starts with the current Stage 0 research chain and parked future helpers disconnected', () => {
    const busEdges = ADMIN_STAGE0_DECK.edges.filter(
      (edge) => edge.source === 'card_magentic' || edge.target === 'card_magentic',
    );
    const systemBackboneEdges = ADMIN_STAGE0_DECK.edges.filter((edge) => edge.edgeType === 'flow');
    expect(busEdges.map((edge) => [edge.source, edge.target, edge.edgeType])).toEqual([
      ['card_plan_agent', 'card_magentic', 'magentic_option'],
      ['card_thinkgraph_agent', 'card_magentic', 'magentic_option'],
    ]);
    expect(systemBackboneEdges.map((edge) => [edge.source, edge.target])).toEqual([
      ['card_knowgraph_agent', 'card_research_agent'],
      ['card_research_agent', 'card_thinkgraph_agent'],
    ]);
    expect(
      ADMIN_STAGE0_DECK.edges.filter(
        (edge) =>
          ['card_local_coder', 'card_codegraph_agent', 'card_trading_workbench', 'card_worldsignals_agent'].includes(edge.source) ||
          ['card_local_coder', 'card_codegraph_agent', 'card_trading_workbench', 'card_worldsignals_agent'].includes(edge.target),
      ),
    ).toEqual([]);
  });

  it('shows Knowledge for the current Stage 0 ADMIN graph activation and keeps unrelated rails hidden', () => {
    const visibility = deriveVisibleRailItems({
      deck: ADMIN_STAGE0_DECK,
      workspaceView: 'chat',
      pendingActivationProposal: null,
    });
    expect(visibility.showKnowledge).toBe(true);
    expect(visibility.showPlan).toBe(true);
    expect(visibility.showWorldsignal).toBe(false);
    expect(visibility.showEnergy).toBe(false);
    expect(visibility.showTrading).toBe(false);
    expect(visibility.showImage).toBe(false);
    expect(visibility.showCode).toBe(false);
    expect(visibility.showVideo).toBe(false);
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

  it('shows Knowledge from the current Stage 0 research connection', () => {
    expect(isKnowledgeChainActive(ADMIN_STAGE0_DECK.nodes, ADMIN_STAGE0_DECK.edges)).toBe(true);
    expect(
      deriveVisibleRailItems({
        deck: ADMIN_STAGE0_DECK,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showKnowledge,
    ).toBe(true);
  });

  it('keeps the graph rail visible when ThinkGraph and KnowGraph stay connected but CodeGraph is parked', () => {
    const parkedDeck = {
      ...ADMIN_STAGE0_DECK,
      nodes: ADMIN_STAGE0_DECK.nodes.filter((node) => node.id !== 'card_codegraph_agent'),
      edges: ADMIN_STAGE0_DECK.edges.filter(
        (edge) =>
          edge.source !== 'card_codegraph_agent' &&
          edge.target !== 'card_codegraph_agent',
      ),
    };

    expect(deriveConnectedGraphStreams(parkedDeck)).toEqual({
      thinkGraph: true,
      knowGraph: true,
      codeGraph: false,
      anyGraph: true,
    });
    expect(
      deriveVisibleRailItems({
        deck: parkedDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showKnowledge,
    ).toBe(true);
    expect(getConnectedKnowledgeGraphKinds(deriveConnectedGraphStreams(parkedDeck))).toEqual([
      'thinkgraph',
      'knowgraph',
    ]);
  });

  it('shows the graph rail when only CodeGraph is connected', () => {
    const codeOnlyDeck = {
      ...INITIAL_DECK,
      nodes: INITIAL_DECK.nodes.filter(
        (node) =>
          node.id === 'card_magentic' || node.id === 'card_codegraph_agent',
      ),
      edges: [
        {
          id: 'edge_magentic_codegraph',
          source: 'card_magentic',
          target: 'card_codegraph_agent',
          edgeType: 'magentic_option' as const,
        },
      ],
    };

    expect(deriveConnectedGraphStreams(codeOnlyDeck)).toEqual({
      thinkGraph: false,
      knowGraph: false,
      codeGraph: true,
      anyGraph: true,
    });
    expect(
      deriveVisibleRailItems({
        deck: codeOnlyDeck,
        workspaceView: 'canvas',
        pendingActivationProposal: null,
      }).showKnowledge,
    ).toBe(true);
    expect(getConnectedKnowledgeGraphKinds(deriveConnectedGraphStreams(codeOnlyDeck))).toEqual([
      'codegraph',
    ]);
  });

  it('hides the graph rail when no graph-capable agents are connected', () => {
    const noGraphDeck = {
      ...INITIAL_DECK,
      nodes: INITIAL_DECK.nodes.filter(
        (node) =>
          ![
            'card_thinkgraph_agent',
            'card_knowgraph_agent',
            'card_codegraph_agent',
          ].includes(node.id),
      ),
      edges: INITIAL_DECK.edges.filter(
        (edge) =>
          ![
            'card_thinkgraph_agent',
            'card_knowgraph_agent',
            'card_codegraph_agent',
          ].includes(edge.source) &&
          ![
            'card_thinkgraph_agent',
            'card_knowgraph_agent',
            'card_codegraph_agent',
          ].includes(edge.target),
      ),
    };

    expect(deriveConnectedGraphStreams(noGraphDeck)).toEqual({
      thinkGraph: false,
      knowGraph: false,
      codeGraph: false,
      anyGraph: false,
    });
    expect(
      deriveVisibleRailItems({
        deck: noGraphDeck,
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
