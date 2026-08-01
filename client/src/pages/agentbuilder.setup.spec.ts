// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument, RuntimeBinding } from '../types/agentgraph';
// Deck logic moved out of the page in the 2026-07-08 decomposition; the spec
// tests the real modules directly.
import { INITIAL_DECK } from '../features/agentbuilder/deck/deckSeed';
import {
  HERMES_STEWARD_TOOLS,
  LOCAL_CODER_CONTROLLER_TOOLS,
  MAIN_CHAT_CONTROLLER_TOOLS,
  SYSTEM_TOOL_GRANTS_VERSION,
} from '../features/agentbuilder/deck/deckPrimitives';
import {
  hydrateDeckDocument,
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
  it('ships the default example using the real magentic-led agent graph', () => {
    expect(INITIAL_DECK.nodes.map((node) => node.title)).toEqual([
      'Main Chat / Harness',
      'Magentic-One',
      'Search Agent',
      'Coder',
      'OpenAI Coder',
      'Hermes',
      'Trading Agent',
      'WorldSignals Agent',
    ]);

    expect(INITIAL_DECK.nodes.map((node) => node.runtimeBinding)).toEqual([
      'main_chat',
      null,
      'research_agent',
      'local_coder',
      'openai_coder',
      'hermes_steward',
      'trading_agent',
      'worldsignals_agent',
    ]);
    expect(INITIAL_DECK.nodes.map((node) => node.templateId)).toEqual([
      'template_main_chat',
      'template_magentic',
      'template_research_agent',
      'template_local_coder',
      'template_openai_coder',
      'template_hermes_steward',
      'template_trading_workbench',
      'template_worldsignals_agent',
    ]);

    expect(INITIAL_DECK.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    }))).toEqual([
      { source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'hermes_observe' },
      { source: 'card_main_chat', target: 'card_local_coder', edgeType: 'flow' },
      { source: 'card_hermes_steward', target: 'card_research_agent', edgeType: 'flow' },
      { source: 'card_hermes_steward', target: 'card_worldsignals_agent', edgeType: 'flow' },
      {
        source: 'card_main_chat',
        target: 'card_magentic',
        edgeType: 'magentic_control',
      },
      {
        source: 'card_openai_coder',
        target: 'card_magentic',
        edgeType: 'magentic_option',
      },
      {
        source: 'card_research_agent',
        target: 'card_magentic',
        edgeType: 'magentic_option',
      },
      {
        source: 'card_worldsignals_agent',
        target: 'card_magentic',
        edgeType: 'magentic_option',
      },
    ]);
    const systemCoder = INITIAL_DECK.nodes.find((node) => node.id === 'card_local_coder');
    const openAiCoder = INITIAL_DECK.nodes.find((node) => node.id === 'card_openai_coder');
    expect(systemCoder?.runtimeType).toBe('local_coder');
    expect(systemCoder?.runtimeOptions?.tools).toContain('cbm.search_graph');
    expect(openAiCoder).toMatchObject({
      runtimeBinding: 'openai_coder',
      runtimeType: 'codex_app_server',
      runtimeOptions: { provider: 'openai', tools: [] },
    });
    expect(INITIAL_DECK.edges.some((edge) => edge.source === 'card_local_coder' && edge.edgeType === 'magentic_option')).toBe(false);
    expect(INITIAL_DECK.edges.some((edge) => edge.source === 'card_openai_coder' && edge.edgeType === 'magentic_option')).toBe(true);
    expect(INITIAL_DECK.edges.some((edge) => edge.source === 'card_main_chat' && edge.target === 'card_openai_coder')).toBe(false);
  });

  it('prefers a real saved deck over the fallback seed and preserves its visible chain', () => {
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

    expect(loaded.usedFallback).toBe(false);
    expect(loaded.deck.nodes.map((node) => node.title)).toEqual(['Saved A', 'Saved B']);
    expect(loaded.deck.edges).toEqual([
      {
        id: 'edge_saved_a_b',
        source: 'card_saved_a',
        sourceHandle: null,
        target: 'card_saved_b',
        targetHandle: null,
        edgeType: 'flow',
      },
    ]);
  });

  it('round-trips explicit edge metadata without changing preserved topology', () => {
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Metadata Deck',
      promptTemplates: [],
      version: 2,
      nodes: [
        createCard('card_a', 'assistant_agent', { title: 'A' }),
        createCard('card_b', 'assistant_agent', { title: 'B' }),
        createCard('card_c', 'assistant_agent', { title: 'C' }),
      ],
      edges: [
        {
          id: 'edge_a_b',
          source: 'card_a',
          target: 'card_b',
          edgeType: 'flow',
          metadata: {
            role: 'graph_execution',
            executionMode: 'conditional',
            conditionLabel: 'Only when research is stale',
            conditionExpression: 'blackboard.store.stale === true',
            priority: 2,
            mergeIntent: 'summarize_all',
          },
        },
        {
          id: 'edge_a_c',
          source: 'card_a',
          target: 'card_c',
          edgeType: 'flow',
          metadata: {
            role: 'graph_execution',
            executionMode: 'optional',
            order: 1,
            legacyCompatibility: true,
          },
        },
      ],
    };

    const loaded = resolveProjectDeckPayload(savedDeck);
    const rehydrated = hydrateDeckDocument(JSON.parse(JSON.stringify(loaded.deck)));

    expect(rehydrated.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
      metadata: edge.metadata ?? null,
    }))).toEqual([
      {
        id: 'edge_a_b',
        source: 'card_a',
        target: 'card_b',
        edgeType: 'flow',
        metadata: {
          role: 'graph_execution',
          executionMode: 'conditional',
          conditionType: null,
          conditionExpression: 'blackboard.store.stale === true',
          conditionLabel: 'Only when research is stale',
          priority: 2,
          order: null,
          weight: null,
          mergeIntent: 'summarize_all',
          legacyCompatibility: null,
        },
      },
      {
        id: 'edge_a_c',
        source: 'card_a',
        target: 'card_c',
        edgeType: 'flow',
        metadata: {
          role: 'graph_execution',
          executionMode: 'optional',
          conditionType: null,
          conditionExpression: null,
          conditionLabel: null,
          priority: null,
          order: 1,
          weight: null,
          mergeIntent: null,
          legacyCompatibility: true,
        },
      },
    ]);
  });

  it('round-trips real restored research cards with saved branch and recombine topology intact', () => {
    const savedDeck: DeckDocument = {
      ...JSON.parse(JSON.stringify(INITIAL_DECK)),
      version: 2,
    };

    const loaded = resolveProjectDeckPayload(savedDeck);
    const rehydrated = hydrateDeckDocument(JSON.parse(JSON.stringify(loaded.deck)));

    expect(loaded.usedFallback).toBe(false);
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

  it('uses the restored real-agent seed only for true empty-state deck loads', () => {
    const loaded = resolveProjectDeckPayload(null);

    expect(loaded.usedFallback).toBe(true);
    expect(loaded.deck.nodes.map((node) => node.title)).toEqual(INITIAL_DECK.nodes.map((node) => node.title));
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

    expect(loaded.usedFallback).toBe(false);
    expect(loaded.deck.nodes.map((node) => node.id)).toEqual(['card_magentic']);
    expect(loaded.deck.edges).toEqual([]);
  });

  it('upgrades the older saved deck_builder system deck to the current Agent Canvas seed', () => {
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

    const hydrated = hydrateDeckDocument(legacyDeck);

    expect(hydrated.nodes.map((node) => node.id)).toEqual([
      'card_main_chat',
      'card_magentic',
      'card_research_agent',
      'card_local_coder',
      'card_openai_coder',
      'card_hermes_steward',
      'card_trading_workbench',
      'card_worldsignals_agent',
    ]);
    expect(hydrated.edges).toEqual([
      expect.objectContaining({
        id: 'edge_openai_coder_magentic_bus',
        source: 'card_openai_coder',
        target: 'card_magentic',
        edgeType: 'magentic_option',
      }),
    ]);
    expect(hydrated.nodes.find((node) => node.id === 'card_magentic')?.runtimeOptions).toMatchObject({
      executionBackend: 'python_autogen',
      provider: 'openrouter',
      modelKey: 'openai/gpt-5.6-terra',
    });
  });

  it('migrates only the exact retired Magentic-One GLM seed default', () => {
    const retiredDefault = JSON.parse(JSON.stringify(INITIAL_DECK)) as DeckDocument;
    const retiredMagentic = retiredDefault.nodes.find((node) => node.id === 'card_magentic');
    if (!retiredMagentic) throw new Error('seed_magentic_missing');
    retiredMagentic.runtimeOptions = {
      executionBackend: 'python_autogen',
      provider: 'openrouter',
      modelKey: 'z-ai/glm-5.2',
      maxTurns: 2,
      maxStalls: 1,
    };

    const migrated = hydrateDeckDocument(retiredDefault);
    expect(migrated.nodes.find((node) => node.id === 'card_magentic')?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'openai/gpt-5.6-terra',
    });

    retiredMagentic.runtimeOptions.maxTurns = 3;
    const intentionallyConfigured = hydrateDeckDocument(retiredDefault);
    expect(intentionallyConfigured.nodes.find((node) => node.id === 'card_magentic')?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'z-ai/glm-5.2',
      maxTurns: 3,
    });
  });

  it('migrates stale system-card grants once without changing saved card presentation or wiring', () => {
    const stale = JSON.parse(JSON.stringify(INITIAL_DECK)) as DeckDocument;
    stale.version = 77;
    delete stale.systemToolGrantsVersion;
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
      tools: ['hermes.memory_read', 'graphiti.clear_graph'],
    };
    const savedEdges = JSON.parse(JSON.stringify(stale.edges));

    const migrated = hydrateDeckDocument(stale);
    const migratedMain = migrated.nodes.find((node) => node.id === 'card_main_chat');
    const migratedCoder = migrated.nodes.find((node) => node.id === 'card_local_coder');
    const migratedHermes = migrated.nodes.find((node) => node.id === 'card_hermes_steward');

    expect(migrated.version).toBe(77);
    expect(migrated.systemToolGrantsVersion).toBe(SYSTEM_TOOL_GRANTS_VERSION);
    expect(migratedMain?.runtimeOptions?.tools).toEqual([...MAIN_CHAT_CONTROLLER_TOOLS]);
    expect(migratedCoder?.runtimeOptions?.tools).toEqual([...LOCAL_CODER_CONTROLLER_TOOLS]);
    expect(migratedHermes?.runtimeOptions?.tools).toEqual([...HERMES_STEWARD_TOOLS]);
    expect(migratedMain).toMatchObject({
      prompt: 'Saved Main prompt',
      position: { x: 111, y: 222 },
      runtimeOptions: {
        provider: 'openrouter',
        modelKey: 'saved-main-model',
      },
    });
    expect(migratedCoder?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'saved-coder-model',
    });
    expect(migratedHermes?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'saved-hermes-model',
    });
    expect(migrated.edges).toMatchObject(savedEdges);

    if (!migratedMain) throw new Error('migrated_main_missing');
    migratedMain.runtimeOptions = {
      ...migratedMain.runtimeOptions,
      tools: ['custom.saved.tool'],
    };
    expect(
      hydrateDeckDocument(migrated).nodes.find((node) => node.id === 'card_main_chat')
        ?.runtimeOptions?.tools,
    ).toEqual(['custom.saved.tool']);
  });

  it('drops the retired generic Code-workbench card and prompt from saved decks', () => {
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
    const hydrated = hydrateDeckDocument({
      ...INITIAL_DECK,
      nodes: [...INITIAL_DECK.nodes, retiredCodeCard],
      promptTemplates: [
        ...INITIAL_DECK.promptTemplates,
        { id: 'prompt_code_workbench', content: 'retired' },
      ],
    });

    expect(hydrated.nodes.map((node) => node.id)).not.toContain('card_code_workbench');
    expect(hydrated.promptTemplates.map((template) => template.id)).not.toContain('prompt_code_workbench');
  });

  it('preserves the current deck on project load failure instead of silently replacing it with fallback', () => {
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

    const failed = resolveProjectDeckLoadResult(currentDeck, null, true);

    expect(failed.preservedCurrent).toBe(true);
    expect(failed.usedFallback).toBe(false);
    expect(failed.deck.nodes.map((node) => node.title)).toEqual(['Current A']);
  });

  it('does not re-seed fallback edges into a real deck that saved with no edges', () => {
    const hydrated = hydrateDeckDocument({
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

  it('loads legacy edges without inventing edge metadata', () => {
    const hydrated = hydrateDeckDocument({
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
        sourceHandle: null,
        target: 'card_b',
        targetHandle: null,
        edgeType: 'flow',
      },
    ]);
    expect(hydrated.edges[0]?.metadata).toBeUndefined();
  });

  it('does not seed fallback chain edges into partial saved decks that already provide real cards', () => {
    const hydrated = hydrateDeckDocument({
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
    const rehydrated = hydrateDeckDocument(JSON.parse(JSON.stringify(loaded.deck)));

    expect(loaded.usedFallback).toBe(false);
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

    const rehydrated = hydrateDeckDocument(JSON.parse(JSON.stringify(savedDeck)));

    expect(rehydrated.edges.map((edge) => edge.id)).toEqual(['edge_call', 'edge_typo']);
    expect(rehydrated.edges.find((edge) => edge.id === 'edge_call')?.edgeType).toBe('flow');
    expect(rehydrated.edges.find((edge) => edge.id === 'edge_typo')?.edgeType).toBe('invalid');
  });

  it('does not let fallback override real saved edge metadata', () => {
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Saved Metadata Deck',
      promptTemplates: [],
      version: 2,
      nodes: [
        createCard('card_saved_a', 'assistant_agent', { title: 'Saved A' }),
        createCard('card_saved_b', 'assistant_agent', { title: 'Saved B' }),
      ],
      edges: [
        {
          id: 'edge_saved_a_b',
          source: 'card_saved_a',
          target: 'card_saved_b',
          edgeType: 'flow',
          metadata: {
            role: 'graph_execution',
            executionMode: 'optional',
            mergeIntent: 'any_input',
          },
        },
      ],
    };

    const loaded = resolveProjectDeckPayload(savedDeck);

    expect(loaded.usedFallback).toBe(false);
    expect(loaded.deck.edges[0]?.metadata).toMatchObject({
      role: 'graph_execution',
      executionMode: 'optional',
      mergeIntent: 'any_input',
    });
  });

  it('preserves advanced runtime options when hydrating saved legacy cards', () => {
    const hydrated = hydrateDeckDocument({
      id: 'deck_builder',
      name: 'Autogen Deck',
      version: 1,
      promptTemplates: [],
      nodes: [
        // deliberately a RETIRED runtime type outside the current union
        createCard('card_selector', 'selector' as unknown as AgentCardInstance['runtimeType'], {
          templateId: 'template_selector',
          title: 'Selector Head',
          runtimeOptions: {
            provider: 'openai',
            modelKey: 'gpt-5-mini',
            emitTeamEvents: true,
            selectorPrompt: 'Pick the best worker.',
            allowRepeatedSpeaker: false,
          },
        }),
      ],
      edges: [],
    });

    expect(hydrated.nodes[0]?.runtimeOptions).toMatchObject({
      provider: 'openai',
      modelKey: 'gpt-5-mini',
      emitTeamEvents: true,
      selectorPrompt: 'Pick the best worker.',
      allowRepeatedSpeaker: false,
    });
  });

});
