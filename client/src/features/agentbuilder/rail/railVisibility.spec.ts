import { describe, expect, it } from 'vitest';

import type { DeckDocument } from '../../../types/agentgraph';
import { deriveVisibleRailItems, isWorldViewCard } from './railVisibility';

const worldView = {
  id: 'card-generated-id',
  title: 'WorldView',
  role: 'Signal discovery',
  prompt: 'Inspect sourced signals.',
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
} as const;

const magOne = {
  id: 'card_magentic', title: 'Mag One', role: 'Manager', prompt: '',
  templateId: 'template_magentic',
  runtime: { kind: 'autogen', mode: 'magentic_one' },
  position: { x: 100, y: 0 },
} as const;

function deck(connected: boolean): Pick<DeckDocument, 'nodes' | 'edges'> {
  return {
    nodes: [worldView, magOne] as DeckDocument['nodes'],
    edges: connected ? [{
      id: 'edge-worldview-mag-one',
      source: 'card_magentic',
      target: 'card-generated-id',
      edgeType: 'magentic_option',
    }] : [],
  };
}

describe('WorldView rail visibility', () => {
  it('derives the product surface from the saved subsystem attachment, not a Card id', () => {
    expect(isWorldViewCard(worldView as any)).toBe(true);
    expect(deriveVisibleRailItems({ deck: deck(true), workspaceView: 'canvas' }).showWorldview)
      .toBe(true);
  });

  it('keeps an unattached WorldView Card out of the rail until its workspace is active', () => {
    expect(deriveVisibleRailItems({ deck: deck(false), workspaceView: 'canvas' }).showWorldview)
      .toBe(false);
    expect(deriveVisibleRailItems({ deck: deck(false), workspaceView: 'worldview' }).showWorldview)
      .toBe(true);
  });
});
