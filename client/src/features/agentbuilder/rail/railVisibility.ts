// Rail/topology derivation: which product surfaces are visible for the
// current deck through bus connectivity and the active workspace.
import type {
  DeckCard,
  DeckDocument,
  DeckEdge,
} from '../../../types/agentgraph';
import {
  normalizeDeckEdgeType,
} from '../deck/deckPrimitives';
import { readCardSubsystemAttachments } from '../deck/cardSubsystems';

function isTradingAgentCard(card: DeckCard | null | undefined): boolean {
  return card?.id === 'card_trading_workbench';
}

export function isWorldSignalsAgentCard(
  card: DeckCard | null | undefined,
): boolean {
  return card?.id === 'card_worldsignals_agent';
}

export function isWorldViewCard(
  card: DeckCard | null | undefined,
): boolean {
  return readCardSubsystemAttachments(card?.runtimeOptions)
    .some((attachment) => attachment.id === 'gods-eye');
}

export type AgentBuilderRailVisibility = {
  showKnowledge: boolean;
  showWorldSignals: boolean;
  showWorldView: boolean;
  showTrading: boolean;
};

function buildBusConnectedCardIds(
  nodes: readonly DeckCard[],
  edges: readonly DeckEdge[],
): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const busIds = nodes
    .filter((node) => node.runtime.kind === 'hermes' && node.runtime.mode === 'magentic_one')
    .map((node) => node.id);
  if (busIds.length === 0) return new Set<string>();

  const adjacency = new Map<string, string[]>();
  const connect = (left: string, right: string) => {
    const neighbors = adjacency.get(left) || [];
    neighbors.push(right);
    adjacency.set(left, neighbors);
  };

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    if (edgeType !== 'magentic_option' && edgeType !== 'flow') continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }

  const connected = new Set<string>();
  const queue = [...busIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (connected.has(current)) continue;
    connected.add(current);
    for (const neighbor of adjacency.get(current) || []) {
      if (!connected.has(neighbor)) queue.push(neighbor);
    }
  }

  return connected;
}

/** A card's surface is reachable when the card is bus-connected — bus
 * connectivity is the only activation signal (PLAN.md §4). */
function isBusConnectedCard(
  nodes: readonly DeckCard[],
  edges: readonly DeckEdge[],
  predicate: (card: DeckCard) => boolean,
): boolean {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return nodes.some((node) => busConnected.has(node.id) && predicate(node));
}

export function deriveVisibleRailItems({
  deck,
  workspaceView,
}: {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
  workspaceView: string;
}): AgentBuilderRailVisibility {
  return {
    // Project graphs are an owner-visible workbench, not a card-topology capability.
    showKnowledge: true,
    showWorldSignals:
      workspaceView === 'worldsignals' ||
      isBusConnectedCard(deck.nodes, deck.edges, isWorldSignalsAgentCard),
    showWorldView:
      workspaceView === 'worldview' ||
      isBusConnectedCard(deck.nodes, deck.edges, isWorldViewCard),
    showTrading:
      workspaceView === 'trading' ||
      isBusConnectedCard(deck.nodes, deck.edges, isTradingAgentCard),
  };
}
