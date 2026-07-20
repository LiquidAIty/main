// Rail/topology derivation: which product surfaces are visible for the
// current deck (bus connectivity, graph streams, workbench activation).
// Extracted verbatim from pages/agentbuilder.tsx (decomposition pass
// 2026-07-08). Behavior unchanged.
import type {
  AgentCardInstance,
  DeckDocument,
  DeckEdge,
} from '../../../types/agentgraph';
import { shouldShowOpenClaudeConsoleRail } from '../console/consoleVisibility';
import {
  normalizeDeckEdgeType,
  normalizeRuntimeBinding,
  normalizeRuntimeType,
  safeText,
} from '../deck/deckPrimitives';

// Card identity comes from the SAVED runtime binding — never an id/template/
// title string match. A user who renames a card, or a deck that seeds a second
// one, keeps working; the old matchers silently didn't.
function hasRuntimeBinding(
  card: AgentCardInstance | null | undefined,
  binding: 'trading_agent' | 'worldsignals_agent',
): boolean {
  return Boolean(card && normalizeRuntimeBinding(card.runtimeBinding) === binding);
}

export function isTradingAgentCard(card: AgentCardInstance | null | undefined): boolean {
  return hasRuntimeBinding(card, 'trading_agent');
}

export function isWorldSignalsAgentCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return hasRuntimeBinding(card, 'worldsignals_agent');
}

export type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showWorldsignal: boolean;
  showTrading: boolean;
  showOpenClaudeConsole: boolean;
};

export function buildBusConnectedCardIds(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const busIds = nodes
    .filter((node) => normalizeRuntimeType(node.runtimeType) === 'magentic_one')
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

export function isHermesConnectedToMainChat(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  const mainChatIds = new Set(
    nodes
      .filter((node) => safeText(node.runtimeBinding).trim().toLowerCase() === 'main_chat')
      .map((node) => node.id),
  );
  const hermesIds = new Set(
    nodes
      .filter((node) => safeText(node.runtimeBinding).trim().toLowerCase() === 'hermes_steward')
      .map((node) => node.id),
  );
  if (mainChatIds.size === 0 || hermesIds.size === 0) return false;
  return edges.some(
    (edge) => {
      const type = normalizeDeckEdgeType(edge.edgeType);
      if (type !== 'flow' && type !== 'hermes_observe') return false;
      return (mainChatIds.has(edge.source) && hermesIds.has(edge.target)) ||
        (hermesIds.has(edge.source) && mainChatIds.has(edge.target));
    },
  );
}

/** A card's surface is reachable when the card is bus-connected — bus
 * connectivity is the only activation signal (PLAN.md §4). */
function isBusConnectedCard(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
  predicate: (card: AgentCardInstance) => boolean,
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
}): ProgressiveRailVisibility {
  const hermesConnectedToMainChat = isHermesConnectedToMainChat(deck.nodes, deck.edges);
  return {
    // Graphs are Hermes's canvas. The launcher is present only while Hermes is
    // actually connected to Main Chat; graph data may still be empty/unseeded.
    showKnowledge: hermesConnectedToMainChat,
    showWorldsignal:
      workspaceView === 'worldsignal' ||
      isBusConnectedCard(deck.nodes, deck.edges, isWorldSignalsAgentCard),
    showTrading:
      workspaceView === 'trading' ||
      isBusConnectedCard(deck.nodes, deck.edges, isTradingAgentCard),
    showOpenClaudeConsole: shouldShowOpenClaudeConsoleRail({
      cards: deck.nodes,
      edges: deck.edges,
    }),
  };
}

// The old "activation proposal" system (a deterministic keyword classifier
// over user text) was dead plumbing: its detector had zero callers, its state
// was only ever reset to null, and deriveVisibleRailItems ignored it. Removed
// whole — banned pattern (regex intent-routing) with zero live function.
