import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../../types/agentgraph';
import { buildExecutionPlan } from './deckExecution';

function node(
  id: string,
  overrides: Partial<AgentCardInstance> = {},
): AgentCardInstance {
  return {
    id,
    kind: 'agent',
    templateId: 'template_assist',
    prompt: '',
    runtimeBinding: null,
    runtimeType: 'assistant_agent',
    parentGraphId: null,
    title: id,
    position: { x: 0, y: 0 },
    status: 'ready',
    ...overrides,
  };
}

function deck(nodes: AgentCardInstance[]): DeckDocument {
  return {
    id: 'deck',
    name: 'Deck',
    version: 1,
    promptTemplates: [],
    nodes,
    edges: [],
  };
}

describe('deckExecution topology guards', () => {
  it('does not treat a staged workbench card as runnable', () => {
    const plan = buildExecutionPlan(
      deck([
        node('card_magentic', {
          templateId: 'template_magentic',
          runtimeType: 'magentic_one',
          title: 'Magentic-One',
        }),
        node('card_trading_workbench', {
          templateId: 'template_trading_workbench',
          title: 'Trading Agent',
        }),
      ]),
    );

    expect(plan.simpleOrderCardIds).toEqual(['card_magentic']);
    expect(plan.startCardIds).toEqual(['card_magentic']);
  });
});

