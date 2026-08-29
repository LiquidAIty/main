// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, CardRuntime, DeckDocument } from '../types/agentgraph';
// Deck logic moved out of the page in the 2026-07-08 decomposition; the spec
// tests the real modules directly.
import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import {
  readDeckDocument,
  resolveProjectDeckLoadResult,
  resolveProjectDeckPayload,
} from '../features/agentbuilder/deck/deckDocument';

function createCard(
  id: string,
  runtime: CardRuntime,
  overrides: Partial<AgentCardInstance> = {},
): AgentCardInstance {
  return {
    id,
    kind: 'agent',
    templateId: 'template_test',
    prompt: '',
    runtime,
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
  it('does not manufacture Coder authority from a Card id or template', () => {
    const deck = createDeck([
      createCard('card_local_coder', { kind: 'autogen', mode: 'assistant' }, {
        templateId: 'template_local_coder',
        runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.6-luna' },
      }),
    ]);

    const loaded = readDeckDocument(deck);
    expect(loaded.nodes[0]?.runtime).toEqual({ kind: 'autogen', mode: 'assistant' });
  });

  it('ships the default example using the real magentic-led agent graph', () => {
    expect(INITIAL_DECK.nodes.map((node) => node.title)).toEqual([
      'Main Chat',
      'Agent Builder',
      'Magentic-One',
      'Local Coder',
      'Kanban',
      'Trading Agent',
      'WorldSignals Agent',
    ]);

    expect(INITIAL_DECK.nodes.map((node) => node.runtime)).toEqual([
      { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      { kind: 'hermes', mode: 'delegate', profile: 'liquidaity-agent-builder' },
      { kind: 'autogen', mode: 'magentic_one' },
      { kind: 'hermes', mode: 'delegate', profile: 'coder' },
      { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
      { kind: 'autogen', mode: 'assistant' },
      { kind: 'autogen', mode: 'assistant' },
    ]);
    expect(INITIAL_DECK.nodes.map((node) => node.templateId)).toEqual([
      'template_main_chat',
      'template_agent_builder',
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
      { source: 'card_main_chat', target: 'card_agent_builder', edgeType: 'flow' },
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
      {
        source: 'card_trading_workbench',
        target: 'card_magentic',
        edgeType: 'magentic_option',
      },
      {
        source: 'card_magentic',
        target: 'card_local_coder',
        edgeType: 'magentic_option',
      },
    ]);
    const systemCoder = INITIAL_DECK.nodes.find((node) => node.id === 'card_local_coder');
    const agentBuilder = INITIAL_DECK.nodes.find((node) => node.id === 'card_agent_builder');
    expect(systemCoder?.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'coder' });
    expect(agentBuilder?.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'liquidaity-agent-builder' });
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_magentic')?.runtime).toEqual({ kind: 'autogen', mode: 'magentic_one' });
    expect(systemCoder?.runtimeOptions?.tools).toEqual([
      'cbm.search_graph',
      'cbm.trace_path',
      'cbm.get_code_snippet',
      'cbm.check_index_coverage',
      'cbm.detect_changes',
    ]);
    expect(agentBuilder?.runtimeOptions?.tools).toEqual([
      'card.create',
      'card.update_configuration',
      'canvas.upsert_wire',
      'cbm.search_graph',
      'cbm.trace_path',
      'cbm.get_code_snippet',
      'cbm.check_index_coverage',
      'cbm.detect_changes',
    ]);
    expect(agentBuilder?.runtimeOptions?.skills).toEqual(['hermes-agent']);
    expect(systemCoder?.runtimeOptions?.tools).toContain('cbm.search_graph');
    expect(systemCoder?.runtimeOptions?.tools).not.toContain('run_local_coder');
    expect(systemCoder?.runtimeOptions?.toolsets).toEqual(['hermes-acp', 'computer_use']);
    expect(systemCoder?.runtimeOptions?.tools).not.toContain('card.run_assistant_agent');
    expect(INITIAL_DECK.edges).toContainEqual(expect.objectContaining({
      source: 'card_magentic', target: 'card_local_coder', edgeType: 'magentic_option',
    }));
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_main_chat', target: 'card_local_coder', edgeType: 'flow',
    }));
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_agent_builder', target: 'card_magentic', edgeType: 'magentic_option',
    }));
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_main_chat')?.runtime).toEqual({ kind: 'hermes', mode: 'main', profile: 'liquidaity-main' });
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_hermes_steward')?.runtime).toEqual({ kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' });
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_worldsignals_agent')?.runtime).toEqual({ kind: 'autogen', mode: 'assistant' });
  });

  it('loads a real saved deck and preserves its visible chain', () => {
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Saved Deck',
      promptTemplates: [],
      version: INITIAL_DECK.version,
      nodes: [
        createCard('card_saved_a', { kind: 'hermes', mode: 'main', profile: 'saved-main' }, {
          templateId: 'template_main_chat',
          title: 'Saved A',
        }),
        createCard('card_saved_b', { kind: 'autogen', mode: 'assistant' }, {
          templateId: 'template_research',
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

  it('keeps a Hermes profile in the one explicit runtime identity', () => {
    const deck = createDeck([
      createCard('card_saved_helper', { kind: 'hermes', mode: 'delegate', profile: 'saved-helper' }, {
        runtimeOptions: {
          provider: 'openai',
          modelKey: 'gpt-5.6-luna',
          skills: ['saved-skill'],
          mcpConnectionIds: ['saved-connection'],
        },
      }),
    ]);

    const loaded = readDeckDocument(JSON.parse(JSON.stringify(deck)));

    expect(loaded.nodes[0].runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'saved-helper' });
    expect(loaded.nodes[0].runtimeOptions).toMatchObject({
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
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Agent Card Deck',
      promptTemplates: [],
      version: 2,
      nodes: [
        createCard('card_main_chat', { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' }, {
          templateId: 'template_main_chat',
          title: 'Main Chat',
        }),
        createCard('card_kg_ingest', { kind: 'autogen', mode: 'assistant' }, {
          templateId: 'template_kg_ingest',
          title: 'KG Ingest / ThinkGraph',
        }),
        createCard('card_research', { kind: 'autogen', mode: 'assistant' }, {
          templateId: 'template_research',
          title: 'Research Agent',
        }),
        createCard('card_knowgraph', { kind: 'autogen', mode: 'assistant' }, {
          templateId: 'template_knowgraph',
          title: 'KnowGraph',
        }),
        createCard('card_neo4j', { kind: 'autogen', mode: 'assistant' }, {
          templateId: 'template_neo4j',
          title: 'Neo4j',
        }),
      ],
      edges: [
        { id: 'edge_main_chat_kg_ingest', source: 'card_main_chat', target: 'card_kg_ingest', edgeType: 'flow' },
      ],
    };

    const hydrated = readDeckDocument(savedDeck);

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
      runtime: { kind: 'autogen', mode: 'assistant' },
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
    expect(() => resolveProjectDeckLoadResult(null)).toThrow('deck_not_found');
  });

  it('does not add template edges to a real deck that saved with no edges', () => {
    const hydrated = readDeckDocument({
      id: 'deck_builder',
      name: 'Edge Free Deck',
      version: 1,
      promptTemplates: [],
      nodes: [
        createCard('card_lonely', { kind: 'hermes', mode: 'main', profile: 'lonely-main' }, {
          templateId: 'template_main_chat',
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
        createCard('card_a', { kind: 'autogen', mode: 'assistant' }, { title: 'A' }),
        createCard('card_b', { kind: 'autogen', mode: 'assistant' }, { title: 'B' }),
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
        createCard('card_custom_main', { kind: 'hermes', mode: 'main', profile: 'custom-main' }, {
          templateId: 'template_main_chat',
          title: 'Main Chat',
        }),
        createCard('card_custom_research', { kind: 'autogen', mode: 'assistant' }, {
          templateId: 'template_research',
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
        createCard('card_a', { kind: 'autogen', mode: 'assistant' }, { title: 'A' }),
        createCard('card_b', { kind: 'autogen', mode: 'assistant' }, { title: 'B' }),
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
