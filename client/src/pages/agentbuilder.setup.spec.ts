// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument, RuntimeBinding } from '../types/agentgraph';
// Deck logic moved out of the page in the 2026-07-08 decomposition; the spec
// tests the real modules directly.
import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import {
  readDeckDocument,
  resolveLocalCoderControllerConsoleConfig,
  resolveProjectDeckLoadResult,
  resolveProjectDeckPayload,
} from '../features/agentbuilder/deck/deckDocument';

function createCard(
  id: string,
  runtimeType: AgentCardInstance['runtimeType'],
  overrides: Partial<AgentCardInstance> = {},
): AgentCardInstance {
  return {
    id,
    kind: 'agent',
    templateId: 'template_test',
    prompt: '',
    runtimeBinding: null,
    runtimeType,
    runtimeOptions: null,
    title: id,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function createDeck(nodes: AgentCardInstance[]): DeckDocument {
  return {
    id: 'deck_setup',
    name: 'Deck Setup',
    promptTemplates: [],
    version: 1,
    nodes,
    edges: [],
  };
}

describe('agentbuilder authoring flow', () => {
  it('does not manufacture LocalCoder authority from a Card id or template', () => {
    const deck = createDeck([
      createCard('card_local_coder', 'assistant_agent', {
        templateId: 'template_local_coder',
        runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.6-luna' },
      }),
    ]);

    const loaded = readDeckDocument(deck);
    expect(loaded.nodes[0]?.runtimeBinding).toBeNull();
    expect(resolveLocalCoderControllerConsoleConfig(loaded)).toEqual({
      provider: '',
      model: '',
    });
  });

  it('ships the default example using the real magentic-led agent graph', () => {
    expect(INITIAL_DECK.nodes.map((node) => node.title)).toEqual([
      'Main Chat',
      'Magentic-One',
      'Coder',
      'Kanban',
      'Trading Agent',
      'WorldSignals Agent',
    ]);

    expect(INITIAL_DECK.nodes.map((node) => node.runtimeBinding)).toEqual([
      'main_chat',
      null,
      'local_coder',
      'hermes_steward',
      'trading_agent',
      'worldsignals_agent',
    ]);
    expect(INITIAL_DECK.nodes.map((node) => node.templateId)).toEqual([
      'template_main_chat',
      'template_magentic',
      'template_local_coder',
      'template_hermes_steward',
      'template_trading_workbench',
      'template_worldsignals_agent',
    ]);

    expect(INITIAL_DECK.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    }))).toEqual([
      { source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' },
      { source: 'card_main_chat', target: 'card_local_coder', edgeType: 'flow' },
      { source: 'card_hermes_steward', target: 'card_worldsignals_agent', edgeType: 'flow' },
      { source: 'card_local_coder', target: 'card_magentic', edgeType: 'magentic_option' },
      {
        source: 'card_main_chat',
        target: 'card_magentic',
        edgeType: 'magentic_control',
      },
      {
        source: 'card_worldsignals_agent',
        target: 'card_magentic',
        edgeType: 'magentic_option',
      },
    ]);
    const systemCoder = INITIAL_DECK.nodes.find((node) => node.id === 'card_local_coder');
    expect(systemCoder?.runtimeType).toBe('assistant_agent');
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_magentic')?.runtimeType).toBe('magentic_one');
    expect(systemCoder?.runtimeBinding).toBe('local_coder');
    expect(systemCoder?.runtimeOptions?.tools).toContain('cbm.search_graph');
    expect(INITIAL_DECK.edges.some((edge) => edge.source === 'card_local_coder' && edge.edgeType === 'magentic_option')).toBe(true);
    expect(INITIAL_DECK.nodes.every((node) => node.runtimeOptions?.profile === undefined)).toBe(true);
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_main_chat')?.runtimeOptions?.executionMode).toBe('single');
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_hermes_steward')?.runtimeOptions?.executionMode).toBe('auto-kanban');
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_worldsignals_agent')?.runtimeOptions?.executionMode).toBe('single');
  });

  it('loads a real saved deck and preserves its visible chain', () => {
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Saved Deck',
      promptTemplates: [],
      version: INITIAL_DECK.version,
      nodes: [
        createCard('card_saved_a', 'assistant_agent', {
          templateId: 'template_main_chat',
          runtimeBinding: 'main_chat',
          title: 'Saved A',
        }),
        createCard('card_saved_b', 'assistant_agent', {
          templateId: 'template_research',
          runtimeBinding: 'research_agent',
          title: 'Saved B',
        }),
      ],
      edges: [
        { id: 'edge_saved_a_b', source: 'card_saved_a', target: 'card_saved_b', edgeType: 'flow' },
      ],
    };

    const loaded = resolveProjectDeckPayload(savedDeck);

    expect(loaded.deck.nodes.map((node) => node.title)).toEqual(['Saved A', 'Saved B']);
    expect(loaded.deck.edges).toEqual([
      {
        id: 'edge_saved_a_b',
        source: 'card_saved_a',
        target: 'card_saved_b',
        edgeType: 'flow',
      },
    ]);
  });

  it('keeps a legacy profile field readable without making it runtime identity', () => {
    const legacy = createDeck([
      createCard('card_legacy', 'assistant_agent', {
        runtimeOptions: {
          provider: 'openai',
          modelKey: 'gpt-5.6-luna',
          profile: 'old-selector',
          skills: ['saved-skill'],
          mcpConnectionIds: ['saved-connection'],
        },
      }),
    ]);

    const loaded = readDeckDocument(JSON.parse(JSON.stringify(legacy)));

    expect(loaded.nodes[0].runtimeOptions).toMatchObject({
      profile: 'old-selector',
      skills: ['saved-skill'],
      mcpConnectionIds: ['saved-connection'],
    });
  });

  it('round-trips real restored research cards with saved branch and recombine topology intact', () => {
    const savedDeck: DeckDocument = {
      ...JSON.parse(JSON.stringify(INITIAL_DECK)),
      version: 2,
    };

    const loaded = resolveProjectDeckPayload(savedDeck);
    const rehydrated = readDeckDocument(JSON.parse(JSON.stringify(loaded.deck)));

    expect(rehydrated.nodes.map((node) => node.title)).toEqual(INITIAL_DECK.nodes.map((node) => node.title));
    expect(rehydrated.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    }))).toEqual(INITIAL_DECK.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    })));
  });

  it('fails a missing saved deck instead of silently seeding one during load', () => {
    expect(() => resolveProjectDeckPayload(null)).toThrow('deck_not_found');
  });

  it('treats trimmed saved system decks as real saved state instead of fallback display mode', () => {
    const orchestratorNode = INITIAL_DECK.nodes.find(
      (node) => node.id === 'card_magentic',
    );
    if (!orchestratorNode) {
      throw new Error('missing_magentic');
    }

    const truncatedSystemDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Broken Saved Deck',
      promptTemplates: [],
      version: 4,
      nodes: [
        {
          ...JSON.parse(JSON.stringify(orchestratorNode)),
          id: 'card_magentic',
          title: 'Magentic-One',
        },
      ],
      edges: [],
    };

    const loaded = resolveProjectDeckPayload(truncatedSystemDeck);

    expect(loaded.deck.nodes.map((node) => node.id)).toEqual(['card_magentic']);
    expect(loaded.deck.edges).toEqual([]);
  });

  it('preserves a saved deck without merging the current new-project template into it', () => {
    const legacyDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Agent Card Deck',
      promptTemplates: [],
      version: 2,
      nodes: [
        createCard('card_main_chat', 'assistant_agent', {
          templateId: 'template_main_chat',
          runtimeBinding: 'main_chat',
          title: 'Main Chat',
        }),
        // Retired bindings: valid when this deck was saved, no longer in the
        // RuntimeBinding union. Persisted data can still carry them, which is
        // exactly what the upgrade path must drop — so they're cast, not typed.
        createCard('card_kg_ingest', 'assistant_agent', {
          templateId: 'template_kg_ingest',
          runtimeBinding: 'kg_ingest' as RuntimeBinding,
          title: 'KG Ingest / ThinkGraph',
        }),
        createCard('card_research', 'assistant_agent', {
          templateId: 'template_research',
          runtimeBinding: 'research_agent',
          title: 'Research Agent',
        }),
        createCard('card_knowgraph', 'assistant_agent', {
          templateId: 'template_knowgraph',
          runtimeBinding: 'knowgraph' as RuntimeBinding,
          title: 'KnowGraph',
        }),
        createCard('card_neo4j', 'assistant_agent', {
          templateId: 'template_neo4j',
          runtimeBinding: 'neo4j' as RuntimeBinding,
          title: 'Neo4j',
        }),
      ],
      edges: [
        { id: 'edge_main_chat_kg_ingest', source: 'card_main_chat', target: 'card_kg_ingest', edgeType: 'flow' },
      ],
    };

    const hydrated = readDeckDocument(legacyDeck);

    expect(hydrated.nodes.map((node) => node.id)).toEqual([
      'card_main_chat',
      'card_kg_ingest',
      'card_research',
      'card_knowgraph',
      'card_neo4j',
    ]);
    expect(hydrated.edges).toEqual([
      expect.objectContaining({
        id: 'edge_main_chat_kg_ingest',
        source: 'card_main_chat',
        target: 'card_kg_ingest',
        edgeType: 'flow',
      }),
    ]);
  });

  it('never replaces saved system-card tool grants during hydration', () => {
    const stale = JSON.parse(JSON.stringify(INITIAL_DECK)) as DeckDocument;
    stale.version = 77;
    const main = stale.nodes.find((node) => node.id === 'card_main_chat');
    const coder = stale.nodes.find((node) => node.id === 'card_local_coder');
    const hermes = stale.nodes.find((node) => node.id === 'card_hermes_steward');
    if (!main || !coder || !hermes) throw new Error('system_cards_missing');
    main.prompt = 'Saved Main prompt';
    main.position = { x: 111, y: 222 };
    main.runtimeOptions = {
      ...main.runtimeOptions,
      provider: 'openrouter',
      modelKey: 'saved-main-model',
      tools: ['engraphis.export_code_graph'],
    };
    coder.runtimeOptions = {
      ...coder.runtimeOptions,
      provider: 'openrouter',
      modelKey: 'saved-coder-model',
      tools: ['cbm.delete_project'],
    };
    hermes.runtimeOptions = {
      ...hermes.runtimeOptions,
      provider: 'openrouter',
      modelKey: 'saved-hermes-model',
      tools: ['clear_graph'],
    };
    const savedEdges = JSON.parse(JSON.stringify(stale.edges));

    const hydrated = readDeckDocument(stale);
    const hydratedMain = hydrated.nodes.find((node) => node.id === 'card_main_chat');
    const hydratedCoder = hydrated.nodes.find((node) => node.id === 'card_local_coder');
    const hydratedHermes = hydrated.nodes.find((node) => node.id === 'card_hermes_steward');

    expect(hydrated.version).toBe(77);
    expect(hydratedMain?.runtimeOptions?.tools).toEqual(['engraphis.export_code_graph']);
    expect(hydratedCoder?.runtimeOptions?.tools).toEqual(['cbm.delete_project']);
    expect(hydratedHermes?.runtimeOptions?.tools).toEqual(['clear_graph']);
    expect(hydratedMain).toMatchObject({
      prompt: 'Saved Main prompt',
      position: { x: 111, y: 222 },
      runtimeOptions: {
        provider: 'openrouter',
        modelKey: 'saved-main-model',
      },
    });
    expect(hydratedCoder?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'saved-coder-model',
    });
    expect(hydratedHermes?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'saved-hermes-model',
    });
    expect(hydrated.edges).toMatchObject(savedEdges);
  });

  it('preserves saved cards and prompts instead of applying hidden tombstones', () => {
    const retiredCodeCard: AgentCardInstance = {
      id: 'card_code_workbench',
      kind: 'agent',
      templateId: 'template_code_workbench',
      prompt: 'retired',
      runtimeBinding: null,
      runtimeType: 'assistant_agent',
      runtimeOptions: null,
      parentGraphId: 'workbench_code',
      title: 'Code Agent',
      position: { x: 0, y: 0 },
    };
    const hydrated = readDeckDocument({
      ...INITIAL_DECK,
      nodes: [...INITIAL_DECK.nodes, retiredCodeCard],
      promptTemplates: [
        ...INITIAL_DECK.promptTemplates,
        { id: 'prompt_code_workbench', content: 'retired' },
      ],
    });

    expect(hydrated.nodes.map((node) => node.id)).toContain('card_code_workbench');
    expect(hydrated.promptTemplates.map((template) => template.id)).toContain('prompt_code_workbench');
  });

  it('fails project load when the saved deck is missing', () => {
    const currentDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Current Deck',
      promptTemplates: [],
      version: 3,
      nodes: [
        createCard('card_current_a', 'assistant_agent', {
          templateId: 'template_main_chat',
          runtimeBinding: 'main_chat',
          title: 'Current A',
        }),
      ],
      edges: [],
    };

    expect(() => resolveProjectDeckLoadResult(currentDeck, null)).toThrow('deck_not_found');
  });

  it('does not add template edges to a real deck that saved with no edges', () => {
    const hydrated = readDeckDocument({
      id: 'deck_builder',
      name: 'Edge Free Deck',
      version: 1,
      promptTemplates: [],
      nodes: [
        createCard('card_lonely', 'assistant_agent', {
          templateId: 'template_main_chat',
          runtimeBinding: 'main_chat',
          title: 'Lonely',
        }),
      ],
      edges: [],
    });

    expect(hydrated.nodes.map((node) => node.title)).toEqual(['Lonely']);
    expect(hydrated.edges).toEqual([]);
  });

  it('loads saved edges as topology', () => {
    const hydrated = readDeckDocument({
      id: 'deck_builder',
      name: 'Legacy Edge Deck',
      version: 1,
      promptTemplates: [],
      nodes: [
        createCard('card_a', 'assistant_agent', { title: 'A' }),
        createCard('card_b', 'assistant_agent', { title: 'B' }),
      ],
      edges: [
        { id: 'edge_a_b', source: 'card_a', target: 'card_b', edgeType: 'flow' },
      ],
    });

    expect(hydrated.edges).toEqual([
      {
        id: 'edge_a_b',
        source: 'card_a',
        target: 'card_b',
        edgeType: 'flow',
      },
    ]);
  });

  it('does not add template chain edges to partial saved decks that already provide real cards', () => {
    const hydrated = readDeckDocument({
      id: 'deck_builder',
      name: 'Partial Saved Deck',
      version: 3,
      promptTemplates: [],
      nodes: [
        createCard('card_custom_main', 'assistant_agent', {
          templateId: 'template_main_chat',
          runtimeBinding: 'main_chat',
          title: 'Main Chat',
        }),
        createCard('card_custom_research', 'assistant_agent', {
          templateId: 'template_research',
          runtimeBinding: 'research_agent',
          title: 'Research Agent',
        }),
      ],
      edges: [],
    });

    expect(hydrated.nodes.map((node) => node.title)).toEqual([
      'Main Chat',
      'Research Agent',
    ]);
    expect(hydrated.edges).toEqual([]);
  });

  it('preserves explicit deletion of optional system cards on reload', () => {
    const trimmedSavedDeck: DeckDocument = {
      ...JSON.parse(JSON.stringify(INITIAL_DECK)),
      version: 5,
      nodes: INITIAL_DECK.nodes.filter(
        (node) =>
          node.id !== 'card_trading_workbench' &&
          node.id !== 'card_worldsignals_agent',
      ),
      edges: [],
    };

    const loaded = resolveProjectDeckPayload(trimmedSavedDeck);
    const rehydrated = readDeckDocument(JSON.parse(JSON.stringify(loaded.deck)));

    expect(rehydrated.nodes.map((node) => node.id)).not.toContain('card_trading_workbench');
    expect(rehydrated.nodes.map((node) => node.id)).not.toContain('card_worldsignals_agent');
  });


  // The retired authoring-compatibility filter silently DROPPED saved edges that
  // did not fit the retired nested-authoring model — real user intent, deleted on
  // load. Hydration now keeps every edge whose endpoints still exist, whatever its
  // type: an unrecognised type is classified 'invalid' (inert but visible), never
  // silently removed. (Edges orphaned by a retired card are covered above.)
  it('preserves every persisted edge through hydration, including an unrecognised type', () => {
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Saved Edge Deck',
      promptTemplates: [],
      version: 2,
      nodes: [
        createCard('card_a', 'assistant_agent', { title: 'A' }),
        createCard('card_b', 'assistant_agent', { title: 'B' }),
      ],
      edges: [
        { id: 'edge_call', source: 'card_a', target: 'card_b', edgeType: 'flow' },
        // A typo'd/legacy type: preserved and visible, but authorises nothing.
        { id: 'edge_typo', source: 'card_b', target: 'card_a', edgeType: 'reports_to' as never },
      ],
    };

    const rehydrated = readDeckDocument(JSON.parse(JSON.stringify(savedDeck)));

    expect(rehydrated.edges.map((edge) => edge.id)).toEqual(['edge_call', 'edge_typo']);
    expect(rehydrated.edges.find((edge) => edge.id === 'edge_call')?.edgeType).toBe('flow');
    expect(rehydrated.edges.find((edge) => edge.id === 'edge_typo')?.edgeType).toBe('reports_to');
  });

});
