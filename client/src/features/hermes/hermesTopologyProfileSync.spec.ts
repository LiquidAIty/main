// Entity: Card Topology
// Relationship: Verifies persisted orange and blue wires produce exact native Bot rosters and Magnetic worker membership before profile publication.

import { describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ configure: vi.fn() }));
vi.mock('./hermesProfileClient', () => ({
  configureHermesProfile: profile.configure,
}));

import { hermesTopologyPlans, synchronizeHermesTopologyProfiles } from './hermesTopologyProfileSync';
import type { DeckDocument } from '../../types/agentgraph';

function deck(): DeckDocument {
  const card = (id: string, mode: 'main' | 'delegate' | 'magentic_one', profileName: string) => ({
    id,
    kind: 'agent' as const,
    templateId: 'template_assist',
    prompt: '',
    runtime: { kind: 'hermes' as const, mode, profile: profileName },
    runtimeOptions: mode === 'delegate' && id === 'orchestrator' ? { orchestrator: true } : {},
    parentGraphId: null,
    title: id.replaceAll('_', ''),
    position: { x: 0, y: 0 },
  });
  return {
    id: 'deck_builder',
    name: 'Deck',
    version: 1,
    promptTemplates: [],
    nodes: [
      card('card_main_chat', 'main', 'main'),
      card('orchestrator', 'delegate', 'orchestrator'),
      card('card_magentic', 'magentic_one', 'card_magentic'),
      card('worker', 'delegate', 'worker'),
    ],
    edges: [
      { id: 'orange', source: 'card_main_chat', target: 'orchestrator', edgeType: 'flow' },
      { id: 'blue', source: 'card_magentic', target: 'worker', edgeType: 'magentic_option' },
    ],
  };
}

describe('Hermes topology profile synchronization', () => {
  it('publishes direct reachability and the exact blue worker ceiling', async () => {
    profile.configure.mockResolvedValue({});
    expect(hermesTopologyPlans(deck())).toEqual([
      { cardId: 'card_main_chat', profile: 'main', botModeRoster: ['orchestrator', 'card_magentic', 'worker'] },
      { cardId: 'orchestrator', profile: 'orchestrator', botModeRoster: ['main'] },
      { cardId: 'card_magentic', profile: 'card_magentic', botModeRoster: ['worker'] },
    ]);
    await synchronizeHermesTopologyProfiles(deck());
    expect(profile.configure).toHaveBeenCalledTimes(3);
    expect(profile.configure).toHaveBeenLastCalledWith({
      profile: 'card_magentic',
      botModeRoster: ['worker'],
    });
  });
});
