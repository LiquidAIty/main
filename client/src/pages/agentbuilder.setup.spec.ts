// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument, DeckRun, DeckRuntimeEvent, RuntimeBinding } from '../types/agentgraph';
// Deck logic moved out of the page in the 2026-07-08 decomposition; the spec
// tests the real modules directly.
import { INITIAL_DECK } from '../features/agentbuilder/deck/deckSeed';
import {
  buildSingleCardRunDocument,
  hydrateDeckDocument,
  resolveProjectDeckLoadResult,
  resolveProjectDeckPayload,
} from '../features/agentbuilder/deck/deckDocument';
import {
  buildDeckRuntimeVisualState,
  buildReloadStateFromDeckRuns,
} from '../components/builder/deckRunState';

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
      'Hermes',
      'Trading Agent',
      'WorldSignals Agent',
    ]);

    expect(INITIAL_DECK.nodes.filter((node) => node.runtimeType === 'graph_flow')).toEqual([]);
    expect(INITIAL_DECK.nodes.map((node) => node.runtimeBinding)).toEqual([
      'main_chat',
      null,
      'research_agent',
      'local_coder',
      'hermes_steward',
      'trading_agent',
      'worldsignals_agent',
    ]);
    expect(INITIAL_DECK.nodes.map((node) => node.templateId)).toEqual([
      'template_main_chat',
      'template_magentic',
      'template_research_agent',
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
        source: 'card_magentic',
        target: 'card_local_coder',
        edgeType: 'magentic_option',
      },
      {
        source: 'card_magentic',
        target: 'card_research_agent',
        edgeType: 'magentic_option',
      },
      {
        source: 'card_magentic',
        target: 'card_worldsignals_agent',
        edgeType: 'magentic_option',
      },
    ]);
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
      'card_hermes_steward',
      'card_trading_workbench',
      'card_worldsignals_agent',
    ]);
    expect(hydrated.edges).toEqual([]);
    expect(hydrated.nodes.find((node) => node.id === 'card_magentic')?.runtimeOptions).toMatchObject({
      executionBackend: 'python_autogen',
      provider: 'openrouter',
      modelKey: 'openai/gpt-5.1-chat',
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
      modelKey: 'openai/gpt-5.1-chat',
    });

    retiredMagentic.runtimeOptions.maxTurns = 3;
    const intentionallyConfigured = hydrateDeckDocument(retiredDefault);
    expect(intentionallyConfigured.nodes.find((node) => node.id === 'card_magentic')?.runtimeOptions).toMatchObject({
      provider: 'openrouter',
      modelKey: 'z-ai/glm-5.2',
      maxTurns: 3,
    });
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
  // did not fit the graph_flow/parentGraphId model — real user intent, deleted on
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

  // A selected-card run scopes to EXACTLY the selected card. The backend gate
  // (isSingleAssistRunDocument) accepts one top-level node and refuses any
  // document carrying the Mag One card, so the old flow-traversal scope
  // (which shipped the whole downstream chain) produced documents the route
  // rejected. Identity/prompt/model/tools still resolve server-side from the
  // SAVED deck — this document only names the card.
  it('scopes a selected-card run to exactly the selected card', () => {
    const magentic = createCard('magentic', 'magentic_one');
    const assistA = createCard('assist_a', 'assistant_agent');
    const assistB = createCard('assist_b', 'assistant_agent');

    const document: DeckDocument = {
      ...createDeck([magentic, assistA, assistB]),
      edges: [
        { id: 'edge_magentic_assist', source: magentic.id, target: assistA.id, edgeType: 'magentic_option' },
        { id: 'edge_assist_chain', source: assistA.id, target: assistB.id, edgeType: 'flow' },
      ],
    };

    const assistRunDocument = buildSingleCardRunDocument(document, assistA.id);

    expect(assistRunDocument?.nodes.map((node) => node.id)).toEqual(['assist_a']);
    expect(assistRunDocument?.edges).toEqual([]);
    expect(buildSingleCardRunDocument(document, 'missing_card')).toBeNull();
  });

  it('hydrates reload-time chat without turning ordinary run history into a plan', () => {
    const latestRun: DeckRun = {
      id: 'deck_run_latest',
      deckId: 'deck_builder',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: '2026-04-10T00:00:05.000Z',
      status: 'success',
      input: 'Map the next move',
      steps: [
        {
          id: 'step_1',
          executionId: 'card_magentic::single',
          cardId: 'card_magentic',
          templateId: 'template_magentic',
          title: 'Magentic-One',
          input: 'Map the next move',
          effectiveAgent: { id: 'template_magentic', name: 'Magentic-One', tools: [] },
          output: 'Here is the next move.',
          status: 'success',
          startedAt: '2026-04-10T00:00:00.000Z',
          endedAt: '2026-04-10T00:00:05.000Z',
          outputSummary: 'Here is the next move.',
        },
      ],
      validationSummary: {
        ok: true,
        errors: [],
        warnings: [],
      },
      events: [
        {
          id: 'evt_latest',
          at: '2026-04-10T00:00:01.000Z',
          kind: 'magentic_assignment',
          cardId: 'card_magentic',
          cardTitle: 'Magentic-One',
          runtimeType: 'magentic_one',
          text: 'Magentic-One assigned work to Main Chat.',
          progressText: 'Goal: map the next move. Next: calling Main Chat because it is the visible reply node.',
          status: 'running',
        },
      ],
    };

    const continuity = buildReloadStateFromDeckRuns([latestRun], latestRun);

    expect(continuity.messages).toEqual([
      { role: 'user', text: 'Map the next move' },
      { role: 'assistant', text: 'Here is the next move.' },
    ]);
    // planSource/plan fields no longer exist on the reload state — the plan
    // projection went with the mission/Run-Task purge; links is the survivor.
    expect(continuity.links ?? []).toEqual([]);
  });

  it('derives live runtime visuals from streamed deck events only', () => {
    const events: DeckRuntimeEvent[] = [
      {
        id: 'evt_1',
        at: '2026-04-10T00:00:00.000Z',
        kind: 'step_started',
        cardId: 'assist_a',
        cardTitle: 'Assist A',
        runtimeType: 'assistant_agent',
        edgeIds: ['edge_a_b'],
        notes: ['Merged upstream outputs for Assist A.'],
        text: 'Assist A started.',
        status: 'running',
      },
      {
        id: 'evt_2',
        at: '2026-04-10T00:00:01.000Z',
        kind: 'magentic_assignment',
        cardId: 'magentic',
        cardTitle: 'Magentic-One',
        runtimeType: 'magentic_one',
        edgeIds: ['edge_magentic_assist'],
        text: 'Magentic-One assigned work to Assist A.',
        status: 'running',
      },
      {
        id: 'evt_3',
        at: '2026-04-10T00:00:01.500Z',
        kind: 'message',
        type: 'message',
        cardId: 'assist_a',
        cardTitle: 'Assist A',
        runtimeType: 'assistant_agent',
        role: 'assistant',
        content: 'Actual assistant message from Assist A.',
      },
      {
        id: 'evt_4',
        at: '2026-04-10T00:00:02.000Z',
        kind: 'swarm_progress',
        cardId: 'assist_a',
        cardTitle: 'Assist A',
        runtimeType: 'assistant_agent',
        text: 'Assist A swarm worker 2 of 5 completed.',
        completedWorkers: 2,
        totalWorkers: 5,
        status: 'running',
      },
      {
        id: 'evt_5',
        at: '2026-04-10T00:00:03.000Z',
        kind: 'step_completed',
        cardId: 'assist_a',
        cardTitle: 'Assist A',
        runtimeType: 'assistant_agent',
        edgeIds: ['edge_a_b'],
        text: 'Assist A completed.',
        outputSummary: 'Prepared the next research summary.',
        status: 'success',
      },
      {
        id: 'evt_6',
        at: '2026-04-10T00:00:04.000Z',
        kind: 'run_completed',
        text: 'Deck Admin completed.',
        status: 'success',
      },
    ];

    // Card/edge activity is the ONLY visual state the canvas consumes (the
    // runtime glow); the run completed, so nothing is left active.
    expect(buildDeckRuntimeVisualState(events)).toEqual({
      activeCardIds: [],
      activeEdgeIds: [],
    });

    // Mid-run (before completion events) the started card and its edges glow.
    expect(buildDeckRuntimeVisualState(events.slice(0, 4))).toEqual({
      activeCardIds: ['assist_a'],
      activeEdgeIds: ['edge_a_b', 'edge_magentic_assist'],
    });
  });
});
