import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: vi.fn(),
}));

import { getDeckDocument } from '../decks/store';
import {
  resolveHermesCardRuntimeConfig,
  resolveMainHermesRuntimeConfig,
} from './mainAdapter';

const mockGetDeck = getDeckDocument as unknown as ReturnType<typeof vi.fn>;

const main = {
  id: 'card_main_chat',
  kind: 'agent',
  title: 'Main Chat',
  prompt: 'Saved Main prompt.',
  runtimeBinding: 'main_chat',
  runtimeType: 'assistant_agent',
  runtimeOptions: {
    provider: 'openai',
    modelKey: 'gpt-5.6-luna',
    profile: 'default',
    executionMode: 'single',
    tools: ['engraphis.recall', 'web_search'],
  },
};

beforeEach(() => mockGetDeck.mockReset());

describe('Hermes saved-card runtime resolution', () => {
  it('resolves Main from the saved deck, filters ordinary web, and grants its direct Coder and Kanban helper', async () => {
    const coder = {
      id: 'card_local_coder',
      kind: 'agent',
      runtimeBinding: 'local_coder',
      runtimeType: 'assistant_agent',
      runtimeOptions: { enabled: true },
    };
    const unrelated = {
      id: 'card_other',
      kind: 'agent',
      runtimeBinding: 'worldsignals_agent',
      runtimeType: 'assistant_agent',
    };
    const kanban = {
      id: 'card_hermes_steward',
      kind: 'agent',
      title: 'Hermes Kanban',
      runtimeBinding: 'hermes_steward',
      runtimeType: 'assistant_agent',
    };
    mockGetDeck.mockResolvedValue({
      deck: {
        nodes: [main, coder, kanban, unrelated],
        edges: [
          { source: main.id, target: coder.id, edgeType: 'flow' },
          { source: main.id, target: kanban.id, edgeType: 'flow' },
          { source: main.id, target: unrelated.id, edgeType: 'flow' },
        ],
      },
    });

    const config = await resolveMainHermesRuntimeConfig('project-1');

    expect(config).toMatchObject({
      cardId: main.id,
      profile: 'default',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      executionMode: 'single',
      coderCardIds: [coder.id],
      directSubagents: [
        { cardId: coder.id, title: coder.id, runtimeBinding: 'local_coder' },
        { cardId: kanban.id, title: 'Hermes Kanban', runtimeBinding: 'hermes_steward' },
        { cardId: unrelated.id, title: unrelated.id, runtimeBinding: 'worldsignals_agent' },
      ],
    });
    expect(config?.tools).toEqual(['engraphis.recall', 'card.run_assistant_agent']);
    expect(config?.prompt).toContain('Saved Main prompt.');
    expect(config?.prompt).toContain(coder.id);
    expect(config?.prompt).toContain(kanban.id);
  });

  it('resolves the separate Hermes card through the same saved-card contract', () => {
    const config = resolveHermesCardRuntimeConfig({
      ...main,
      id: 'card_hermes_steward',
      title: 'Hermes',
      runtimeBinding: 'hermes_steward',
      runtimeOptions: {
        provider: 'openai',
        modelKey: 'gpt-5.6-luna',
        profile: 'research',
        executionMode: 'single',
        tools: ['graphiti.search_nodes'],
      },
    });

    expect(config).toMatchObject({
      cardId: 'card_hermes_steward',
      profile: 'research',
      executionMode: 'single',
      tools: ['graphiti.search_nodes'],
    });
  });
});
