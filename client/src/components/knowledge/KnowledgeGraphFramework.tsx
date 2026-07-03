import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import cytoscape from 'cytoscape';
import type {
  Core,
  ElementDefinition,
  LayoutOptions,
  StylesheetJson,
} from 'cytoscape';
import fcose from 'cytoscape-fcose';

import {
  getGraphMajorGridGap,
  GRAPH_WORKSPACE,
} from '../graph/graphWorkspaceContract';
import { GRAPH_THEME } from '../graph/graphVisualTokens';

let fcoseRegistered = false;

function ensureFcoseRegistered() {
  if (fcoseRegistered) return;
  cytoscape.use(fcose);
  fcoseRegistered = true;
}

export type GraphProjectionV1 = {
  schemaVersion: string;
  projectId: string;
  nodes: Array<{
    id: string;
    label: string;
    kind: string;
    sourceRef?: string;
    provenance?: Record<string, unknown>;
    visual?: {
      nodeClass?: string;
      x?: number;
      y?: number;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
    predicate?: string;
    sourceRef?: string;
    provenance?: Record<string, unknown>;
    visual?: {
      edgeClass?: string;
      directed?: boolean;
    };
  }>;
};

type KnowledgeGraphFrameworkProps = {
  projection?: GraphProjectionV1;
  minHeight?: number;
};

function projectionToElements(projection: GraphProjectionV1 | null | undefined): {
  elements: ElementDefinition[];
  hasPresetPositions: boolean;
} {
  if (!projection) {
    return { elements: [], hasPresetPositions: false };
  }

  let positionedNodes = 0;

  const nodes: ElementDefinition[] = projection.nodes.map((node) => {
    const hasPosition =
      typeof node.visual?.x === 'number' &&
      Number.isFinite(node.visual.x) &&
      typeof node.visual?.y === 'number' &&
      Number.isFinite(node.visual.y);
    if (hasPosition) positionedNodes += 1;

    return {
      group: 'nodes',
      data: {
        id: node.id,
        label: node.label,
        kind: node.kind,
        sourceRef: node.sourceRef,
        provenance: node.provenance,
        visual: node.visual,
      },
      classes: node.visual?.nodeClass,
      ...(hasPosition ? { position: { x: node.visual!.x as number, y: node.visual!.y as number } } : {}),
    };
  });

  const edges: ElementDefinition[] = projection.edges.map((edge) => {
    return {
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        predicate: edge.predicate,
        sourceRef: edge.sourceRef,
        provenance: edge.provenance,
        visual: edge.visual,
        directed: edge.visual?.directed,
      },
      classes: edge.visual?.edgeClass,
    };
  });

  return {
    elements: [...nodes, ...edges],
    hasPresetPositions: nodes.length > 0 && positionedNodes === nodes.length,
  };
}

const cytoscapeStyle: StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': GRAPH_THEME.accent.primary,
      width: 18,
      height: 18,
      'border-color': 'rgba(245, 247, 250, 0.55)',
      'border-width': 1,
      label: 'data(label)',
      color: GRAPH_THEME.surface.text,
      'font-size': 10,
      'text-outline-color': 'rgba(11, 14, 18, 0.95)',
      'text-outline-width': 2,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 7,
      'min-zoomed-font-size': 8,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': GRAPH_THEME.edge.neutral,
      'target-arrow-color': GRAPH_THEME.edge.neutral,
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      opacity: 0.76,
      label: 'data(label)',
      color: GRAPH_THEME.surface.mutedText,
      'font-size': 8,
      'text-rotation': 'autorotate',
      'text-outline-color': 'rgba(11, 14, 18, 0.95)',
      'text-outline-width': 2,
      'min-zoomed-font-size': 6,
    },
  },
  {
    selector: 'edge[directed = false]',
    style: {
      'target-arrow-shape': 'none',
    },
  },
  {
    selector: ':selected',
    style: {
      'background-color': GRAPH_THEME.accent.solar,
      'line-color': GRAPH_THEME.accent.solar,
      'target-arrow-color': GRAPH_THEME.accent.solar,
      'border-color': GRAPH_THEME.accent.solar,
      'border-width': 2,
    },
  },
  // Presentation-only dimming for unrelated rendered elements on selection.
  {
    selector: '.kgf-dim',
    style: {
      opacity: 0.14,
      'text-opacity': 0.08,
    },
  },
];

export default function KnowledgeGraphFramework({
  projection,
  minHeight = 360,
}: KnowledgeGraphFrameworkProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const { elements, hasPresetPositions } = useMemo(
    () => projectionToElements(projection),
    [projection],
  );

  useEffect(() => {
    ensureFcoseRegistered();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!cyRef.current) {
      const cyInstance = cytoscape({
        container,
        elements: [],
        style: cytoscapeStyle,
        minZoom: GRAPH_THEME.nav.minZoom,
        maxZoom: GRAPH_THEME.nav.maxZoom,
        wheelSensitivity: GRAPH_THEME.nav.wheelDelta,
        boxSelectionEnabled: false,
        autoungrabify: false,
      });
      // Selection display only, from the already-rendered real element set:
      // node tap highlights its immediate Cytoscape neighborhood, edge tap
      // highlights the edge + its endpoints, blank tap clears. No semantic
      // computation, no data mutation, no panels.
      cyInstance.on('tap', 'node', (event) => {
        const neighborhood = event.target.closedNeighborhood();
        cyInstance.batch(() => {
          cyInstance.elements().removeClass('kgf-dim');
          cyInstance.elements().difference(neighborhood).addClass('kgf-dim');
        });
      });
      cyInstance.on('tap', 'edge', (event) => {
        const scope = event.target.union(event.target.connectedNodes());
        cyInstance.batch(() => {
          cyInstance.elements().removeClass('kgf-dim');
          cyInstance.elements().difference(scope).addClass('kgf-dim');
        });
      });
      cyInstance.on('tap', (event) => {
        if (event.target !== cyInstance) return;
        cyInstance.batch(() => cyInstance.elements().removeClass('kgf-dim'));
      });
      cyRef.current = cyInstance;
    }

    const cy = cyRef.current;
    cy.elements().remove();
    if (elements.length === 0) {
      return;
    }
    cy.add(elements);
    const layout: LayoutOptions = hasPresetPositions
      ? { name: 'preset', fit: true, padding: GRAPH_THEME.nav.fitPadding }
      : {
          name: 'fcose',
          animate: false,
          fit: true,
          padding: GRAPH_THEME.nav.fitPadding,
          nodeDimensionsIncludeLabels: true,
          randomize: false,
        } as LayoutOptions;
    cy.layout(layout).run();
  }, [elements, hasPresetPositions]);

  useEffect(() => {
    const container = containerRef.current;
    const cy = cyRef.current;
    if (!container || !cy) return;
    const observer = new ResizeObserver(() => {
      cy.resize();
      if (cy.elements().length > 0) {
        cy.fit(undefined, GRAPH_THEME.nav.fitPadding);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  const majorGridGap = getGraphMajorGridGap();
  const graphPaperStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
    backgroundImage: [
      `linear-gradient(to right, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to right, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
    ].join(', '),
    backgroundSize: [
      `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
      `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
      `${majorGridGap}px ${majorGridGap}px`,
      `${majorGridGap}px ${majorGridGap}px`,
    ].join(', '),
  };

  return (
    <div
      data-testid="knowledge-graph-framework"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight,
        overflow: 'hidden',
        background: GRAPH_THEME.background.knowledgeSurface,
      }}
    >
      <div aria-hidden="true" style={graphPaperStyle} />
      <div
        ref={containerRef}
        data-testid="cytoscape-graph"
        data-node-count={projection?.nodes?.length ?? 0}
        data-edge-count={projection?.edges?.length ?? 0}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
        }}
      />
    </div>
  );
}
