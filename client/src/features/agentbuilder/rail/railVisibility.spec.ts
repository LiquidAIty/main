/**
 * Entity: Agent Builder
 * Relationship: This file verifies Agent Builder rail visibility follows enabled saved Cards and declared surface attachments.
 * Entity: Saved Cards
 * Relationship: This file verifies Card identity and attachment state, rather than orange or blue wires, controls optional surface visibility.
 */

import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../../../types/agentgraph';
import { deriveVisibleRailItems, isWorldViewCard } from './railVisibility';

const worldView: AgentCardInstance = {
  id: 'card-generated-id',
  title: 'WorldView',
  role: 'Geospatial orchestration',
  prompt: 'Operate the one Earth experience.',
  templateId: 'template_assist',
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'worldview' },
  runtimeOptions: {
    subsystems: [{
      id: 'gods-eye',
      label: 'God’s Eye',
      adapter: {
        kind: 'python',
        contractVersion: 'card-subsystem.v1',
        capabilities: ['state', 'events', 'readiness'],
      },
      cardTab: { enabled: true },
    }],
  },
  position: { x: 0, y: 0 },
};

const worldSignals: AgentCardInstance = {
  ...worldView,
  id: 'card_worldsignals_agent',
  title: 'WorldSignals',
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'worldsignals' },
  runtimeOptions: {},
};

const trading: AgentCardInstance = {
  ...worldView,
  id: 'card_trading_workbench',
  title: 'Trader',
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'trader' },
  runtimeOptions: {},
};

function visible(
  nodes: AgentCardInstance[],
  workspaceView = 'canvas',
): ReturnType<typeof deriveVisibleRailItems> {
  return deriveVisibleRailItems({
    deck: { nodes, edges: [] },
    workspaceView,
  });
}

describe('product rail visibility', () => {
  it('recognizes the one Earth surface from its saved subsystem attachment, not Card id', () => {
    expect(isWorldViewCard(worldView)).toBe(true);
    expect(isWorldViewCard({
      ...worldView,
      id: 'another-saved-identity',
    })).toBe(true);
    expect(isWorldViewCard(worldSignals)).toBe(false);
  });

  it('does not show disconnected WorldSignals while preserving other enabled product surfaces', () => {
    expect(visible([
      worldView,
      worldSignals,
      trading,
    ])).toEqual({
      showKnowledge: true,
      showWorldsignal: false,
      showWorldview: true,
      showTrading: true,
    });
  });

  it('shows WorldSignals only when its saved Card is connected', () => {
    const deck = {
      nodes: [worldSignals],
      edges: [{
        id: 'worldsignals-flow',
        source: 'card_main_chat',
        target: worldSignals.id,
        edgeType: 'flow' as const,
      }],
    };
    expect(deriveVisibleRailItems({ deck, workspaceView: 'canvas' }).showWorldsignal).toBe(true);
  });

  it('keeps orange and blue wires independent from surface visibility', () => {
    const nodes = [worldView];
    const withoutWires = deriveVisibleRailItems({
      deck: { nodes, edges: [] },
      workspaceView: 'canvas',
    });
    const withUnrelatedWires = deriveVisibleRailItems({
      deck: {
        nodes,
        edges: [
          { id: 'orange', source: 'main', target: worldView.id, edgeType: 'flow' },
          {
            id: 'blue', source: 'card_magentic', target: worldView.id,
            edgeType: 'magentic_option',
          },
        ],
      },
      workspaceView: 'canvas',
    });

    expect(withUnrelatedWires).toEqual(withoutWires);
    expect(withoutWires.showWorldview).toBe(true);
  });

  it('hides a disabled saved Card unless its already-open workspace remains active', () => {
    const disabled = {
      ...worldView,
      enabled: false,
    };

    expect(visible([disabled]).showWorldview).toBe(false);
    expect(visible([disabled], 'worldview').showWorldview).toBe(true);
  });
});
