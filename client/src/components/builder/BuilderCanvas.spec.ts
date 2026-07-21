import React from 'react';
import { Handle } from '@xyflow/react';
import type { Edge, Node, NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument, DeckEdge } from '../../types/agentgraph';
import {
  buildCanvasDocumentRecoveryKey,
  buildDeckEdgeFromConnection,
  buildDeckEdgeVisualStates,
  confirmCanvasCardDeletion,
  isCanvasTextEditingTarget,
  isPlainConnectionAllowedForDocument,
  removeCardAndConnectedEdges,
  resolveCanvasConnectionEdgeType,
  isAnyCanvasNodeVisible,
  isCanvasRectVisible,
  mergeFlowNodesIntoDeck,
  reduceCanvasNodeChanges,
  shouldPersistNodeChanges,
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
import { buildDeckEdgeIdentityKey, sanitizeDeckEdges, SEMANTIC_HANDLE_IDS } from './deckValidation';
import AgentCardNode from './nodes/AgentCardNode';
import MagenticBusNode from './nodes/MagenticBusNode';

describe('BuilderCanvas runtime-truth helpers', () => {
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
          id: 'card_thinkgraph_agent',
          kind: 'agent',
          templateId: 'template_thinkgraph_agent',
          runtimeType: 'assistant_agent',
          title: 'ThinkGraph Agent',
          position: { x: -420, y: 140 },
        },
        {
          id: 'card_magentic',
          kind: 'agent',
          templateId: 'template_magentic',
          runtimeType: 'magentic_one',
          title: 'Magentic-One',
          position: { x: 140, y: 120 },
        },
        {
          id: 'card_trading_workbench',
          kind: 'agent',
          templateId: 'template_trading_workbench',
          runtimeType: 'assistant_agent',
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
          runtimeType: 'magentic_one',
          title: 'Magentic-One',
          position: { x: 140, y: 120 },
        },
        {
          id: 'card_trading_workbench',
          kind: 'agent',
          templateId: 'template_trading_workbench',
          runtimeType: 'assistant_agent',
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
          runtimeType: 'magentic_one',
          title: 'Magentic-One',
          position: { x: 140, y: 120 },
        },
      ],
      edges: [],
    };

    expect(buildInitialWorkbenchLandingViewport(document, 1)).toBeNull();
  });

  it('does not persist selection-only node changes', () => {
    const nodeChanges: NodeChange[] = [{ id: 'card_magentic', type: 'select', selected: true }];
    expect(shouldPersistNodeChanges(nodeChanges)).toBe(false);
  });

  it('reduces persisted canvas changes synchronously before React state callbacks run', () => {
    const currentNodes: Node[] = [{
      id: 'card_assist',
      type: 'agentCard',
      position: { x: 24, y: 48 },
      data: {},
    }];
    const nodeResult = reduceCanvasNodeChanges(
      [{ id: 'card_assist', type: 'position', position: { x: 240, y: 120 }, dragging: false }],
      currentNodes,
    );
    expect(nodeResult.nextNodesForPersistence?.[0].position).toEqual({ x: 240, y: 120 });

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
          runtimeType: 'assistant_agent',
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
          runtimeType: 'assistant_agent',
          title: 'A',
          position: { x: 80, y: 80 },
        },
        {
          id: 'card_b',
          kind: 'agent',
          templateId: 'template_b',
          runtimeType: 'assistant_agent',
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

  it('supports DeckEdge sourceHandle and targetHandle fields', () => {
    const edge: DeckEdge = {
      id: 'edge_bus_thinkgraph',
      source: 'card_magentic',
      sourceHandle: 'magone-member-right-1',
      target: 'card_thinkgraph_agent',
      targetHandle: 'magone-member-left',
      edgeType: 'magentic_option',
    };

    expect(edge.sourceHandle).toBe('magone-member-right-1');
    expect(edge.targetHandle).toBe('magone-member-left');
  });

  it('preserves handle fields when sanitizing deck edges', () => {
    const edges = sanitizeDeckEdges([
      {
        id: 'edge_bus_thinkgraph',
        source: 'card_magentic',
        sourceHandle: 'magone-member-right-1',
        target: 'card_thinkgraph_agent',
        targetHandle: 'magone-member-left',
        edgeType: 'magentic_option',
      },
    ]);

    expect(edges).toEqual<DeckEdge[]>([
      {
        id: 'edge_bus_thinkgraph',
        source: 'card_magentic',
        sourceHandle: 'magone-member-right-1',
        target: 'card_thinkgraph_agent',
        targetHandle: 'magone-member-left',
        edgeType: 'magentic_option',
      },
    ]);
  });

  it('includes sourceHandle and targetHandle in edge identity', () => {
    const firstKey = buildDeckEdgeIdentityKey({
      source: 'card_magentic',
      sourceHandle: 'bus-out-1',
      target: 'card_thinkgraph_agent',
      targetHandle: null,
      edgeType: 'magentic_option',
    });
    const secondKey = buildDeckEdgeIdentityKey({
      source: 'card_magentic',
      sourceHandle: 'bus-out-2',
      target: 'card_thinkgraph_agent',
      targetHandle: null,
      edgeType: 'magentic_option',
    });

    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toBe('card_magentic::bus-out-1::card_thinkgraph_agent::::magentic_option');
  });

  it('treats Mag One membership as one relationship regardless of bus side', () => {
    const document = createBusTestDocument();
    const currentEdges: Edge[] = [
      {
        id: 'edge_bus_thinkgraph_1',
        source: 'card_magentic',
        sourceHandle: 'magone-member-right-1',
        target: 'card_thinkgraph_agent',
        targetHandle: 'magone-member-left',
        data: { edgeType: 'magentic_option' },
      } as Edge,
    ];

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_magentic',
          sourceHandle: 'magone-member-left-2',
          target: 'card_thinkgraph_agent',
          targetHandle: 'magone-member-right',
        },
        currentEdges,
      ),
    ).toBe(false);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_magentic',
          sourceHandle: 'magone-member-right-1',
          target: 'card_thinkgraph_agent',
          targetHandle: 'magone-member-left',
        },
        currentEdges,
      ),
    ).toBe(false);
  });

  it('requires call-out to call-in and keeps reverse authority explicit', () => {
    const document = createBusTestDocument();
    const currentEdges: Edge[] = [
      {
        id: 'edge_thinkgraph_codegraph',
        source: 'card_thinkgraph_agent',
        sourceHandle: 'call-out',
        target: 'card_codegraph_agent',
        targetHandle: 'call-in',
        data: { edgeType: 'flow' },
      } as Edge,
    ];

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_thinkgraph_agent',
          sourceHandle: 'call-out',
          target: 'card_codegraph_agent',
          targetHandle: 'call-in',
        },
        [],
      ),
    ).toBe(true);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_codegraph_agent',
          sourceHandle: 'call-out',
          target: 'card_research_agent',
          targetHandle: 'call-in',
        },
        currentEdges,
      ),
    ).toBe(true);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_thinkgraph_agent',
          sourceHandle: 'call-out',
          target: 'card_codegraph_agent',
          targetHandle: 'call-in',
        },
        currentEdges,
      ),
    ).toBe(false);

    expect(
      isPlainConnectionAllowedForDocument(
        document,
        {
          source: 'card_magentic',
          sourceHandle: 'call-in',
          target: 'card_thinkgraph_agent',
          targetHandle: 'call-out',
        },
        currentEdges,
      ),
    ).toBe(false);
  });

  it('passes handle ids through React Flow edge mapping', () => {
    const [edge] = toFlowEdges(
      createBusTestDocument([
        {
          id: 'edge_bus_thinkgraph',
          source: 'card_magentic',
          sourceHandle: 'magone-member-right-3',
          target: 'card_thinkgraph_agent',
          targetHandle: 'magone-member-left',
          edgeType: 'magentic_option',
        },
      ]),
      null,
      null,
      new Set(),
    );

    expect(edge).toMatchObject({
      sourceHandle: 'magone-member-right-3',
      targetHandle: 'magone-member-left',
      reconnectable: false,
      markerEnd: undefined,
    });
  });

  it('captures handle ids when converting React Flow edges back to DeckEdge', () => {
    expect(
      buildDeckEdgeFromConnection(
        createBusTestDocument(),
        {
          source: 'card_magentic',
          sourceHandle: 'magone-member-right-4',
          target: 'card_research_agent',
          targetHandle: 'magone-member-left',
        },
        'edge_bus_research',
      ),
    ).toMatchObject({
      id: 'edge_bus_research',
      source: 'card_magentic',
      sourceHandle: 'magone-member-right-4',
      target: 'card_research_agent',
      targetHandle: 'magone-member-left',
      edgeType: 'magentic_option',
      metadata: expect.objectContaining({ role: 'callable_route' }),
    });
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
    expect(nodes.find((node) => node.id === 'card_thinkgraph_agent')).toMatchObject({
      type: 'agentCard',
      position: { x: 180, y: 140 },
      draggable: true,
      selectable: true,
    });
  });

  it('renders exactly thirteen real React Flow handles on MagenticBusNode', () => {
    // 12 non-directional membership sources + one explicit control target.
    const handles = collectHandleElements(MagenticBusNode());

    expect(handles).toHaveLength(13);
    expect(handles.map((handle) => handle.props.id)).toEqual([
      'magone-control-in',
      'magone-member-left-1',
      'magone-member-left-2',
      'magone-member-left-3',
      'magone-member-left-4',
      'magone-member-left-5',
      'magone-member-left-6',
      'magone-member-right-1',
      'magone-member-right-2',
      'magone-member-right-3',
      'magone-member-right-4',
      'magone-member-right-5',
      'magone-member-right-6',
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
    sideHandles.forEach((handle) => {
      expect(handle.props.type).toBe('source');
      expect(handle.props.isConnectableStart).toBe(true);
      expect(handle.props.isConnectableEnd).toBe(false);
    });
  });

  it('renders semantic call, membership, control, and observation handles by card role', () => {
    const workerHandles = collectHandleElements(AgentCardNode({
      data: createBusTestDocument().nodes.find((node) => node.id === 'card_research_agent')!,
    }));
    expect(workerHandles.map((handle) => handle.props.id)).toEqual([
      'call-in',
      'call-out',
      'magone-member-left',
      'magone-member-right',
    ]);

    const mainHandles = collectHandleElements(AgentCardNode({
      data: createBusTestDocument().nodes.find((node) => node.id === 'card_main_chat')!,
    }));
    expect(mainHandles.map((handle) => handle.props.id)).toEqual([
      'call-in',
      'call-out',
      'magone-control-out',
      'observe-out',
    ]);
  });

  it('resolves only the semantic relationship matrix', () => {
    const document = createBusTestDocument();
    expect(resolveCanvasConnectionEdgeType(document, {
      source: 'card_main_chat',
      sourceHandle: SEMANTIC_HANDLE_IDS.magOneControlOutput,
      target: 'card_magentic',
      targetHandle: SEMANTIC_HANDLE_IDS.magOneControlInput,
    })).toBe('magentic_control');
    expect(resolveCanvasConnectionEdgeType(document, {
      source: 'card_local_coder',
      sourceHandle: SEMANTIC_HANDLE_IDS.callInput,
      target: 'card_main_chat',
      targetHandle: SEMANTIC_HANDLE_IDS.callOutput,
    })).toBeNull();
  });

  it('keeps membership canonical and non-directional when a worker crosses the bus', () => {
    const edge: DeckEdge = {
      id: 'membership',
      source: 'card_magentic',
      sourceHandle: 'magone-member-left-1',
      target: 'card_research_agent',
      targetHandle: 'magone-member-right',
      edgeType: 'magentic_option',
    };
    const before = createBusTestDocument([edge]);
    const after = {
      ...before,
      nodes: before.nodes.map((node) =>
        node.id === 'card_research_agent'
          ? { ...node, position: { x: -400, y: node.position.y } }
          : node,
      ),
    };
    expect(after.edges[0]).toEqual(before.edges[0]);
    expect(toFlowEdges(after, null, null, new Set())[0]).toMatchObject({
      source: 'card_magentic',
      target: 'card_research_agent',
      markerEnd: undefined,
    });
  });

  it('never treats text editing keys as canvas deletion', () => {
    expect(isCanvasTextEditingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isCanvasTextEditingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isCanvasTextEditingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
  });

  it('requires confirmation, adds stronger protection, and deletes node plus edges atomically', () => {
    const document = createBusTestDocument([
      {
        id: 'call-main-coder',
        source: 'card_main_chat',
        sourceHandle: 'call-out',
        target: 'card_local_coder',
        targetHandle: 'call-in',
        edgeType: 'flow',
      },
    ]);
    const worker = document.nodes.find((node) => node.id === 'card_research_agent')!;
    expect(confirmCanvasCardDeletion(worker, 0, () => false, () => null)).toBe(false);

    const coder = document.nodes.find((node) => node.id === 'card_local_coder')!;
    expect(confirmCanvasCardDeletion(coder, 1, () => true, () => 'DELETE nope')).toBe(false);
    expect(confirmCanvasCardDeletion(coder, 1, () => true, () => 'DELETE Coder')).toBe(true);

    const next = removeCardAndConnectedEdges(document, coder.id);
    expect(next.version).toBe(document.version + 1);
    expect(next.nodes.some((node) => node.id === coder.id)).toBe(false);
    expect(next.edges.some((edge) => edge.source === coder.id || edge.target === coder.id)).toBe(false);
    expect(document.nodes.some((node) => node.id === coder.id)).toBe(true);
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
        id: 'card_main_chat',
        kind: 'agent',
        templateId: 'template_main_chat',
        runtimeType: 'assistant_agent',
        runtimeBinding: 'main_chat',
        title: 'Main Chat',
        position: { x: -180, y: 0 },
      },
      {
        id: 'card_local_coder',
        kind: 'agent',
        templateId: 'template_local_coder',
        runtimeType: 'local_coder',
        runtimeBinding: 'local_coder',
        title: 'Coder',
        position: { x: -360, y: 0 },
      },
      {
        id: 'card_magentic',
        kind: 'agent',
        templateId: 'template_magentic',
        runtimeType: 'magentic_one',
        title: 'Magentic-One',
        position: { x: 40, y: 120 },
      },
      {
        id: 'card_thinkgraph_agent',
        kind: 'agent',
        templateId: 'template_thinkgraph_agent',
        runtimeType: 'assistant_agent',
        title: 'ThinkGraph',
        position: { x: 180, y: 140 },
      },
      {
        id: 'card_codegraph_agent',
        kind: 'agent',
        templateId: 'template_codegraph_agent',
        runtimeType: 'assistant_agent',
        title: 'CodeGraph',
        position: { x: 420, y: 140 },
      },
      {
        id: 'card_research_agent',
        kind: 'agent',
        templateId: 'template_research_agent',
        runtimeType: 'assistant_agent',
        title: 'Research',
        position: { x: 660, y: 140 },
      },
    ],
    edges,
  };
}

type HandleElement = React.ReactElement<{
  id: string;
  type: string;
  isConnectableStart?: boolean;
  isConnectableEnd?: boolean;
  style: Record<string, unknown>;
}>;

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
