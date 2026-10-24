/**
 * Entity: Agent Builder
 * Relationship: This file derives Agent Builder rail visibility from enabled saved Card identities while keeping UI availability separate from execution authority.
 * Entity: Saved Cards
 * Relationship: This file reads exact enabled Card identities to decide which optional product surfaces are visible.
 */

import type {
  AgentCardInstance,
  DeckDocument,
} from '../../../types/agentgraph';

function isTradingAgentCard(card: AgentCardInstance | null | undefined): boolean {
  return card?.id === 'card_trading_workbench';
}

export function isWorldSignalsAgentCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return card?.id === 'card_worldsignals_agent';
}

export function isWorldViewCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return card?.runtime.kind === 'hermes' && card.runtime.profile === 'worldview';
}

type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showWorldsignal: boolean;
  showWorldview: boolean;
  showTrading: boolean;
};

function hasEnabledCard(
  nodes: readonly AgentCardInstance[],
  predicate: (card: AgentCardInstance) => boolean,
): boolean {
  return nodes.some((node) => (
    node.enabled !== false
    && predicate(node)
  ));
}

function hasConnectedEnabledCard(
  deck: Pick<DeckDocument, 'nodes' | 'edges'>,
  predicate: (card: AgentCardInstance) => boolean,
): boolean {
  return deck.nodes.some((node) => (
    node.enabled !== false
    && predicate(node)
    && deck.edges.some((edge) => (
      edge.enabled !== false
      && (edge.source === node.id || edge.target === node.id)
    ))
  ));
}

export function deriveVisibleRailItems({
  deck,
  workspaceView,
}: {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
  workspaceView: string;
}): ProgressiveRailVisibility {
  return {
    // Project graphs are an owner-visible workbench, not a card-topology capability.
    showKnowledge: true,
    showWorldsignal:
      workspaceView === 'worldsignal' ||
      hasConnectedEnabledCard(deck, isWorldSignalsAgentCard),
    showWorldview:
      workspaceView === 'worldview' ||
      hasEnabledCard(deck.nodes, isWorldViewCard),
    showTrading:
      workspaceView === 'trading' ||
      hasEnabledCard(deck.nodes, isTradingAgentCard),
  };
}
