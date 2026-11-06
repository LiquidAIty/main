// Entity: Card Topology
// Relationship: Verifies persisted orange and blue wires produce exact native Bot rosters and Magnetic worker membership before profile publication.

import { describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ configureRoster: vi.fn() }));
vi.mock('./hermesProfileClient', () => ({
  configureHermesBotRoster: profile.configureRoster,
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
    profile.configureRoster.mockResolvedValue([]);
    expect(hermesTopologyPlans(deck())).toEqual([
      { cardId: 'card_main_chat', profile: 'main', botModeRoster: ['orchestrator', 'card_magentic', 'worker'] },
      { cardId: 'orchestrator', profile: 'orchestrator', botModeRoster: ['main'] },
      { cardId: 'card_magentic', profile: 'card_magentic', botModeRoster: ['worker'] },
    ]);
    await synchronizeHermesTopologyProfiles(deck());
    expect(profile.configureRoster).toHaveBeenCalledTimes(3);
    expect(profile.configureRoster).toHaveBeenLastCalledWith('card_magentic', ['worker']);
  });

  it('projects the retained eleven-Card, nine-wire Trading topology exactly', () => {
    const card = (id: string, title: string, mode: 'main' | 'delegate' | 'magentic_one', profileName: string) => ({
      id,
      kind: 'agent' as const,
      templateId: 'template_assist',
      prompt: '',
      runtime: { kind: 'hermes' as const, mode, profile: profileName },
      runtimeOptions: {},
      parentGraphId: null,
      title,
      position: { x: 0, y: 0 },
    });
    const trading: DeckDocument = {
      id: 'deck_builder',
      name: 'Trading',
      version: 1,
      promptTemplates: [],
      nodes: [
        card('card_main_chat', 'Main', 'main', 'main'),
        card('builder', 'Builder', 'delegate', 'builder'),
        card('card_thinkgraph', 'ThinkGraph', 'delegate', 'thinkgraph'),
        card('card_magentic', 'Magnetic', 'magentic_one', 'card_magentic'),
        card('card_team', 'Team', 'delegate', 'team'),
        card('card_knowgraph', 'KnowGraph', 'delegate', 'knowgraph'),
        card('card_trading_workbench', 'Trader', 'delegate', 'trading'),
        card('card_worldsignals_agent', 'WorldSignals', 'delegate', 'worldsignals'),
        card('card_worldview', 'WorldView', 'delegate', 'worldview'),
        card('card_analyst', 'Analyst', 'delegate', 'signal-analyst'),
        card('card_quant', 'Quant', 'delegate', 'quant-analyst'),
      ],
      edges: [
        { id: 'main-builder', source: 'card_main_chat', target: 'builder', edgeType: 'flow' },
        { id: 'main-think', source: 'card_main_chat', target: 'card_thinkgraph', edgeType: 'flow' },
        { id: 'main-know', source: 'card_main_chat', target: 'card_knowgraph', edgeType: 'flow' },
        { id: 'analyst-magnetic', source: 'card_analyst', target: 'card_magentic', edgeType: 'magentic_option' },
        { id: 'quant-magnetic', source: 'card_quant', target: 'card_magentic', edgeType: 'magentic_option' },
        { id: 'magnetic-team', source: 'card_magentic', target: 'card_team', edgeType: 'magentic_option' },
        { id: 'main-magnetic', source: 'card_main_chat', target: 'card_magentic', edgeType: 'flow' },
        { id: 'worldview-magnetic', source: 'card_worldview', target: 'card_magentic', edgeType: 'magentic_option' },
        { id: 'trader-magnetic', source: 'card_trading_workbench', target: 'card_magentic', edgeType: 'magentic_option' },
      ],
    };

    expect(hermesTopologyPlans(trading)).toEqual([
      {
        cardId: 'card_main_chat',
        profile: 'main',
        botModeRoster: [
          'builder', 'thinkgraph', 'knowgraph', 'signal-analyst', 'card_magentic',
          'quant-analyst', 'team', 'worldview', 'trading',
        ],
      },
      {
        cardId: 'card_magentic',
        profile: 'card_magentic',
        botModeRoster: ['signal-analyst', 'quant-analyst', 'team', 'worldview', 'trading'],
      },
    ]);
  });
});
