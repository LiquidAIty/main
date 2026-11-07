/**
 * Entity: Card Topology
 * Relationship: Derives each saved orchestrator's exact authorized membership from persisted wires without writing profiles.
 * Entity: Agent Messaging
 * Relationship: Keeps native Bot reachability and Magnetic's blue worker ceiling synchronized with saved orange and blue topology.
 */

import type { DeckDocument } from '../../types/agentgraph';
import {
  hasAgentOrchestratorAuthority,
  wiredBotTargets,
} from '../agentbuilder/deck/deckPrimitives';

export type HermesTopologyPlan = {
  cardId: string;
  profile: string;
  botModeRoster: string[];
};

export function hermesTopologyPlans(deck: DeckDocument): HermesTopologyPlan[] {
  return deck.nodes.flatMap((card): HermesTopologyPlan[] => {
    if (
      card.enabled === false
      || card.runtime.kind !== 'hermes'
      || (!hasAgentOrchestratorAuthority(card) && card.runtime.mode !== 'magentic_one')
    ) return [];
    const targets = wiredBotTargets(deck, card.id);
    const roster = card.runtime.mode === 'magentic_one'
      ? targets.filter((target) => target.edgeType === 'magentic_option')
      : targets;
    return [{
      cardId: card.id,
      profile: card.runtime.profile,
      botModeRoster: [...new Set(roster.map((target) => target.profile))],
    }];
  });
}
