// Entity: Card Topology
// Relationship: Proves saved orange and blue wires project the exact enabled Hermes Bot Mode roster without authorizing visible but unwired Cards.

import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../../../types/agentgraph';
import { wiredBotTargets } from './deckPrimitives';

function card(id: string, mode: 'main' | 'delegate' = 'delegate', enabled = true): AgentCardInstance {
  return {
    id,
    enabled,
    kind: 'agent',
    templateId: id,
    title: id,
    position: { x: 0, y: 0 },
    runtime: { kind: 'hermes', mode, profile: id },
    _cardRevisionId: `${id}-revision`,
  };
}

function deck(): DeckDocument {
  return {
    id: 'builder-deck',
    name: 'Trading',
    version: 1,
    promptTemplates: [],
    nodes: [
      card('main', 'main'), card('builder'), card('knowgraph'),
      card('team'), card('disabled', 'delegate', false), card('unwired'),
    ],
    edges: [
      { id: 'main-builder', source: 'main', target: 'builder', edgeType: 'flow' },
      { id: 'builder-know', source: 'builder', target: 'knowgraph', edgeType: 'flow' },
      { id: 'team-know', source: 'team', target: 'knowgraph', edgeType: 'magentic_option' },
      { id: 'main-disabled', source: 'main', target: 'disabled', edgeType: 'flow' },
      { id: 'invalid', source: 'main', target: 'unwired', edgeType: 'invalid' },
    ],
  };
}

describe('wired Bot targets', () => {
  it('gives Main every enabled Hermes Card participating in the valid Project topology', () => {
    expect(wiredBotTargets(deck(), 'main').map((target) => target.profile).sort())
      .toEqual(['builder', 'knowgraph', 'team']);
  });

  it('gives another orchestrator only its own orange and blue wired peers', () => {
    expect(wiredBotTargets(deck(), 'knowgraph').map((target) => ({
      profile: target.profile,
      edgeType: target.edgeType,
      revision: target.cardRevisionId,
    })).sort((left, right) => left.profile.localeCompare(right.profile))).toEqual([
      { profile: 'builder', edgeType: 'flow', revision: 'builder-revision' },
      { profile: 'team', edgeType: 'magentic_option', revision: 'team-revision' },
    ]);
    expect(wiredBotTargets(deck(), 'unwired')).toEqual([]);
  });
});
