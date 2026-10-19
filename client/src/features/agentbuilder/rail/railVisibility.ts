/**
 * Entity: Agent Builder
 * Relationship: This file derives Agent Builder rail visibility from enabled saved Cards and attached surfaces while keeping UI availability separate from execution authority.
 * Entity: Saved Cards
 * Relationship: This file reads exact enabled Card identities and declared subsystem attachments to decide which optional product surfaces are visible.
 */

import type {
  AgentCardInstance,
  DeckDocument,
} from '../../../types/agentgraph';
import { readCardSubsystemAttachments } from '../deck/cardSubsystems';

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
  return readCardSubsystemAttachments(card?.runtimeOptions)
    .some((attachment) => attachment.id === 'gods-eye');
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
      hasEnabledCard(deck.nodes, isWorldSignalsAgentCard),
    showWorldview:
      workspaceView === 'worldview' ||
      hasEnabledCard(deck.nodes, isWorldViewCard),
    showTrading:
      workspaceView === 'trading' ||
      hasEnabledCard(deck.nodes, isTradingAgentCard),
  };
}
