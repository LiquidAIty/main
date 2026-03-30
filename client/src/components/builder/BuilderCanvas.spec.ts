import type { Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckEdge } from '../../types/agentgraph';
import { buildExecutionPlan } from './deckExecution';
import {
  buildDeckEdgeVisualStates,
  mergeFlowEdgesIntoDeck,
  mergeFlowNodesIntoDeck,
  shouldPersistEdgeChanges,
  shouldPersistNodeChanges,
} from './BuilderCanvas';
import { sanitizeDeckEdges } from './deckValidation';

describe('BuilderCanvas write guards', () => {
  it('does not persist deck payload for node selection-only changes', () => {
    const changes: NodeChange[] = [{ id: 'main_chat', type: 'select', selected: true }];
    expect(shouldPersistNodeChanges(changes)).toBe(false);
  });

  it('does not persist deck payload for edge selection-only changes', () => {
    const changes: EdgeChange[] = [{ id: 'edge_main_chat_kg_ingest', type: 'select', selected: true }];
    expect(shouldPersistEdgeChanges(changes)).toBe(false);
  });

  it('preserves saved prompt and keeps connections as simple source-target links when stale flow state is merged after reload', () => {
    const savedNodes: AgentCardInstance[] = [
      {
        id: 'main_chat',
        kind: 'agent',
        templateId: 'main_chat',
        prompt: 'saved prompt truth',
        title: 'Main Chat',
        position: { x: 24, y: 48 },
      },
    ];
    const staleFlowNodes: Node[] = [
      {
        id: 'main_chat',
        type: 'agentCard',
        position: { x: 240, y: 120 },
        data: {
          ...savedNodes[0],
          prompt: 'stale prompt snapshot',
        },
      },
    ];

    const mergedNodes = mergeFlowNodesIntoDeck(staleFlowNodes, savedNodes);
    expect(mergedNodes[0].prompt).toBe('saved prompt truth');
    expect(mergedNodes[0].position).toEqual({ x: 240, y: 120 });

    const savedEdges: DeckEdge[] = [
      {
        id: 'edge_main_chat_kg_ingest',
        source: 'main_chat',
        target: 'kg_ingest',
      },
    ];
    const staleFlowEdges: Edge[] = [
      {
        id: 'edge_main_chat_kg_ingest',
        source: 'main_chat',
        target: 'kg_ingest',
      },
    ];

    const mergedEdges = mergeFlowEdgesIntoDeck(staleFlowEdges, savedEdges);
    expect(mergedEdges[0]).toEqual({
      id: 'edge_main_chat_kg_ingest',
      source: 'main_chat',
      target: 'kg_ingest',
    });
  });

  it('ignores legacy edge metadata on load and keeps only real source-target routing', () => {
    const loadedEdges = sanitizeDeckEdges([
      {
        id: 'edge_main_chat_research',
        source: 'main_chat',
        target: 'research',
        routeType: 'conditional',
        passforwardMode: 'full_output',
        condition: 'never',
        mapping: [{ from: 'output', to: 'blackboard' }],
        priority: 99,
      },
    ]);

    expect(loadedEdges).toEqual([
      {
        id: 'edge_main_chat_research',
        source: 'main_chat',
        target: 'research',
      },
    ]);
  });

  it('preserves plain source-target routing exactly through the save-load path', () => {
    const flowEdges: Edge[] = [
      { id: 'edge_a_b', source: 'a', target: 'b' },
      { id: 'edge_b_c', source: 'b', target: 'c' },
    ];

    const savedEdges = mergeFlowEdgesIntoDeck(flowEdges, []);
    const loadedEdges = sanitizeDeckEdges(JSON.parse(JSON.stringify(savedEdges)));

    expect(savedEdges).toEqual([
      { id: 'edge_a_b', source: 'a', target: 'b' },
      { id: 'edge_b_c', source: 'b', target: 'c' },
    ]);
    expect(loadedEdges).toEqual(savedEdges);
  });

  it('marks loop and return links visually without inventing a fake simple order', () => {
    const loopDocument = {
      id: 'deck_loop',
      name: 'Loop Deck',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'a',
          kind: 'agent' as const,
          templateId: 'worker',
          title: 'A',
          position: { x: 0, y: 0 },
        },
        {
          id: 'b',
          kind: 'agent' as const,
          templateId: 'worker',
          title: 'B',
          position: { x: 320, y: 0 },
        },
      ],
      edges: [
        { id: 'edge_a_b', source: 'a', target: 'b' },
        { id: 'edge_b_a', source: 'b', target: 'a' },
      ],
    };

    const visualStates = buildDeckEdgeVisualStates(loopDocument);
    const executionPlan = buildExecutionPlan(loopDocument);

    expect(visualStates.get('edge_a_b')).toMatchObject({
      isLoopEdge: true,
      isReturnEdge: false,
    });
    expect(visualStates.get('edge_b_a')).toMatchObject({
      isLoopEdge: true,
      isReturnEdge: true,
    });
    expect(executionPlan.simpleOrderCardIds).toEqual([]);
    expect(executionPlan.issues.some((issue) => issue.toLowerCase().includes('cycle'))).toBe(true);
  });
});
