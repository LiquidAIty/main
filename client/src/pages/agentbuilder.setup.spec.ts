import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument, DeckRun, DeckRuntimeEvent } from '../types/agentgraph';
import {
  buildQuickAddDeckMutation,
  buildSingleCardRunDocument,
  filterAuthoringCompatibleEdges,
  hydrateDeckDocument,
  INITIAL_DECK,
  resolveProjectDeckLoadResult,
  resolveProjectDeckPayload,
} from './agentbuilder';
import {
  buildDeckRuntimeVisualState,
  buildReloadStateFromDeckRuns,
} from '../components/builder/deckRunState';
import { findDeckNodePreset, getDeckQuickAddActions } from '../components/builder/deckPresets';
import { buildExecutionPlan } from '../components/builder/deckExecution';

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
  it('surfaces contextual quick-add actions for the current runtime model', () => {
    expect(getDeckQuickAddActions(null)).toEqual([]);
    expect(getDeckQuickAddActions(createCard('card_magentic', 'magentic_one'))).toEqual([]);
    expect(getDeckQuickAddActions(createCard('card_graph', 'graph_flow'))).toEqual([]);
    expect(
      getDeckQuickAddActions(createCard('card_graph_step_1', 'assistant_agent', { parentGraphId: 'card_graph' })),
    ).toEqual([]);
    expect(getDeckQuickAddActions(createCard('card_assist', 'assistant_agent'))).toEqual([]);
  });

  it('creates top-level Assist and Local Coder cards from project-level quick add presets', () => {
    const assistPreset = findDeckNodePreset('assist');
    const localCoderPreset = findDeckNodePreset('local_coder');
    if (!assistPreset || !localCoderPreset) {
      throw new Error('missing_presets');
    }

    const emptyDeck = createDeck([]);
    const assistMutation = buildQuickAddDeckMutation(emptyDeck, assistPreset, null);
    const localCoderMutation = buildQuickAddDeckMutation(emptyDeck, localCoderPreset, null);

    expect(assistMutation.nextNode.runtimeType).toBe('assistant_agent');
    expect(assistMutation.nextNode.runtimeBinding).toBe('assist');
    expect(assistMutation.nextNode.parentGraphId).toBeNull();
    expect(assistMutation.nextEdge).toBeNull();

    expect(localCoderMutation.nextNode.runtimeType).toBe('local_coder');
    expect(localCoderMutation.nextNode.runtimeBinding).toBe('local_coder');
    expect(localCoderMutation.nextNode.parentGraphId).toBeNull();
    expect(localCoderMutation.nextEdge).toBeNull();
  });

  it('creates blue callable edges from Magentic to top-level Assist heads', () => {
    const magentic = createCard('card_magentic', 'magentic_one');
    const deck = createDeck([magentic]);
    const assistPreset = findDeckNodePreset('assist');
    if (!assistPreset) {
      throw new Error('missing_presets');
    }

    const assistMutation = buildQuickAddDeckMutation(deck, assistPreset, magentic.id);

    expect(assistMutation.nextNode.parentGraphId).toBeNull();
    expect(assistMutation.nextEdge?.edgeType).toBe('magentic_option');
    expect(assistMutation.nextEdge?.source).toBe(magentic.id);
    expect(assistMutation.nextEdge?.target).toBe(assistMutation.nextNode.id);
    expect(assistMutation.nextEdge?.metadata).toMatchObject({
      role: 'callable_route',
      legacyCompatibility: null,
    });
  });

  it('keeps the compatibility workflow path available when an existing graph card is selected', () => {
    const graph = createCard('card_graph', 'graph_flow');
    const deck = createDeck([graph]);
    const assistPreset = findDeckNodePreset('assist');
    if (!assistPreset) {
      throw new Error('missing_assist_preset');
    }

    const firstStepMutation = buildQuickAddDeckMutation(deck, assistPreset, graph.id);

    expect(firstStepMutation.nextNode.runtimeType).toBe('assistant_agent');
    expect(firstStepMutation.nextNode.parentGraphId).toBe(graph.id);
    expect(firstStepMutation.nextNode.title).toBe('Assist 1');
    expect(firstStepMutation.nextEdge).toBeNull();

    const secondStepMutation = buildQuickAddDeckMutation(
      firstStepMutation.nextDeck,
      assistPreset,
      firstStepMutation.nextNode.id,
    );

    expect(secondStepMutation.nextNode.parentGraphId).toBe(graph.id);
    expect(secondStepMutation.nextNode.title).toBe('Assist 2');
    expect(secondStepMutation.nextEdge?.edgeType).toBe('flow');
    expect(secondStepMutation.nextEdge?.source).toBe(firstStepMutation.nextNode.id);
    expect(secondStepMutation.nextEdge?.target).toBe(secondStepMutation.nextNode.id);
    expect(secondStepMutation.nextEdge?.metadata).toMatchObject({
      role: 'graph_execution',
      executionMode: 'required',
      legacyCompatibility: true,
    });
  });

  it('creates top-level Assist workflow steps with orange execution edges', () => {
    const assist = createCard('card_assist', 'assistant_agent');
    const deck = createDeck([assist]);
    const assistPreset = findDeckNodePreset('assist');
    if (!assistPreset) {
      throw new Error('missing_assist_preset');
    }

    const nextAssistMutation = buildQuickAddDeckMutation(deck, assistPreset, assist.id);

    expect(nextAssistMutation.nextNode.runtimeType).toBe('assistant_agent');
    expect(nextAssistMutation.nextNode.parentGraphId).toBeNull();
    expect(nextAssistMutation.nextEdge?.edgeType).toBe('flow');
    expect(nextAssistMutation.nextEdge?.source).toBe(assist.id);
    expect(nextAssistMutation.nextEdge?.target).toBe(nextAssistMutation.nextNode.id);
    expect(nextAssistMutation.nextEdge?.metadata).toMatchObject({
      role: 'graph_execution',
      executionMode: 'required',
      legacyCompatibility: null,
    });
  });

  it('keeps top-level execution truth separate from graph-owned internal steps', () => {
    const magentic = createCard('card_magentic', 'magentic_one');
    const graph = createCard('card_graph', 'graph_flow');
    const graphStep = createCard('card_graph_step_1', 'assistant_agent', {
      parentGraphId: graph.id,
      title: 'Assist 1',
    });
    const deck: DeckDocument = {
      ...createDeck([magentic, graph, graphStep]),
      edges: [
        { id: 'edge_magentic_graph', source: magentic.id, target: graph.id, edgeType: 'magentic_option' },
      ],
    };

    const executionPlan = buildExecutionPlan(deck);
    expect(executionPlan.startCardIds).toEqual(['card_magentic']);
    expect(executionPlan.simpleOrderCardIds).toEqual(['card_magentic']);
  });

  it('ships the default example using the real magentic-led agent graph', () => {
    expect(INITIAL_DECK.nodes.map((node) => node.title)).toEqual([
      'Magentic-One',
      'ThinkGraph Agent',
      'CodeGraph Agent',
      'Research Agent',
      'KnowGraph Agent',
      'NRGSim / Energy',
      'Local Coder',
      'Trading Agent',
      'Image Maker Agent',
      'Code Agent',
      'Video Agent',
      'Data Formulator',
      'Telescope Agent',
      'Plan Agent',
      'WorldSignals Agent',
      'Understand Anything',
    ]);

    expect(INITIAL_DECK.nodes.filter((node) => node.runtimeType === 'graph_flow')).toEqual([]);
    expect(INITIAL_DECK.nodes.map((node) => node.runtimeBinding)).toEqual([
      null,
      'thinkgraph_agent',
      'codegraph_agent',
      'research_agent',
      'knowgraph_agent',
      'energy_agent',
      'local_coder',
      'trading_agent',
      'image_agent',
      'code_agent',
      'video_agent',
      'data_formulator_agent',
      'telescope_agent',
      'plan_agent',
      'worldsignals_agent',
      'assist',
    ]);
    expect(INITIAL_DECK.nodes.map((node) => node.templateId)).toEqual([
      'template_magentic',
      'template_thinkgraph_agent',
      'template_codegraph_agent',
      'template_research_agent',
      'template_knowgraph_agent',
      'template_energy_workbench',
      'template_local_coder',
      'template_trading_workbench',
      'template_image_workbench',
      'template_code_workbench',
      'template_video_workbench',
      'template_data_formulator_workbench',
      'template_telescope_agent',
      'template_plan_agent',
      'template_worldsignals_agent',
      'template_understand_anything_workbench',
    ]);

    expect(INITIAL_DECK.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    }))).toEqual([]);
  });

  it('prefers a real saved deck over the fallback seed and preserves its visible chain', () => {
    const savedDeck: DeckDocument = {
      id: 'deck_builder',
      name: 'Saved Deck',
      promptTemplates: [],
      version: 2,
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
    expect(loaded.deck.nodes.map((node) => node.title)).toEqual([
      'Saved A',
      'Saved B',
      'NRGSim / Energy',
      'Local Coder',
      'Trading Agent',
      'Image Maker Agent',
      'Code Agent',
      'Video Agent',
      'Data Formulator',
      'Telescope Agent',
      'Plan Agent',
      'WorldSignals Agent',
      'Understand Anything',
      'Magentic-One',
    ]);
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
    expect(loaded.displayFallbackOnly).toBe(false);
    expect(loaded.deck.nodes.map((node) => node.title)).toEqual(INITIAL_DECK.nodes.map((node) => node.title));
  });

  it('uses the canonical chain only as a display fallback for truncated saved system decks', () => {
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

    expect(loaded.usedFallback).toBe(true);
    expect(loaded.displayFallbackOnly).toBe(true);
    expect(loaded.deck.nodes.map((node) => node.id)).toEqual(INITIAL_DECK.nodes.map((node) => node.id));
    expect(
      loaded.deck.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        edgeType: edge.edgeType ?? null,
      })),
    ).toEqual(
      INITIAL_DECK.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        edgeType: edge.edgeType ?? null,
      })),
    );
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
        createCard('card_kg_ingest', 'assistant_agent', {
          templateId: 'template_kg_ingest',
          runtimeBinding: 'kg_ingest',
          title: 'KG Ingest / ThinkGraph',
        }),
        createCard('card_research', 'assistant_agent', {
          templateId: 'template_research',
          runtimeBinding: 'research_agent',
          title: 'Research Agent',
        }),
        createCard('card_knowgraph', 'assistant_agent', {
          templateId: 'template_knowgraph',
          runtimeBinding: 'knowgraph',
          title: 'KnowGraph',
        }),
        createCard('card_neo4j', 'assistant_agent', {
          templateId: 'template_neo4j',
          runtimeBinding: 'neo4j',
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
      'card_kg_ingest',
      'card_research',
      'card_knowgraph',
      'card_neo4j',
      'card_energy_workbench',
      'card_local_coder',
      'card_trading_workbench',
      'card_image_workbench',
      'card_code_workbench',
      'card_video_workbench',
      'card_data_formulator_workbench',
      'card_telescope_agent',
      'card_plan_agent',
      'card_worldsignals_agent',
      'card_understand_anything',
      'card_magentic',
    ]);
    expect(hydrated.edges.map((edge) => [edge.source, edge.target, edge.edgeType])).toEqual([
      ['card_main_chat', 'card_kg_ingest', 'flow'],
    ]);
    expect(hydrated.nodes.find((node) => node.id === 'card_magentic')?.runtimeOptions).toMatchObject({
      executionBackend: 'python_autogen',
      provider: 'openai',
      modelKey: 'gpt-5.1-chat-latest',
    });
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

    expect(hydrated.nodes.map((node) => node.title)).toEqual([
      'Lonely',
      'NRGSim / Energy',
      'Local Coder',
      'Trading Agent',
      'Image Maker Agent',
      'Code Agent',
      'Video Agent',
      'Data Formulator',
      'Telescope Agent',
      'Plan Agent',
      'WorldSignals Agent',
      'Understand Anything',
      'Magentic-One',
    ]);
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
      'NRGSim / Energy',
      'Local Coder',
      'Trading Agent',
      'Image Maker Agent',
      'Code Agent',
      'Video Agent',
      'Data Formulator',
      'Telescope Agent',
      'Plan Agent',
      'WorldSignals Agent',
      'Understand Anything',
      'Magentic-One',
    ]);
    expect(hydrated.edges).toEqual([]);
  });

  it('drops edges that become invalid after graph ownership changes', () => {
    const magentic = createCard('card_magentic', 'magentic_one');
    const graph = createCard('card_graph', 'graph_flow');
    const stepA = createCard('card_graph_step_1', 'assistant_agent', {
      parentGraphId: graph.id,
      title: 'Assist 1',
    });
    const stepB = createCard('card_graph_step_2', 'assistant_agent', {
      parentGraphId: graph.id,
      title: 'Assist 2',
    });

    const nextNodes = [magentic, graph, { ...stepA, parentGraphId: null }, stepB];
    const nextEdges = filterAuthoringCompatibleEdges(nextNodes, [
      { id: 'edge_magentic_graph', source: magentic.id, target: graph.id, edgeType: 'magentic_option' },
      { id: 'edge_step_chain', source: stepA.id, target: stepB.id, edgeType: 'flow' },
    ]);

    expect(nextEdges).toEqual([
      { id: 'edge_magentic_graph', source: magentic.id, target: graph.id, edgeType: 'magentic_option' },
    ]);
  });

  it('keeps top-level Assist workflow edges when both endpoints stay top-level', () => {
    const assistA = createCard('assist_a', 'assistant_agent');
    const assistB = createCard('assist_b', 'assistant_agent');

    const nextEdges = filterAuthoringCompatibleEdges([assistA, assistB], [
      { id: 'edge_assist_a_b', source: assistA.id, target: assistB.id, edgeType: 'flow' },
    ]);

    expect(nextEdges).toEqual([
      { id: 'edge_assist_a_b', source: assistA.id, target: assistB.id, edgeType: 'flow' },
    ]);
  });

  it('preserves saved legacy graph branch topology during editor-side compatibility filtering', () => {
    const graph = createCard('card_graph', 'graph_flow');
    const stepA = createCard('card_graph_step_a', 'assistant_agent', {
      parentGraphId: graph.id,
      title: 'Assist A',
    });
    const stepB = createCard('card_graph_step_b', 'assistant_agent', {
      parentGraphId: graph.id,
      title: 'Assist B',
    });
    const stepC = createCard('card_graph_step_c', 'assistant_agent', {
      parentGraphId: graph.id,
      title: 'Assist C',
    });
    const stepD = createCard('card_graph_step_d', 'assistant_agent', {
      parentGraphId: graph.id,
      title: 'Assist D',
    });

    const nextEdges = filterAuthoringCompatibleEdges([graph, stepA, stepB, stepC, stepD], [
      { id: 'edge_graph_a', source: graph.id, target: stepA.id, edgeType: 'flow' },
      { id: 'edge_a_b', source: stepA.id, target: stepB.id, edgeType: 'flow' },
      { id: 'edge_a_c', source: stepA.id, target: stepC.id, edgeType: 'flow' },
      { id: 'edge_b_d', source: stepB.id, target: stepD.id, edgeType: 'flow' },
      { id: 'edge_c_d', source: stepC.id, target: stepD.id, edgeType: 'flow' },
    ]);

    expect(nextEdges.map((edge) => edge.id)).toEqual([
      'edge_graph_a',
      'edge_a_b',
      'edge_a_c',
      'edge_b_d',
      'edge_c_d',
    ]);
  });

  it('does not strip unrelated edge metadata during card-editor compatibility filtering', () => {
    const assistA = createCard('assist_a', 'assistant_agent');
    const assistB = createCard('assist_b', 'assistant_agent');

    const nextEdges = filterAuthoringCompatibleEdges([assistA, assistB], [
      {
        id: 'edge_assist_a_b',
        source: assistA.id,
        target: assistB.id,
        edgeType: 'flow',
        metadata: {
          role: 'graph_execution',
          executionMode: 'conditional',
          conditionLabel: 'Only when gaps remain',
          priority: 3,
        },
      },
    ]);

    expect(nextEdges).toEqual([
      {
        id: 'edge_assist_a_b',
        source: assistA.id,
        target: assistB.id,
        edgeType: 'flow',
        metadata: {
          role: 'graph_execution',
          executionMode: 'conditional',
          conditionLabel: 'Only when gaps remain',
          priority: 3,
        },
      },
    ]);
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
        createCard('card_selector', 'selector', {
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

  it('keeps downstream top-level Assist workflow cards in selected-card runs', () => {
    const magentic = createCard('magentic', 'magentic_one');
    const assistA = createCard('assist_a', 'assistant_agent');
    const assistB = createCard('assist_b', 'assistant_agent');
    const graph = createCard('graph', 'graph_flow');
    const graphStep = createCard('graph_step', 'assistant_agent', { parentGraphId: graph.id });

    const document: DeckDocument = {
      ...createDeck([magentic, assistA, assistB, graph, graphStep]),
      edges: [
        { id: 'edge_magentic_assist', source: magentic.id, target: assistA.id, edgeType: 'magentic_option' },
        { id: 'edge_assist_chain', source: assistA.id, target: assistB.id, edgeType: 'flow' },
        { id: 'edge_magentic_graph', source: magentic.id, target: graph.id, edgeType: 'magentic_option' },
      ],
    };

    const assistRunDocument = buildSingleCardRunDocument(document, assistA.id);
    const magenticRunDocument = buildSingleCardRunDocument(document, magentic.id);

    expect(assistRunDocument?.nodes.map((node) => node.id)).toEqual(['assist_a', 'assist_b']);
    expect(assistRunDocument?.edges.map((edge) => edge.id)).toEqual(['edge_assist_chain']);

    expect(magenticRunDocument?.nodes.map((node) => node.id)).toEqual([
      'magentic',
      'assist_a',
      'assist_b',
      'graph',
      'graph_step',
    ]);
    expect(magenticRunDocument?.edges.map((edge) => edge.id)).toEqual([
      'edge_magentic_assist',
      'edge_assist_chain',
      'edge_magentic_graph',
    ]);
  });

  it('hydrates reload-time chat and plan continuity from saved deck runs', () => {
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
      executionPlanSummary: {
        startCardIds: ['card_magentic'],
        simpleOrderCardIds: ['card_magentic'],
        expandedStepIds: ['card_magentic::single'],
      },
    };

    const continuity = buildReloadStateFromDeckRuns([latestRun], latestRun);

    expect(continuity.messages).toEqual([
      { role: 'user', text: 'Map the next move' },
      { role: 'assistant', text: 'Here is the next move.' },
    ]);
    expect(continuity.planSource).toEqual(
      expect.objectContaining({
        goal: 'Map the next move',
        nextMove: ['Waiting for the next user input.'],
        whatMattersNow: ['Magentic-One assigned work to Main Chat.'],
      }),
    );
    expect(continuity.plan).toEqual([
      expect.objectContaining({
        text: 'Magentic-One: Here is the next move.',
        status: 'done',
      }),
    ]);
    expect(continuity.links).toEqual([]);
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

    expect(buildDeckRuntimeVisualState(events)).toEqual({
      activeCardIds: [],
      activeEdgeIds: [],
      swarmProgressByCardId: {},
      reasoningLines: [
        'Merged upstream outputs for Assist A.',
        'Assignment: Magentic-One assigned work to Assist A.',
      ],
      teamLines: [
        'Progress: Assist A started.',
        'Assignment: Magentic-One assigned work to Assist A.',
        'Actual assistant message from Assist A.',
        'Progress: Assist A swarm worker 2 of 5 completed.',
        'Progress: Assist A completed.',
      ],
      reportLines: [
        'Result: Assist A: Prepared the next research summary.',
        'Result: Deck Admin completed.',
      ],
    });
  });
});
