import React from 'react';
import { Handle } from '@xyflow/react';
import type { Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, DeckDocument, DeckEdge } from '../../types/agentgraph';
import {
  buildCanvasDocumentRecoveryKey,
  buildDeckEdgeFromConnection,
  buildDeckEdgeVisualStates,
  fitBuilderCanvasView,
  isPlainConnectionAllowedForDocument,
  isAnyCanvasNodeVisible,
  isCanvasRectVisible,
  mergeFlowEdgesIntoDeck,
  mergeFlowNodesIntoDeck,
  reduceCanvasEdgeChanges,
  reduceCanvasNodeChanges,
  shouldPersistEdgeChanges,
  shouldPersistNodeChanges,
  syncFlowEdgesForRender,
  syncFlowNodesForRender,
  toFlowEdges,
  toFlowNodes,
} from './BuilderCanvas';
// The viewport-math helpers were extracted out of BuilderCanvas into the
// shared agentbuilder core module; the spec follows the live import path.
import {
  buildInitialBusSeamViewport,
  buildInitialWorkbenchLandingViewport,
  buildPresentationLandingViewport,
} from '../../features/agentbuilder/core/agentBuilderViewportMath';
import { buildDeckEdgeIdentityKey, sanitizeDeckEdges } from './deckValidation';
import MagenticBusNode from './nodes/MagenticBusNode';

describe('BuilderCanvas runtime-truth helpers', () => {
  it('fits every rendered Card when the Fit view control is used', () => {
    const fitView = vi.fn();

    fitBuilderCanvasView({ fitView });

    expect(fitView).toHaveBeenCalledWith({
      duration: 220,
      maxZoom: 1.35,
      padding: 0.2,
    });
  });

  it('builds seam viewport math from the bus center rather than the bus left edge', () => {
    expect(
      buildInitialBusSeamViewport({
        busPosition: { x: 140, y: 120 },
        busWidth: 26,
        zoom: 1,
        desiredBusCenterX: 0,
        desiredBusTopY: 72,
      }),
    ).toEqual({
      x: -153,
      y: -48,
      zoom: 1,
    });
  });

  it('builds the initial landing viewport around the bus and workbench side', () => {
    const document: DeckDocument = {
      id: 'deck_landing',
      name: 'Landing',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'card_worker_a',
          kind: 'agent',
          templateId: 'template_worker',
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'Worker A',
          position: { x: -420, y: 140 },
        },
        {
          id: 'card_magentic',
          kind: 'agent',
          templateId: 'template_magentic',
          runtime: { kind: 'autogen', mode: 'magentic_one' },
          title: 'Magentic-One',
          position: { x: 140, y: 120 },
        },
        {
          id: 'card_trading_workbench',
          kind: 'agent',
          templateId: 'template_trading_workbench',
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'Trading Agent',
          position: { x: 220, y: 140 },
        },
      ],
      edges: [],
    };

    expect(buildInitialWorkbenchLandingViewport(document, 1)).toEqual({
      x: -153,
      y: -48,
      zoom: 1,
    });
    expect(
      buildInitialWorkbenchLandingViewport(document, 1, {
        desiredBusCenterX: -10,
      }),
    ).toEqual({
      x: -163,
      y: -48,
      zoom: 1,
    });
    expect(document.nodes[0].position).toEqual({ x: -420, y: 140 });
  });

  it('reuses the seam landing viewport for presentation restore actions', () => {
    const seamHandle = {
      getBoundingClientRect: () => ({ left: 474, top: 0, right: 484, bottom: 900, width: 10, height: 900 }),
    };
    const canvasRegion = {
      previousElementSibling: seamHandle,
      getBoundingClientRect: () => ({ left: 484, top: 0, right: 1600, bottom: 900, width: 1116, height: 900 }),
    };
    const canvasElement = {
      closest: (selector: string) => (selector === '[data-testid="workspace-canvas-region"]' ? canvasRegion : null),
    };

    const documentModel: DeckDocument = {
      id: 'deck_landing_restore',
      name: 'Landing Restore',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'card_magentic',
          kind: 'agent',
          templateId: 'template_magentic',
          runtime: { kind: 'autogen', mode: 'magentic_one' },
          title: 'Magentic-One',
          position: { x: 140, y: 120 },
        },
        {
          id: 'card_trading_workbench',
          kind: 'agent',
          templateId: 'template_trading_workbench',
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'Trading Agent',
          position: { x: 220, y: 140 },
        },
      ],
      edges: [],
    };

    expect(
      buildPresentationLandingViewport(documentModel, canvasElement as HTMLDivElement, 1),
    ).toEqual({
      x: -163,
      y: -48,
      zoom: 1,
    });
  });

  it('does not build a workbench landing viewport when the workbench is absent', () => {
    const document: DeckDocument = {
      id: 'deck_landing_without_workbench',
      name: 'Landing',
      promptTemplates: [],
      version: 1,
      nodes: [
        {
          id: 'card_magentic',
          kind: 'agent',
          templateId: 'template_magentic',
          runtime: { kind: 'autogen', mode: 'magentic_one' },
          title: 'Magentic-One',
          position: { x: 140, y: 120 },
        },
      ],
      edges: [],
    };

    expect(buildInitialWorkbenchLandingViewport(document, 1)).toBeNull();
  });

  it('does not persist selection-only node or edge changes', () => {
    const nodeChanges: NodeChange[] = [{ id: 'card_magentic', type: 'select', selected: true }];
    const edgeChanges: EdgeChange[] = [{ id: 'edge_magentic_graph', type: 'select', selected: true }];
    expect(shouldPersistNodeChanges(nodeChanges)).toBe(false);
    expect(shouldPersistEdgeChanges(edgeChanges)).toBe(false);
  });

  it('keeps drag movement local until the drag-stop handler commits the exact position', () => {
    const nodeChanges: NodeChange[] = [{
      id: 'card_magentic',
      type: 'position',
      position: { x: 314.5, y: -72.25 },
      dragging: true,
    }];
    expect(shouldPersistNodeChanges(nodeChanges)).toBe(false);
    const reduced = reduceCanvasNodeChanges(nodeChanges, [{
      id: 'card_magentic',
      position: { x: 0, y: 0 },
      data: {},
    }]);
    expect(reduced.nextNodes[0]?.position).toEqual({ x: 314.5, y: -72.25 });
    expect(reduced.nextNodesForPersistence).toBeNull();
  });

  it('reduces persisted canvas changes synchronously before React state callbacks run', () => {
    const currentNodes: Node[] = [{
      id: 'card_assist',
      type: 'agentCard',
      position: { x: 24, y: 48 },
      data: {},
    }];
    const nodeResult = reduceCanvasNodeChanges(
      [{ item: {
        id: 'card_second',
        type: 'agentCard',
        position: { x: 240, y: 120 },
        data: {},
      }, type: 'add' }],
      currentNodes,
    );
    expect(nodeResult.nextNodesForPersistence?.[1].position).toEqual({ x: 240, y: 120 });

    const currentEdges: Edge[] = [{
      id: 'edge_assist_next',
      source: 'card_assist',
      target: 'card_next',
      data: { edgeType: 'flow' },
    }];
    const edgeResult = reduceCanvasEdgeChanges(
      [{ id: 'edge_assist_next', type: 'remove' }],
      currentEdges,
    );
    expect(edgeResult.nextEdgesForPersistence).toEqual([]);
  });

  it('preserves saved node prompt while updating position', () => {
    const savedNodes: AgentCardInstance[] = [
      {
        id: 'card_assist',
        kind: 'agent',
        templateId: 'template_assist',
        prompt: 'saved prompt',
        runtime: { kind: 'autogen', mode: 'assistant' },
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
        data: { edgeType: 'flow' },
      },
    ];

    const savedEdges = mergeFlowEdgesIntoDeck(flowEdges, []);
    const loadedEdges = sanitizeDeckEdges(JSON.parse(JSON.stringify(savedEdges)));

    expect(savedEdges).toEqual<DeckEdge[]>([
      {
        id: 'edge_magentic_assist',
        source: 'card_magentic',
        sourceHandle: null,
        target: 'card_assist',
        targetHandle: null,
        edgeType: 'magentic_option',
      },
      {
        id: 'edge_step_1_2',
        source: 'card_step_1',
        sourceHandle: null,
        target: 'card_step_2',
        targetHandle: null,
        edgeType: 'flow',
      },
    ]);
    expect(loadedEdges).toEqual(savedEdges);
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
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'A',
          position: { x: 0, y: 0 },
        },
        {
          id: 'b',
          kind: 'agent',
          templateId: 'worker',
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'B',
          position: { x: 320, y: 0 },
        },
      ],
      edges: [
        { id: 'edge_a_b', source: 'a', target: 'b', edgeType: 'flow' },
        { id: 'edge_b_a', source: 'b', target: 'a', edgeType: 'flow' },
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

  it('ignores non-layout document changes when deciding whether hover should recover the viewport', () => {
    const document: DeckDocument = {
      id: 'deck_recovery_key',
      name: 'Recovery Key',
      promptTemplates: [
        {
          id: 'prompt_main',
          label: 'Main Prompt',
          prompt: 'original prompt',
        } as any,
      ],
      version: 4,
      nodes: [
        {
          id: 'card_main',
          kind: 'agent',
          templateId: 'template_main',
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'Main',
          subtitle: 'Original subtitle',
          prompt: 'Original prompt',
          position: { x: 120, y: 80 },
        },
      ],
      edges: [],
    };

    const restyledDocument: DeckDocument = {
      ...document,
      name: 'Recovery Key Updated',
      promptTemplates: [
        {
          id: 'prompt_main',
          label: 'Main Prompt',
          prompt: 'updated prompt',
        } as any,
      ],
      nodes: [
        {
          ...document.nodes[0],
          title: 'Main Updated',
          subtitle: 'Updated subtitle',
          prompt: 'Updated prompt',
        },
      ],
    };

    expect(buildCanvasDocumentRecoveryKey(restyledDocument)).toBe(buildCanvasDocumentRecoveryKey(document));
  });

  it('changes the viewport recovery key when the actual graph layout changes', () => {
    const document: DeckDocument = {
      id: 'deck_recovery_layout',
      name: 'Recovery Layout',
      promptTemplates: [],
      version: 7,
      nodes: [
        {
          id: 'card_a',
          kind: 'agent',
          templateId: 'template_a',
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'A',
          position: { x: 80, y: 80 },
        },
        {
          id: 'card_b',
          kind: 'agent',
          templateId: 'template_b',
          runtime: { kind: 'autogen', mode: 'assistant' },
          title: 'B',
          position: { x: 420, y: 80 },
        },
      ],
      edges: [
        {
          id: 'edge_a_b',
          source: 'card_a',
          target: 'card_b',
          edgeType: 'flow',
        },
      ],
    };

    const movedNodeDocument: DeckDocument = {
      ...document,
      nodes: [
        {
          ...document.nodes[0],
          position: { x: 240, y: 80 },
        },
        document.nodes[1],
      ],
    };
    const rewiredEdgeDocument: DeckDocument = {
      ...document,
      edges: [
        {
          ...document.edges[0],
          target: 'card_a',
        },
      ],
    };

    expect(buildCanvasDocumentRecoveryKey(movedNodeDocument)).not.toBe(buildCanvasDocumentRecoveryKey(document));
    expect(buildCanvasDocumentRecoveryKey(rewiredEdgeDocument)).not.toBe(buildCanvasDocumentRecoveryKey(document));
  });

  it('preserves measured node layout state during hover-only render sync', () => {
    const currentNodes: Node[] = [
      {
        id: 'card_main',
        type: 'agentCard',
        position: { x: 120, y: 80 },
        width: 320,
        height: 180,
        measured: { width: 326, height: 184 },
        positionAbsolute: { x: 120, y: 80 },
        data: { title: 'Main' },
      } as Node,
    ];
    const nextNodes: Node[] = [
      {
        id: 'card_main',
        type: 'agentCard',
        position: { x: 120, y: 80 },
        selected: true,
        style: { opacity: 0.44 },
        data: { title: 'Main', isHovered: true },
      } as Node,
    ];

    const synced = syncFlowNodesForRender(currentNodes, nextNodes);

    expect(synced[0]).toMatchObject({
      width: 320,
      height: 180,
      measured: { width: 326, height: 184 },
      positionAbsolute: { x: 120, y: 80 },
      selected: true,
      style: { opacity: 0.44 },
      data: { title: 'Main', isHovered: true },
    });
  });

  it('keeps pointer-owned coordinates during non-layout refreshes', () => {
    const currentNodes: Node[] = [{
      id: 'card_main',
      type: 'agentCard',
      position: { x: 318.5, y: -42.25 },
      dragging: true,
      data: { title: 'Main', activeAgentCount: 0 },
    }];
    const nextNodes: Node[] = [{
      id: 'card_main',
      type: 'agentCard',
      position: { x: -24, y: -24 },
      data: { title: 'Main', activeAgentCount: 1 },
    }];

    const synced = syncFlowNodesForRender(currentNodes, nextNodes);

    expect(synced[0].position).toEqual({ x: 318.5, y: -42.25 });
    expect(synced[0].data).toMatchObject({ activeAgentCount: 1 });
    expect(synced[0].dragging).toBe(true);
  });

  it('preserves computed edge state during hover-only render sync', () => {
    const currentEdges: Edge[] = [
      {
        id: 'edge_main_next',
        source: 'card_main',
        target: 'card_next',
        data: { edgeType: 'flow' },
        markerEnd: { type: 'arrowclosed', color: '#999' } as any,
        style: { stroke: '#999', opacity: 1 },
        selected: false,
      } as Edge,
    ];
    const nextEdges: Edge[] = [
      {
        id: 'edge_main_next',
        source: 'card_main',
        target: 'card_next',
        data: { edgeType: 'flow' },
        markerEnd: { type: 'arrowclosed', color: '#fff' } as any,
        style: { stroke: '#fff', opacity: 0.24 },
        selected: true,
        className: 'edge-flow',
      } as Edge,
    ];

    const synced = syncFlowEdgesForRender(currentEdges, nextEdges);

    expect(synced[0]).toMatchObject({
      markerEnd: { color: '#fff' },
      style: { stroke: '#fff', opacity: 0.24 },
      selected: true,
      className: 'edge-flow',
    });
  });

  it('supports DeckEdge sourceHandle and targetHandle fields', () => {
    const edge: DeckEdge = {
      id: 'edge_bus_worker',
      source: 'card_magentic',
      sourceHandle: 'bus-out-1',
      target: 'card_worker_a',
      targetHandle: 'agent-in',
      edgeType: 'magentic_option',
    };

    expect(edge.sourceHandle).toBe('bus-out-1');
    expect(edge.targetHandle).toBe('agent-in');
  });

  it('preserves handle fields when sanitizing deck edges', () => {
    const edges = sanitizeDeckEdges([
      {
        id: 'edge_bus_worker',
        source: 'card_magentic',
        sourceHandle: 'bus-out-1',
        target: 'card_worker_a',
        targetHandle: 'agent-in',
        edgeType: 'magentic_option',
      },
    ]);

    expect(edges).toEqual<DeckEdge[]>([
      {
        id: 'edge_bus_worker',
        source: 'card_magentic',
        sourceHandle: 'bus-out-1',
        target: 'card_worker_a',
        targetHandle: 'agent-in',
        edgeType: 'magentic_option',
      },
    ]);
  });

  it('includes sourceHandle and targetHandle in edge identity', () => {
    const firstKey = buildDeckEdgeIdentityKey({
      source: 'card_magentic',
      sourceHandle: 'bus-out-1',
      target: 'card_worker_a',
      targetHandle: null,
      edgeType: 'magentic_option',
    });
    const secondKey = buildDeckEdgeIdentityKey({
      source: 'card_magentic',
      sourceHandle: 'bus-out-2',
      target: 'card_worker_a',
      targetHandle: null,
      edgeType: 'magentic_option',
    });

    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toBe('card_magentic::bus-out-1::card_worker_a::::magentic_option');
  });

  it('allows the same source and target through different handles but rejects exact duplicates', () => {
    const document = createBusTestDocument();
    const currentEdges: Edge[] = [
      {
        id: 'edge_bus_worker_1',
        source: 'card_magentic',
        sourceHandle: 'bus-out-1',
        target: 'card_worker_a',
        targetHandle: null,
        data: { edgeType: 'magentic_option' },
      } as Edge,
    ];

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_magentic',
          sourceHandle: 'bus-out-2',
          target: 'card_worker_a',
          targetHandle: null,
        },
        currentEdges,
      ),
    ).toBe(true);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_magentic',
          sourceHandle: 'bus-out-1',
          target: 'card_worker_a',
          targetHandle: null,
        },
        currentEdges,
      ),
    ).toBe(false);
  });

  it('allows normal agent-to-agent chains and rejects only exact duplicate links', () => {
    const document = createBusTestDocument();
    const currentEdges: Edge[] = [
      {
        id: 'edge_worker_chain',
        source: 'card_worker_a',
        sourceHandle: null,
        target: 'card_worker_b',
        targetHandle: null,
        data: { edgeType: 'flow' },
      } as Edge,
    ];

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_worker_a',
          sourceHandle: null,
          target: 'card_worker_b',
          targetHandle: null,
        },
        [],
      ),
    ).toBe(true);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_worker_b',
          sourceHandle: null,
          target: 'card_research_agent',
          targetHandle: null,
        },
        currentEdges,
      ),
    ).toBe(true);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_worker_a',
          sourceHandle: null,
          target: 'card_worker_b',
          targetHandle: null,
        },
        currentEdges,
      ),
    ).toBe(false);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_magentic',
          sourceHandle: 'bus-out-1',
          target: 'card_worker_a',
          targetHandle: null,
        },
        currentEdges,
      ),
    ).toBe(true);
  });

  it('passes handle ids through React Flow edge mapping', () => {
    const [edge] = toFlowEdges(
      createBusTestDocument([
        {
          id: 'edge_bus_worker',
          source: 'card_magentic',
          sourceHandle: 'bus-out-3',
          target: 'card_worker_a',
          targetHandle: 'agent-in',
          edgeType: 'magentic_option',
        },
      ]),
      null,
      null,
      new Set(),
    );

    expect(edge).toMatchObject({
      sourceHandle: 'bus-out-3',
      targetHandle: 'agent-in',
    });
  });

  it('captures handle ids when converting React Flow edges back to DeckEdge', () => {
    expect(
      buildDeckEdgeFromConnection(
        {
          source: 'card_magentic',
          sourceHandle: 'bus-out-4',
          target: 'card_research_agent',
          targetHandle: 'agent-in',
        },
        'edge_bus_research',
        'magentic_option',
      ),
    ).toEqual<DeckEdge>({
      id: 'edge_bus_research',
      source: 'card_magentic',
      sourceHandle: 'bus-out-4',
      target: 'card_research_agent',
      targetHandle: 'agent-in',
      edgeType: 'magentic_option',
    });

    const savedEdges = mergeFlowEdgesIntoDeck(
      [
        {
          id: 'edge_bus_research',
          source: 'card_magentic',
          sourceHandle: 'bus-out-4',
          target: 'card_research_agent',
          targetHandle: 'agent-in',
          data: { edgeType: 'magentic_option' },
        } as Edge,
      ],
      [],
    );

    expect(savedEdges).toEqual<DeckEdge[]>([
      {
        id: 'edge_bus_research',
        source: 'card_magentic',
        sourceHandle: 'bus-out-4',
        target: 'card_research_agent',
        targetHandle: 'agent-in',
        edgeType: 'magentic_option',
      },
    ]);
  });

  it('maps only the Magentic-One card to the magenticBus node type', () => {
    const nodes = toFlowNodes(
      createBusTestDocument(),
      null,
      null,
      false,
      new Set(),
    );

    expect(nodes.find((node) => node.id === 'card_magentic')).toMatchObject({
      type: 'magenticBus',
      position: { x: 40, y: 120 },
      draggable: false,
      selectable: true,
    });
    expect(nodes.find((node) => node.id === 'card_worker_a')).toMatchObject({
      type: 'agentCard',
      position: { x: 180, y: 140 },
      draggable: true,
      selectable: true,
    });
  });

  it('renders exactly thirteen real React Flow handles on MagenticBusNode', () => {
    // 12 side bus handles + the top task-bus-top target (the selected task's
    // task_to_bus edge enters the bus from the task graph above).
    const handles = collectHandleElements(MagenticBusNode());

    expect(handles).toHaveLength(13);
    expect(handles.map((handle) => handle.props.id)).toEqual([
      'task-bus-top',
      'bus-in-1',
      'bus-in-2',
      'bus-in-3',
      'bus-in-4',
      'bus-in-5',
      'bus-in-6',
      'bus-out-1',
      'bus-out-2',
      'bus-out-3',
      'bus-out-4',
      'bus-out-5',
      'bus-out-6',
    ]);
    const sideHandles = handles.slice(1);
    sideHandles.forEach((handle) => {
      const style = handle.props.style as Record<string, unknown>;
      expect(style.width).toBe(6);
      expect(style.height).toBe(16);
      expect(style.borderRadius).toBe(4);
      expect(style.pointerEvents).toBe('all');
      expect(style.zIndex).toBe(100);
      expect(style.display).toBeUndefined();
      expect(style.visibility).toBeUndefined();
    });
    sideHandles.slice(0, 6).forEach((handle) => {
      expect((handle.props.style as Record<string, unknown>).left).toBe(-3);
    });
    sideHandles.slice(6).forEach((handle) => {
      expect((handle.props.style as Record<string, unknown>).right).toBe(-3);
    });
  });
});

function createBusTestDocument(edges: DeckEdge[] = []): DeckDocument {
  return {
    id: 'deck_bus_test',
    name: 'Bus Test',
    promptTemplates: [],
    version: 1,
    nodes: [
      {
        id: 'card_magentic',
        kind: 'agent',
        templateId: 'template_magentic',
        runtime: { kind: 'autogen', mode: 'magentic_one' },
        title: 'Magentic-One',
        position: { x: 40, y: 120 },
      },
      {
        id: 'card_worker_a',
        kind: 'agent',
        templateId: 'template_worker',
        runtime: { kind: 'autogen', mode: 'assistant' },
        title: 'Worker A',
        position: { x: 180, y: 140 },
      },
      {
        id: 'card_worker_b',
        kind: 'agent',
        templateId: 'template_worker',
        runtime: { kind: 'autogen', mode: 'assistant' },
        title: 'CodeGraph',
        position: { x: 420, y: 140 },
      },
      {
        id: 'card_research_agent',
        kind: 'agent',
        templateId: 'template_research_agent',
        runtime: { kind: 'autogen', mode: 'assistant' },
        title: 'Research',
        position: { x: 660, y: 140 },
      },
    ],
    edges,
  };
}

type HandleElement = React.ReactElement<{ id: string; style: Record<string, unknown> }>;

function collectHandleElements(value: React.ReactNode): HandleElement[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectHandleElements(entry));
  }
  if (!React.isValidElement(value)) {
    return [];
  }

  const children = (value.props as { children?: React.ReactNode }).children;
  return [
    ...(value.type === Handle ? [value as HandleElement] : []),
    ...collectHandleElements(children),
  ];
}
