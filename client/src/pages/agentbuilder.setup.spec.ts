// @vitest-environment jsdom

/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Agent Builder
 * Relationship: This file verifies Agent Builder hydrates canonical saved decks without merging browser-owned Project defaults.
 * Entity: Saved Cards
 * Relationship: This file verifies hydration preserves exact Cards, prompts, revisions, provider/model choices, and optional Card deletion.
 * Entity: Card Topology
 * Relationship: This file verifies hydration preserves every saved orange, blue, or unrecognized edge without inventing a template chain.
 * Entity: Card Profiles
 * Relationship: This file verifies each saved Card retains its one explicit runtime mode and stable profile identity through browser hydration.
 * Entity: Tool Catalog
 * Relationship: This file verifies saved tool grants remain byte-for-byte authoritative and are never replaced by browser defaults.
 */

import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, CardRuntime, DeckDocument } from '../types/agentgraph';
// Deck logic moved out of the page in the 2026-07-08 decomposition; the spec
// tests the real modules directly.
import { PROJECTLESS_DECK } from '../features/agentbuilder/deck/newProjectDeck';
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

function savedSystemDeck(): DeckDocument {
  return {
    id: 'deck_builder',
    name: 'Saved System Deck',
    promptTemplates: [
      { id: 'prompt_main', content: 'Saved Main prompt' },
      { id: 'prompt_builder', content: 'Saved Builder prompt' },
    ],
    version: PROJECTLESS_DECK.version,
    nodes: [
      createCard('card_main_chat', { kind: 'hermes', mode: 'main', profile: 'main' }, {
        templateId: 'template_main_chat',
        title: 'Main',
        runtimeOptions: { provider: 'openai', modelKey: 'main-model', tools: ['canvas.inspect'] },
      }),
      createCard('builder', { kind: 'hermes', mode: 'delegate', profile: 'builder' }, {
        templateId: 'template_assist',
        title: 'Builder',
        runtimeOptions: { provider: 'openai', modelKey: 'builder-model', tools: ['cbm.search_graph'] },
      }),
      createCard('card_magentic', {
        kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic',
      }, {
        templateId: 'template_magentic',
        title: 'Magnetic',
      }),
      createCard('card_knowgraph', {
        kind: 'hermes', mode: 'delegate', profile: 'knowgraph',
      }, {
        templateId: 'template_knowgraph',
        title: 'KnowGraph',
        runtimeOptions: { provider: 'openai', modelKey: 'know-model', tools: ['graphiti.search_nodes'] },
      }),
      createCard('card_trading_workbench', {
        kind: 'hermes', mode: 'delegate', profile: 'trading',
      }, {
        templateId: 'template_trading_workbench',
        title: 'Trading',
      }),
      createCard('card_worldsignals_agent', {
        kind: 'hermes', mode: 'delegate', profile: 'worldsignals',
      }, {
        templateId: 'template_worldsignals_agent',
        title: 'WorldSignals',
      }),
    ],
    edges: [
      {
        id: 'edge_main_builder',
        source: 'card_main_chat',
        target: 'builder',
        edgeType: 'flow',
      },
      {
        id: 'edge_worldsignals_magnetic',
        source: 'card_worldsignals_agent',
        target: 'card_magentic',
        edgeType: 'magentic_option',
      },
      {
        id: 'edge_magnetic_trading',
        source: 'card_magentic',
        target: 'card_trading_workbench',
        edgeType: 'magentic_option',
      },
    ],
  };
}

describe('agentbuilder authoring flow', () => {
  it('does not manufacture Delegate authority from a Card id or template', () => {
    const deck = createDeck([
      createCard('card_test_delegate', {
        kind: 'hermes', mode: 'delegate', profile: 'card_test_delegate',
      }, {
        templateId: 'template_assist',
        runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.6-luna' },
      }),
    ]);

    const loaded = readDeckDocument(deck);
    expect(loaded.nodes[0]?.runtime).toEqual({
      kind: 'hermes', mode: 'delegate', profile: 'card_test_delegate',
    });
  });

  it('loads a real saved deck and preserves its visible chain', () => {
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Saved Deck',
      promptTemplates: [],
      version: PROJECTLESS_DECK.version,
      nodes: [
        createCard('card_saved_a', { kind: 'hermes', mode: 'main', profile: 'saved-main' }, {
          templateId: 'template_main_chat',
          title: 'Saved A',
        }),
        createCard('card_saved_b', {
          kind: 'hermes', mode: 'delegate', profile: 'card_saved_b',
        }, {
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

  it('keeps a Card profile in the one explicit runtime identity', () => {
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
    const original = savedSystemDeck();
    const savedDeck: DeckDocument = {
      ...structuredClone(original),
      version: 2,
    };

    const loaded = resolveProjectDeckPayload(savedDeck);
    const rehydrated = readDeckDocument(JSON.parse(JSON.stringify(loaded.deck)));

    expect(rehydrated.nodes.map((node) => node.title)).toEqual(
      original.nodes.map((node) => node.title),
    );
    expect(rehydrated.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    }))).toEqual(original.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    })));
  });

  it('fails a missing saved deck instead of silently seeding one during load', () => {
    expect(() => resolveProjectDeckPayload(null)).toThrow('deck_not_found');
  });

  it('treats trimmed saved system decks as real saved state instead of fallback display mode', () => {
    const orchestratorNode = savedSystemDeck().nodes.find(
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
          title: 'Magnetic',
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
        createCard('card_main_chat', { kind: 'hermes', mode: 'main', profile: 'main' }, {
          templateId: 'template_main_chat',
          title: 'Main Chat',
        }),
        createCard('card_kg_ingest', {
          kind: 'hermes', mode: 'delegate', profile: 'card_kg_ingest',
        }, {
          templateId: 'template_kg_ingest',
          title: 'KG Ingest / ThinkGraph',
        }),
        createCard('card_research', {
          kind: 'hermes', mode: 'delegate', profile: 'card_research',
        }, {
          templateId: 'template_research',
          title: 'Research Agent',
        }),
        createCard('card_knowgraph', {
          kind: 'hermes', mode: 'delegate', profile: 'card_knowgraph',
        }, {
          templateId: 'template_knowgraph',
          title: 'KnowGraph',
        }),
        createCard('card_neo4j', {
          kind: 'hermes', mode: 'delegate', profile: 'card_neo4j',
        }, {
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
    const stale = structuredClone(savedSystemDeck());
    stale.version = 77;
    const main = stale.nodes.find((node) => node.id === 'card_main_chat');
    const builder = stale.nodes.find((node) => node.id === 'builder');
    const knowgraph = stale.nodes.find((node) => node.id === 'card_knowgraph');
    if (!main || !builder || !knowgraph) throw new Error('system_cards_missing');
    main.prompt = 'Saved Main prompt';
    main.position = { x: 111, y: 222 };
    main.runtimeOptions = {
      ...main.runtimeOptions,
      provider: 'openrouter',
      modelKey: 'saved-main-model',
      tools: ['engraphis_remember'],
    };
    builder.runtimeOptions = {
      ...builder.runtimeOptions,
      provider: 'openrouter',
      modelKey: 'saved-builder-model',
      tools: ['cbm.delete_project'],
    };
    knowgraph.runtimeOptions = {
      ...knowgraph.runtimeOptions,
      provider: 'openrouter',
      modelKey: 'saved-card-model',
      tools: ['clear_graph'],
    };
    const savedEdges = JSON.parse(JSON.stringify(stale.edges));

    const hydrated = readDeckDocument(stale);
    const hydratedMain = hydrated.nodes.find((node) => node.id === 'card_main_chat');
    const hydratedBuilder = hydrated.nodes.find((node) => node.id === 'builder');
    const hydratedKnowgraph = hydrated.nodes.find((node) => node.id === 'card_knowgraph');

    expect(hydrated.version).toBe(77);
    expect(hydratedMain?.runtimeOptions?.tools).toEqual(['engraphis_remember']);
    expect(hydratedBuilder?.runtimeOptions?.tools).toEqual(['cbm.delete_project']);
    expect(hydratedKnowgraph?.runtimeOptions?.tools).toEqual(['clear_graph']);
    expect(hydratedMain).toMatchObject({
      prompt: 'Saved Main prompt',
      position: { x: 111, y: 222 },
      runtimeOptions: {
        provider: 'openrouter',
        modelKey: 'saved-main-model',
      },
    });
    expect(hydratedBuilder?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'saved-builder-model',
    });
    expect(hydratedKnowgraph?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'saved-card-model',
    });
    expect(hydrated.edges).toMatchObject(savedEdges);
  });

  it('preserves saved cards and prompts instead of applying hidden tombstones', () => {
    const retiredCodeCard: AgentCardInstance = {
      id: 'card_code_workbench',
      kind: 'agent',
      templateId: 'template_code_workbench',
      prompt: 'retired',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'card_code_workbench' },
      runtimeOptions: null,
      parentGraphId: 'workbench_code',
      title: 'Code Agent',
      position: { x: 0, y: 0 },
    };
    const saved = savedSystemDeck();
    const hydrated = readDeckDocument({
      ...saved,
      nodes: [...saved.nodes, retiredCodeCard],
      promptTemplates: [
        ...saved.promptTemplates,
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
        createCard('card_a', { kind: 'hermes', mode: 'delegate', profile: 'card_a' }, { title: 'A' }),
        createCard('card_b', { kind: 'hermes', mode: 'delegate', profile: 'card_b' }, { title: 'B' }),
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
        createCard('card_custom_research', {
          kind: 'hermes', mode: 'delegate', profile: 'card_custom_research',
        }, {
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
    const saved = savedSystemDeck();
    const trimmedSavedDeck: DeckDocument = {
      ...structuredClone(saved),
      version: 5,
      nodes: saved.nodes.filter(
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
        createCard('card_a', { kind: 'hermes', mode: 'delegate', profile: 'card_a' }, { title: 'A' }),
        createCard('card_b', { kind: 'hermes', mode: 'delegate', profile: 'card_b' }, { title: 'B' }),
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
