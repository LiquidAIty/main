import type { Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument, DeckEdge } from '../../types/agentgraph';
import { buildExecutionPlan } from './deckExecution';
import {
  buildAssistStructureSummaries,
  buildDeckEdgeVisualStates,
  getAssistSwarmBadge,
  isAnyCanvasNodeVisible,
  isCanvasRectVisible,
  mergeFlowEdgesIntoDeck,
  mergeFlowNodesIntoDeck,
  shouldPersistEdgeChanges,
  shouldPersistNodeChanges,
} from './BuilderCanvas';
import { sanitizeDeckEdges } from './deckValidation';

describe('BuilderCanvas runtime-truth helpers', () => {
  it('does not persist selection-only node or edge changes', () => {
    const nodeChanges: NodeChange[] = [{ id: 'card_magentic', type: 'select', selected: true }];
    const edgeChanges: EdgeChange[] = [{ id: 'edge_magentic_graph', type: 'select', selected: true }];
    expect(shouldPersistNodeChanges(nodeChanges)).toBe(false);
    expect(shouldPersistEdgeChanges(edgeChanges)).toBe(false);
  });

  it('preserves saved node prompt while updating position', () => {
    const savedNodes: AgentCardInstance[] = [
      {
        id: 'card_assist',
        kind: 'agent',
        templateId: 'template_assist',
        prompt: 'saved prompt',
        title: 'Assist',
        position: { x: 24, y: 48 },
      },
    ];
    const staleFlowNodes: Node[] = [
      {
        id: 'card_assist',
        type: 'agentCard',
        position: { x: 240, y: 120 },
        data: {
          ...savedNodes[0],
          prompt: 'stale prompt',
        },
      },
    ];

    const mergedNodes = mergeFlowNodesIntoDeck(staleFlowNodes, savedNodes);
    expect(mergedNodes[0].prompt).toBe('saved prompt');
    expect(mergedNodes[0].position).toEqual({ x: 240, y: 120 });
  });

  it('preserves edge type through merge and sanitize', () => {
    const flowEdges: Edge[] = [
      {
        id: 'edge_magentic_assist',
        source: 'card_magentic',
        target: 'card_assist',
        data: { edgeType: 'magentic_option' },
      },
      {
        id: 'edge_step_1_2',
        source: 'card_step_1',
        target: 'card_step_2',
        data: { edgeType: 'graph_flow' },
      },
    ];

    const savedEdges = mergeFlowEdgesIntoDeck(flowEdges, []);
    const loadedEdges = sanitizeDeckEdges(JSON.parse(JSON.stringify(savedEdges)));

    expect(savedEdges).toEqual<DeckEdge[]>([
      {
        id: 'edge_magentic_assist',
        source: 'card_magentic',
        target: 'card_assist',
        edgeType: 'magentic_option',
      },
      {
        id: 'edge_step_1_2',
        source: 'card_step_1',
        target: 'card_step_2',
        edgeType: 'graph_flow',
      },
    ]);
    expect(loadedEdges).toEqual(savedEdges);
  });

  it('round-trips explicit edge metadata while keeping callable and execution edges distinct', () => {
    const flowEdges: Edge[] = [
      {
        id: 'edge_magentic_assist',
        source: 'card_magentic',
        target: 'card_assist',
        data: {
          edgeType: 'magentic_option',
          metadata: {
            role: 'callable_route',
            priority: 1,
          },
        },
      },
      {
        id: 'edge_assist_next',
        source: 'card_assist',
        target: 'card_next',
        data: {
          edgeType: 'graph_flow',
          metadata: {
            role: 'graph_execution',
            executionMode: 'conditional',
            conditionLabel: 'Only when more evidence is needed',
            mergeIntent: 'summarize_all',
          },
        },
      },
    ];

    const savedEdges = mergeFlowEdgesIntoDeck(flowEdges, []);
    const loadedEdges = sanitizeDeckEdges(JSON.parse(JSON.stringify(savedEdges)));

    expect(loadedEdges).toEqual<DeckEdge[]>([
      {
        id: 'edge_magentic_assist',
        source: 'card_magentic',
        target: 'card_assist',
        edgeType: 'magentic_option',
        metadata: {
          role: 'callable_route',
          executionMode: null,
          conditionType: null,
          conditionExpression: null,
          conditionLabel: null,
          priority: 1,
          order: null,
          weight: null,
          mergeIntent: null,
          legacyCompatibility: null,
        },
      },
      {
        id: 'edge_assist_next',
        source: 'card_assist',
        target: 'card_next',
        edgeType: 'graph_flow',
        metadata: {
          role: 'graph_execution',
          executionMode: 'conditional',
          conditionType: null,
          conditionExpression: null,
          conditionLabel: 'Only when more evidence is needed',
          priority: null,
          order: null,
          weight: null,
          mergeIntent: 'summarize_all',
          legacyCompatibility: null,
        },
      },
    ]);
  });

  it('builds top-level execution order from orange edges only', () => {
    const document: DeckDocument = {
      id: 'deck_runtime_truth',
      name: 'Runtime Truth',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'card_magentic',
          kind: 'agent',
          templateId: 'template_magentic',
          runtimeType: 'magentic_one',
          title: 'Magentic',
          position: { x: 0, y: 0 },
        },
        {
          id: 'card_assist',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist',
          position: { x: 320, y: 0 },
        },
        {
          id: 'card_graph',
          kind: 'agent',
          templateId: 'template_graph',
          runtimeType: 'graph_flow',
          title: 'Graph',
          position: { x: 320, y: 240 },
        },
        {
          id: 'card_step_1',
          kind: 'agent',
          templateId: 'template_step',
          runtimeType: 'assistant_agent',
          parentGraphId: 'card_graph',
          title: 'Step 1',
          position: { x: 640, y: 240 },
        },
        {
          id: 'card_step_2',
          kind: 'agent',
          templateId: 'template_step',
          runtimeType: 'assistant_agent',
          parentGraphId: 'card_graph',
          title: 'Step 2',
          position: { x: 960, y: 240 },
        },
      ],
      edges: [
        {
          id: 'edge_magentic_assist',
          source: 'card_magentic',
          target: 'card_assist',
          edgeType: 'magentic_option',
        },
        {
          id: 'edge_magentic_graph',
          source: 'card_magentic',
          target: 'card_graph',
          edgeType: 'magentic_option',
        },
        {
          id: 'edge_step_1_2',
          source: 'card_step_1',
          target: 'card_step_2',
          edgeType: 'graph_flow',
        },
      ],
    };

    const executionPlan = buildExecutionPlan(document);
    expect(executionPlan.startCardIds).toEqual(['card_magentic']);
    expect(executionPlan.simpleOrderCardIds).toEqual(['card_magentic']);
  });

  it('derives assist structure mode from visible orange topology', () => {
    const document: DeckDocument = {
      id: 'deck_topology_truth',
      name: 'Topology Truth',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'card_graph',
          kind: 'agent',
          templateId: 'template_graph',
          runtimeType: 'graph_flow',
          title: 'Graph',
          position: { x: 0, y: 0 },
        },
        {
          id: 'card_step_single',
          kind: 'agent',
          templateId: 'template_step',
          runtimeType: 'assistant_agent',
          parentGraphId: 'card_graph',
          title: 'Assist Step 1',
          position: { x: 320, y: 0 },
        },
        {
          id: 'card_step_middle',
          kind: 'agent',
          templateId: 'template_step',
          runtimeType: 'assistant_agent',
          parentGraphId: 'card_graph',
          title: 'Assist Step 2',
          position: { x: 640, y: 0 },
        },
        {
          id: 'card_step_branch_left',
          kind: 'agent',
          templateId: 'template_step',
          runtimeType: 'assistant_agent',
          parentGraphId: 'card_graph',
          title: 'Assist Step 3',
          position: { x: 960, y: -120 },
        },
        {
          id: 'card_step_branch_right',
          kind: 'agent',
          templateId: 'template_step',
          runtimeType: 'assistant_agent',
          parentGraphId: 'card_graph',
          title: 'Assist Step 4',
          position: { x: 960, y: 120 },
        },
      ],
      edges: [
        { id: 'edge_single_middle', source: 'card_step_single', target: 'card_step_middle', edgeType: 'graph_flow' },
        { id: 'edge_middle_left', source: 'card_step_middle', target: 'card_step_branch_left', edgeType: 'graph_flow' },
        { id: 'edge_middle_right', source: 'card_step_middle', target: 'card_step_branch_right', edgeType: 'graph_flow' },
      ],
    };

    const summaries = buildAssistStructureSummaries(document);
    expect(summaries.get('card_step_single')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_step_middle')).toMatchObject({ mode: 'branch' });
    expect(summaries.get('card_step_branch_left')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_step_branch_right')).toMatchObject({ mode: 'seq' });
  });

  it('derives merge and branch-merge modes from visible orange recombination', () => {
    const document: DeckDocument = {
      id: 'deck_merge_truth',
      name: 'Merge Truth',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'card_assist_left',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist Left',
          position: { x: 0, y: -120 },
        },
        {
          id: 'card_assist_right',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist Right',
          position: { x: 0, y: 120 },
        },
        {
          id: 'card_assist_merge',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist Merge',
          position: { x: 320, y: 0 },
        },
        {
          id: 'card_assist_after_merge_left',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist After Merge Left',
          position: { x: 640, y: -120 },
        },
        {
          id: 'card_assist_after_merge_right',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist After Merge Right',
          position: { x: 640, y: 120 },
        },
      ],
      edges: [
        { id: 'edge_left_merge', source: 'card_assist_left', target: 'card_assist_merge', edgeType: 'graph_flow' },
        { id: 'edge_right_merge', source: 'card_assist_right', target: 'card_assist_merge', edgeType: 'graph_flow' },
        { id: 'edge_merge_left', source: 'card_assist_merge', target: 'card_assist_after_merge_left', edgeType: 'graph_flow' },
        { id: 'edge_merge_right', source: 'card_assist_merge', target: 'card_assist_after_merge_right', edgeType: 'graph_flow' },
      ],
    };

    const summaries = buildAssistStructureSummaries(document);
    expect(summaries.get('card_assist_left')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_assist_right')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_assist_merge')).toMatchObject({ mode: 'branch_merge' });
    expect(summaries.get('card_assist_after_merge_left')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_assist_after_merge_right')).toMatchObject({ mode: 'seq' });
  });

  it('derives assist structure mode from top-level orange Assist workflows too', () => {
    const document: DeckDocument = {
      id: 'deck_top_level_topology_truth',
      name: 'Top-level Topology Truth',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'card_assist_entry',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist Entry',
          position: { x: 0, y: 0 },
        },
        {
          id: 'card_assist_mid',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist Mid',
          position: { x: 320, y: 0 },
        },
        {
          id: 'card_assist_left',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist Left',
          position: { x: 640, y: -120 },
        },
        {
          id: 'card_assist_right',
          kind: 'agent',
          templateId: 'template_assist',
          runtimeType: 'assistant_agent',
          title: 'Assist Right',
          position: { x: 640, y: 120 },
        },
      ],
      edges: [
        { id: 'edge_entry_mid', source: 'card_assist_entry', target: 'card_assist_mid', edgeType: 'graph_flow' },
        { id: 'edge_mid_left', source: 'card_assist_mid', target: 'card_assist_left', edgeType: 'graph_flow' },
        { id: 'edge_mid_right', source: 'card_assist_mid', target: 'card_assist_right', edgeType: 'graph_flow' },
      ],
    };

    const summaries = buildAssistStructureSummaries(document);
    expect(summaries.get('card_assist_entry')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_assist_mid')).toMatchObject({ mode: 'branch' });
    expect(summaries.get('card_assist_left')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_assist_right')).toMatchObject({ mode: 'seq' });
  });

  it('keeps topology badges truthful for the restored research cards when saved branches are present', () => {
    const document: DeckDocument = {
      id: 'deck_restored_research_truth',
      name: 'Restored Research Truth',
      promptTemplates: [],
      version: 2,
      nodes: [
        {
          id: 'card_main_chat',
          kind: 'agent',
          templateId: 'template_main_chat',
          runtimeType: 'assistant_agent',
          title: 'Main Chat',
          position: { x: -220, y: 170 },
        },
        {
          id: 'card_kg_ingest',
          kind: 'agent',
          templateId: 'template_kg_ingest',
          runtimeType: 'assistant_agent',
          title: 'ThinkGraph',
          position: { x: 80, y: 40 },
        },
        {
          id: 'card_research',
          kind: 'agent',
          templateId: 'template_research',
          runtimeType: 'assistant_agent',
          title: 'Research Agent',
          position: { x: 380, y: -70 },
        },
        {
          id: 'card_knowgraph',
          kind: 'agent',
          templateId: 'template_knowgraph',
          runtimeType: 'assistant_agent',
          title: 'KnowGraph',
          position: { x: 380, y: 150 },
        },
        {
          id: 'card_neo4j',
          kind: 'agent',
          templateId: 'template_neo4j',
          runtimeType: 'assistant_agent',
          title: 'Neo4j',
          position: { x: 680, y: 40 },
        },
      ],
      edges: [
        { id: 'edge_main_chat_kg_ingest', source: 'card_main_chat', target: 'card_kg_ingest', edgeType: 'graph_flow' },
        { id: 'edge_kg_ingest_research', source: 'card_kg_ingest', target: 'card_research', edgeType: 'graph_flow' },
        { id: 'edge_kg_ingest_knowgraph', source: 'card_kg_ingest', target: 'card_knowgraph', edgeType: 'graph_flow' },
        { id: 'edge_research_neo4j', source: 'card_research', target: 'card_neo4j', edgeType: 'graph_flow' },
        { id: 'edge_knowgraph_neo4j', source: 'card_knowgraph', target: 'card_neo4j', edgeType: 'graph_flow' },
      ],
    };

    const summaries = buildAssistStructureSummaries(document);
    expect(summaries.get('card_main_chat')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_kg_ingest')).toMatchObject({ mode: 'branch' });
    expect(summaries.get('card_research')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_knowgraph')).toMatchObject({ mode: 'seq' });
    expect(summaries.get('card_neo4j')).toMatchObject({ mode: 'merge' });
  });

  it('derives visible swarm count from assist runtime options', () => {
    expect(
      getAssistSwarmBadge({
        id: 'card_swarm_assist',
        kind: 'agent',
        templateId: 'template_assist',
        runtimeType: 'assistant_agent',
        runtimeOptions: {
          executionMode: 'swarm',
          swarmMaxWorkers: 5,
        },
        title: 'Assist',
        position: { x: 0, y: 0 },
      }),
    ).toBe('Swarm x5');

    expect(
      getAssistSwarmBadge({
        id: 'card_single_assist',
        kind: 'agent',
        templateId: 'template_assist',
        runtimeType: 'assistant_agent',
        runtimeOptions: {
          executionMode: 'single',
        },
        title: 'Assist',
        position: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });

  it('marks loop and return links visually', () => {
    const loopDocument: DeckDocument = {
      id: 'deck_loop',
      name: 'Loop Deck',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'a',
          kind: 'agent',
          templateId: 'worker',
          title: 'A',
          position: { x: 0, y: 0 },
        },
        {
          id: 'b',
          kind: 'agent',
          templateId: 'worker',
          title: 'B',
          position: { x: 320, y: 0 },
        },
      ],
      edges: [
        { id: 'edge_a_b', source: 'a', target: 'b', edgeType: 'graph_flow' },
        { id: 'edge_b_a', source: 'b', target: 'a', edgeType: 'graph_flow' },
      ],
    };

    const visualStates = buildDeckEdgeVisualStates(loopDocument);
    expect(visualStates.get('edge_a_b')).toMatchObject({
      isLoopEdge: true,
      isReturnEdge: false,
    });
    expect(visualStates.get('edge_b_a')).toMatchObject({
      isLoopEdge: true,
      isReturnEdge: true,
    });
  });

  it('treats a blank gap between cards as not visible', () => {
    const nodes: Node[] = [
      {
        id: 'left',
        type: 'agentCard',
        position: { x: 0, y: 0 },
        width: 280,
        height: 160,
        data: {},
      },
      {
        id: 'right',
        type: 'agentCard',
        position: { x: 1400, y: 0 },
        width: 280,
        height: 160,
        data: {},
      },
    ];
    const viewport = { left: 600, top: -40, right: 960, bottom: 320 };
    expect(isAnyCanvasNodeVisible(nodes, viewport, 0)).toBe(false);
    expect(
      isCanvasRectVisible(
        { x: 120, y: 80, width: 280, height: 160 },
        { left: 0, top: 0, right: 600, bottom: 400 },
        0,
      ),
    ).toBe(true);
  });
});
