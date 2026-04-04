import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
} from "../graph/graphVisualTokens";
import {
  GRAPH_WORKSPACE,
  buildFocusedNodeSet,
  buildUndirectedNeighborMap,
  getGraphMajorGridGap,
  resolveKnowledgeSubstrateRhythm,
} from "../graph/graphWorkspaceContract";

export type KnowledgeGraphSource = "think" | "know" | "mixed";
export type KnowledgeGraphScope = "agent" | "project" | "system" | "grounded_research";

export type KnowledgeGraphNode = {
  id: string;
  rawId?: string;
  label: string;
  type: string;
  source: KnowledgeGraphSource;
  scope: KnowledgeGraphScope;
  originSource?: "think" | "know";
  degree?: number;
  last_seen_ts?: string;
};

export type KnowledgeGraphRelationship = {
  id: string;
  rawId?: string;
  from: string;
  to: string;
  type: string;
  source: KnowledgeGraphSource;
  scope: KnowledgeGraphScope;
  weight?: number;
  confidence?: number;
  last_seen_ts?: string;
  evidence_doc_id?: string;
  evidence_snippet?: string;
};

type HoverCard = {
  x: number;
  y: number;
  label: string;
  meta: string;
};

type Props = {
  entities: KnowledgeGraphNode[];
  relationships: KnowledgeGraphRelationship[];
  minHeight?: number;
  loading?: boolean;
  expandingEntityId?: string | null;
  selectionEnabled?: boolean;
  selectedEntityId?: string | null;
  selectedRelationshipId?: string | null;
  onThinkGraphExpand?: (entityId: string) => void;
  onKnowGraphExpand?: (entity: KnowledgeGraphNode) => void;
  onSelectEntity?: (entity: KnowledgeGraphNode | null) => void;
  onSelectRelationship?: (relationship: KnowledgeGraphRelationship | null) => void;
  onRelationshipInspect?: (relationship: KnowledgeGraphRelationship | null) => void;
};

type SimNode = KnowledgeGraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
  type: string;
  sourceType: KnowledgeGraphSource;
  confidence?: number;
  weight?: number;
};

const MAX_RECENT_EXPANDED = 8;
const FULL_GRAPH_NODE_THRESHOLD = 56;
const OVERVIEW_SLICE_NODE_BUDGET = 84;
const FOCUS_SLICE_NODE_BUDGET = 156;
const CONTEXT_COMPONENT_LIMIT = 4;
type KnowledgeZoomTier = "overview" | "explore" | "detail";

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

function normalizeScore(value: unknown, fallback = 0.5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return clamp(n / 100, 0.05, 1);
  return clamp(n, 0.05, 1);
}

function sourceForNode(node: KnowledgeGraphNode): KnowledgeGraphSource {
  if (node.source === "mixed") return "mixed";
  if (node.originSource === "know") return "know";
  if (node.originSource === "think") return "think";
  return node.source;
}

function sourceBadge(source: KnowledgeGraphSource): string {
  if (source === "mixed") return "Mixed";
  return source === "know" ? "Know" : "Think";
}

function relationColor(source: KnowledgeGraphSource): string {
  if (source === "mixed") return GRAPH_THEME.edge.mixed;
  return source === "know" ? GRAPH_THEME.edge.know : GRAPH_THEME.edge.think;
}

function nodeColor(source: KnowledgeGraphSource): string {
  if (source === "mixed") return GRAPH_THEME.accent.mixed;
  return source === "know" ? GRAPH_THEME.accent.know : GRAPH_THEME.accent.think;
}

function resolveKnowledgeZoomTier(zoom: number): KnowledgeZoomTier {
  if (zoom < 0.48) return "overview";
  if (zoom < 0.92) return "explore";
  return "detail";
}

function parseTimestampMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateGraphLabel(value: string, maxLength = 28): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatRelationshipLabel(value: string): string {
  return truncateGraphLabel(String(value || "").replace(/_/g, " "), 26);
}

function buildConnectedComponents(
  nodes: KnowledgeGraphNode[],
  neighborsByNode: Map<string, Set<string>>,
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  nodes.forEach((node) => {
    if (visited.has(node.id)) return;
    const queue = [node.id];
    const component: string[] = [];
    visited.add(node.id);

    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId) continue;
      component.push(nextId);
      (neighborsByNode.get(nextId) || new Set<string>()).forEach((neighborId) => {
        if (visited.has(neighborId)) return;
        visited.add(neighborId);
        queue.push(neighborId);
      });
    }

    components.push(component);
  });

  return components;
}

function findArticulationPointIds(
  nodes: KnowledgeGraphNode[],
  relationships: KnowledgeGraphRelationship[],
): Set<string> {
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node) => adjacency.set(node.id, []));
  relationships.forEach((relationship) => {
    if (!adjacency.has(relationship.from) || !adjacency.has(relationship.to)) return;
    adjacency.get(relationship.from)?.push(relationship.to);
    adjacency.get(relationship.to)?.push(relationship.from);
  });

  const visited = new Set<string>();
  const discoveredAt = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const articulation = new Set<string>();
  let time = 0;

  const visit = (nodeId: string) => {
    visited.add(nodeId);
    time += 1;
    discoveredAt.set(nodeId, time);
    lowLink.set(nodeId, time);

    let childCount = 0;
    for (const neighborId of adjacency.get(nodeId) || []) {
      if (!visited.has(neighborId)) {
        childCount += 1;
        parent.set(neighborId, nodeId);
        visit(neighborId);
        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId) || time, lowLink.get(neighborId) || time),
        );

        if (parent.get(nodeId) == null && childCount > 1) {
          articulation.add(nodeId);
        }
        if (
          parent.get(nodeId) != null &&
          (lowLink.get(neighborId) || 0) >= (discoveredAt.get(nodeId) || 0)
        ) {
          articulation.add(nodeId);
        }
      } else if (neighborId !== parent.get(nodeId)) {
        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId) || time, discoveredAt.get(neighborId) || time),
        );
      }
    }
  };

  nodes.forEach((node) => {
    if (visited.has(node.id)) return;
    parent.set(node.id, null);
    visit(node.id);
  });

  return articulation;
}

function expandNeighborhoodByBudget(params: {
  seedIds: string[];
  neighborsByNode: Map<string, Set<string>>;
  scoreByNode: Map<string, number>;
  keepIds: Set<string>;
  budget: number;
  maxDepth: number;
}) {
  const { seedIds, neighborsByNode, scoreByNode, keepIds, budget, maxDepth } = params;
  const queued = new Set<string>();
  const queue = seedIds.map((id) => ({ id, depth: 0 }));
  seedIds.forEach((id) => queued.add(id));

  while (queue.length > 0 && keepIds.size < budget) {
    const next = queue.shift();
    if (!next) continue;
    keepIds.add(next.id);
    if (next.depth >= maxDepth) continue;

    const rankedNeighbors = Array.from(neighborsByNode.get(next.id) || [])
      .filter((neighborId) => !queued.has(neighborId))
      .sort((a, b) => (scoreByNode.get(b) || 0) - (scoreByNode.get(a) || 0));

    rankedNeighbors.forEach((neighborId) => {
      queued.add(neighborId);
      queue.push({ id: neighborId, depth: next.depth + 1 });
    });
  }
}

export default function KnowledgeGraphNVL({
  entities,
  relationships,
  minHeight = 360,
  loading = false,
  expandingEntityId,
  selectionEnabled = false,
  selectedEntityId = null,
  selectedRelationshipId = null,
  onThinkGraphExpand,
  onKnowGraphExpand,
  onSelectEntity,
  onSelectRelationship,
  onRelationshipInspect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const svgSelectionRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const graphBoundsRef = useRef<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  const viewportRef = useRef({ width: 0, height: 0 });
  const hoveredEntityIdRef = useRef<string | null>(null);
  const hoveredRelationshipIdRef = useRef<string | null>(null);
  const zoomTierRef = useRef<KnowledgeZoomTier>(resolveKnowledgeZoomTier(1));

  const [layoutLocked, setLayoutLocked] = useState(false);
  const [hoverCard, setHoverCard] = useState<HoverCard | null>(null);
  const [recentExpandedEntityIds, setRecentExpandedEntityIds] = useState<string[]>([]);
  const lockedNodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  const relationshipById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.id, relationship])),
    [relationships],
  );
  const activeEntityId = selectionEnabled ? selectedEntityId : null;
  const activeRelationshipId = selectionEnabled ? selectedRelationshipId : null;

  useEffect(() => {
    if (!selectionEnabled || !selectedEntityId) return;
    if (entityById.has(selectedEntityId)) return;
    if (typeof onSelectEntity === "function") {
      onSelectEntity(null);
    }
  }, [entityById, onSelectEntity, selectedEntityId, selectionEnabled]);

  useEffect(() => {
    setRecentExpandedEntityIds((current) => current.filter((entityId) => entityById.has(entityId)));
  }, [entityById]);

  useEffect(() => {
    if (!selectionEnabled || !selectedRelationshipId) return;
    if (relationshipById.has(selectedRelationshipId)) return;
    if (typeof onSelectRelationship === "function") {
      onSelectRelationship(null);
    }
    if (typeof onRelationshipInspect === "function") {
      onRelationshipInspect(null);
    }
  }, [onRelationshipInspect, onSelectRelationship, relationshipById, selectedRelationshipId, selectionEnabled]);

  const displayedGraph = useMemo(() => {
    const filteredNodes = entities;
    const filteredNodeIds = new Set(filteredNodes.map((node) => node.id));
    const filteredRelationships = relationships.filter(
      (relationship) =>
        filteredNodeIds.has(relationship.from) && filteredNodeIds.has(relationship.to),
    );

    const degreeByNode = new Map<string, number>();
    const neighborsByNode = buildUndirectedNeighborMap(
      filteredNodes.map((node) => node.id),
      filteredRelationships.map((relationship) => ({
        source: relationship.from,
        target: relationship.to,
      })),
    );
    filteredRelationships.forEach((relationship) => {
      degreeByNode.set(relationship.from, (degreeByNode.get(relationship.from) || 0) + 1);
      degreeByNode.set(relationship.to, (degreeByNode.get(relationship.to) || 0) + 1);
    });

    const normalizedNodes = filteredNodes.map((node) => ({
      ...node,
      degree: degreeByNode.get(node.id) || node.degree || 0,
    }));
    const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
    const articulationIds = findArticulationPointIds(filteredNodes, filteredRelationships);
    const activeRelationship = activeRelationshipId
      ? filteredRelationships.find((relationship) => relationship.id === activeRelationshipId) || null
      : null;

    const recentExpandedSet = new Set(
      recentExpandedEntityIds.filter((entityId) => filteredNodeIds.has(entityId)),
    );
    const focusSeedIds = new Set<string>();
    if (activeEntityId && filteredNodeIds.has(activeEntityId)) {
      focusSeedIds.add(activeEntityId);
    }
    recentExpandedSet.forEach((entityId) => focusSeedIds.add(entityId));
    if (activeRelationship) {
      focusSeedIds.add(activeRelationship.from);
      focusSeedIds.add(activeRelationship.to);
    }

    const freshestSeenAtMs = normalizedNodes.reduce(
      (maxSeenAt, node) => Math.max(maxSeenAt, parseTimestampMs(node.last_seen_ts)),
      0,
    );
    const scoreByNode = new Map<string, number>();
    normalizedNodes.forEach((node) => {
      const seenAtMs = parseTimestampMs(node.last_seen_ts);
      const recencyScore =
        freshestSeenAtMs > 0 && seenAtMs > 0 ? (seenAtMs / freshestSeenAtMs) * 22 : 0;
      scoreByNode.set(
        node.id,
        (node.degree || 0) * 12 +
          (articulationIds.has(node.id) ? 28 : 0) +
          (recentExpandedSet.has(node.id) ? 120 : 0) +
          (focusSeedIds.has(node.id) ? 240 : 0) +
          recencyScore,
      );
    });

    const components = buildConnectedComponents(normalizedNodes, neighborsByNode);
    const componentMeta = components
      .map((componentIds) => {
        const componentNodes = componentIds
          .map((nodeId) => nodeById.get(nodeId))
          .filter((node): node is KnowledgeGraphNode => Boolean(node))
          .sort((a, b) => (scoreByNode.get(b.id) || 0) - (scoreByNode.get(a.id) || 0));
        const anchorIds: string[] = [];
        componentNodes.slice(0, 2).forEach((node) => {
          if (!anchorIds.includes(node.id)) {
            anchorIds.push(node.id);
          }
        });
        const articulationAnchor = componentNodes.find((node) => articulationIds.has(node.id));
        if (articulationAnchor && !anchorIds.includes(articulationAnchor.id)) {
          anchorIds.push(articulationAnchor.id);
        }
        const freshestNode = componentNodes.reduce<KnowledgeGraphNode | null>((best, node) => {
          if (!best) return node;
          return parseTimestampMs(node.last_seen_ts) > parseTimestampMs(best.last_seen_ts) ? node : best;
        }, null);
        if (freshestNode && !anchorIds.includes(freshestNode.id)) {
          anchorIds.push(freshestNode.id);
        }

        const componentScore =
          componentIds.length * 16 +
          componentNodes.slice(0, 3).reduce((sum, node) => sum + (scoreByNode.get(node.id) || 0), 0);

        return {
          ids: componentIds,
          anchors: anchorIds.slice(0, 3),
          hasFocus: componentIds.some((nodeId) => focusSeedIds.has(nodeId)),
          score: componentScore,
        };
      })
      .sort((a, b) => {
        if (a.hasFocus !== b.hasFocus) return a.hasFocus ? -1 : 1;
        return b.score - a.score;
      });
    const focusedComponentIds = new Set(
      componentMeta
        .filter((component) => component.hasFocus)
        .flatMap((component) => component.ids),
    );

    const rankedNodes = normalizedNodes
      .slice()
      .sort((a, b) => (scoreByNode.get(b.id) || 0) - (scoreByNode.get(a.id) || 0) || a.label.localeCompare(b.label));

    const targetBudget =
      normalizedNodes.length <= FULL_GRAPH_NODE_THRESHOLD
        ? normalizedNodes.length
        : focusSeedIds.size > 0
          ? Math.min(FOCUS_SLICE_NODE_BUDGET, Math.max(92, focusSeedIds.size * 30 + 36))
          : Math.min(OVERVIEW_SLICE_NODE_BUDGET, Math.max(54, Math.round(normalizedNodes.length * 0.58)));

    const keepIds = new Set<string>();
    if (normalizedNodes.length > targetBudget) {
      if (focusSeedIds.size > 0) {
        if (focusedComponentIds.size > 0 && focusedComponentIds.size <= targetBudget) {
          focusedComponentIds.forEach((nodeId) => keepIds.add(nodeId));
        }
        const focusSeeds = Array.from(focusSeedIds);
        expandNeighborhoodByBudget({
          seedIds: focusSeeds,
          neighborsByNode,
          scoreByNode,
          keepIds,
          budget: targetBudget,
          maxDepth: 2,
        });
        expandNeighborhoodByBudget({
          seedIds: componentMeta.filter((component) => component.hasFocus).flatMap((component) => component.anchors),
          neighborsByNode,
          scoreByNode,
          keepIds,
          budget: targetBudget,
          maxDepth: 1,
        });
        componentMeta
          .filter((component) => !component.hasFocus)
          .slice(0, CONTEXT_COMPONENT_LIMIT)
          .forEach((component) => {
            component.anchors.slice(0, 1).forEach((nodeId) => {
              if (keepIds.size < targetBudget) {
                keepIds.add(nodeId);
              }
            });
          });
      } else {
        componentMeta.forEach((component) => {
          component.anchors.slice(0, 1).forEach((nodeId) => keepIds.add(nodeId));
        });
        const overviewSeeds = componentMeta.flatMap((component) =>
          component.anchors.slice(0, component.ids.length > 10 ? 2 : 1),
        );
        expandNeighborhoodByBudget({
          seedIds: overviewSeeds,
          neighborsByNode,
          scoreByNode,
          keepIds,
          budget: targetBudget,
          maxDepth: 1,
        });
      }

      rankedNodes.forEach((node) => {
        if (keepIds.size >= targetBudget) return;
        if (keepIds.has(node.id)) return;
        const hasVisibleNeighbor = Array.from(neighborsByNode.get(node.id) || []).some((neighborId) =>
          keepIds.has(neighborId),
        );
        const isStructuralContextNode =
          articulationIds.has(node.id) || recentExpandedSet.has(node.id);
        if (
          focusSeedIds.size === 0 &&
          !hasVisibleNeighbor &&
          !isStructuralContextNode &&
          normalizedNodes.length > targetBudget
        ) {
          return;
        }
        keepIds.add(node.id);
      });
    } else {
      rankedNodes.forEach((node) => keepIds.add(node.id));
    }

    focusSeedIds.forEach((nodeId) => keepIds.add(nodeId));

    const visibleNodes = rankedNodes.filter((node) => keepIds.has(node.id));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleRelationships = filteredRelationships.filter(
      (relationship) => visibleNodeIds.has(relationship.from) && visibleNodeIds.has(relationship.to),
    );
    const visibleNeighborsByNode = buildUndirectedNeighborMap(
      visibleNodes.map((node) => node.id),
      visibleRelationships.map((relationship) => ({
        source: relationship.from,
        target: relationship.to,
      })),
    );
    const anchorNodeIds = componentMeta
      .flatMap((component) => component.anchors)
      .filter((nodeId, index, array) => visibleNodeIds.has(nodeId) && array.indexOf(nodeId) === index);

    return {
      nodes: visibleNodes,
      relationships: visibleRelationships,
      neighborsByNode: visibleNeighborsByNode,
      anchorNodeIds,
      rankedNodeIds: visibleNodes.map((node) => node.id),
    };
  }, [entities, relationships, activeEntityId, activeRelationshipId, recentExpandedEntityIds]);

  const handleNodeDoubleClick = useCallback(
    (entityId: string) => {
      const entity = entityById.get(entityId);
      if (!entity) return;
      setRecentExpandedEntityIds((current) =>
        [entity.id, ...current.filter((entry) => entry !== entity.id)].slice(0, MAX_RECENT_EXPANDED),
      );
      const expandSource = entity.originSource || (entity.source === "mixed" ? "think" : entity.source);
      if (expandSource === "think" && typeof onThinkGraphExpand === "function") {
        onThinkGraphExpand(entity.rawId || entity.id);
        return;
      }
      if (expandSource === "know" && typeof onKnowGraphExpand === "function") {
        onKnowGraphExpand(entity);
      }
    },
    [entityById, onKnowGraphExpand, onThinkGraphExpand],
  );

  const fitGraphToView = useCallback((animate = true) => {
    const svgSelection = svgSelectionRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    const bounds = graphBoundsRef.current;
    const viewport = viewportRef.current;
    if (!svgSelection || !zoomBehavior || !bounds || viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const graphWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const graphHeight = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = clamp(
      Math.min(
        (viewport.width * (1 - GRAPH_THEME.nav.fitPadding * 2)) / graphWidth,
        (viewport.height * (1 - GRAPH_THEME.nav.fitPadding * 2)) / graphHeight,
      ),
      GRAPH_THEME.nav.minZoom,
      GRAPH_THEME.nav.fitMaxZoom,
    );
    const midX = (bounds.minX + bounds.maxX) / 2;
    const midY = (bounds.minY + bounds.maxY) / 2;
    const transform = d3.zoomIdentity
      .translate(viewport.width / 2 - midX * scale, viewport.height / 2 - midY * scale)
      .scale(scale);

    if (animate) {
      svgSelection
        .transition()
        .duration(GRAPH_THEME.nav.fitDurationMs)
        .call(zoomBehavior.transform as any, transform);
      return;
    }
    svgSelection.call(zoomBehavior.transform as any, transform);
  }, []);

  const adjustZoom = useCallback((direction: 1 | -1) => {
    const svgSelection = svgSelectionRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    const svgNode = svgRef.current;
    const viewport = viewportRef.current;
    if (!svgSelection || !zoomBehavior || !svgNode || viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const currentTransform = d3.zoomTransform(svgNode);
    const nextScale = clamp(
      currentTransform.k * (direction > 0 ? GRAPH_THEME.nav.zoomStep : 1 / GRAPH_THEME.nav.zoomStep),
      GRAPH_THEME.nav.minZoom,
      GRAPH_THEME.nav.maxZoom,
    );

    svgSelection
      .transition()
      .duration(GRAPH_THEME.nav.zoomDurationMs)
      .call(
        zoomBehavior.scaleTo as any,
        nextScale,
        [viewport.width / 2, viewport.height / 2],
      );
  }, []);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = Math.max(420, Math.round(container.clientWidth || 860));
    const height = Math.max(320, Math.round(container.clientHeight || 520));
    viewportRef.current = { width, height };
    svg.attr("width", width).attr("height", height);
    svgSelectionRef.current = svg;

    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "kg-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", GRAPH_THEME.edge.neutral);
    const minorGridPath = defs
      .append("pattern")
      .attr("id", "kg-world-grid-minor")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", GRAPH_WORKSPACE.worldGridGap)
      .attr("height", GRAPH_WORKSPACE.worldGridGap)
      .append("path")
      .attr(
        "d",
        `M ${GRAPH_WORKSPACE.worldGridGap} 0 L 0 0 0 ${GRAPH_WORKSPACE.worldGridGap}`,
      )
      .attr("fill", "none")
      .attr("stroke", GRAPH_THEME.background.gridMinor);
    const majorGridGap = getGraphMajorGridGap();
    const majorGridPath = defs
      .append("pattern")
      .attr("id", "kg-world-grid-major")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", majorGridGap)
      .attr("height", majorGridGap)
      .append("path")
      .attr("d", `M ${majorGridGap} 0 L 0 0 0 ${majorGridGap}`)
      .attr("fill", "none")
      .attr("stroke", GRAPH_THEME.background.gridMajor);

    const root = svg.append("g");
    const minorGridLayer = root
      .append("rect")
      .attr("x", -GRAPH_WORKSPACE.worldOverscan)
      .attr("y", -GRAPH_WORKSPACE.worldOverscan)
      .attr("width", GRAPH_WORKSPACE.worldOverscan * 2)
      .attr("height", GRAPH_WORKSPACE.worldOverscan * 2)
      .attr("fill", "url(#kg-world-grid-minor)");
    const majorGridLayer = root
      .append("rect")
      .attr("x", -GRAPH_WORKSPACE.worldOverscan)
      .attr("y", -GRAPH_WORKSPACE.worldOverscan)
      .attr("width", GRAPH_WORKSPACE.worldOverscan * 2)
      .attr("height", GRAPH_WORKSPACE.worldOverscan * 2)
      .attr("fill", "url(#kg-world-grid-major)");
    const applySubstrateRhythm = (zoomLevel: number) => {
      const rhythm = resolveKnowledgeSubstrateRhythm(zoomLevel);
      minorGridPath.attr("stroke-width", rhythm.minorLineWidth);
      majorGridPath.attr("stroke-width", rhythm.majorLineWidth);
      minorGridLayer.attr("opacity", rhythm.minorOpacity);
      majorGridLayer.attr("opacity", rhythm.majorOpacity);
    };
    applySubstrateRhythm(1);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([GRAPH_THEME.nav.minZoom, GRAPH_THEME.nav.maxZoom])
      .wheelDelta((event) => -event.deltaY * GRAPH_THEME.nav.wheelDelta)
      .on("zoom", (event) => {
        root.attr("transform", event.transform.toString());
        applySubstrateRhythm(event.transform.k);
        const nextZoomTier = resolveKnowledgeZoomTier(event.transform.k);
        if (nextZoomTier !== zoomTierRef.current) {
          zoomTierRef.current = nextZoomTier;
          applyPresentationState(nextZoomTier);
        }
      });
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    const links: SimLink[] = displayedGraph.relationships.map((relationship) => ({
      id: relationship.id,
      source: relationship.from,
      target: relationship.to,
      type: relationship.type || "related_to",
      sourceType: relationship.source,
      confidence: relationship.confidence,
      weight: relationship.weight,
    }));

    const nodes: SimNode[] = displayedGraph.nodes.map((entity) => ({ ...entity }));
    if (layoutLocked) {
      nodes.forEach((node) => {
        const lockedPosition = lockedNodePositionsRef.current.get(node.id);
        if (!lockedPosition) return;
        node.x = lockedPosition.x;
        node.y = lockedPosition.y;
        node.fx = lockedPosition.x;
        node.fy = lockedPosition.y;
      });
    }
    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance((link) => {
            const score = normalizeScore(link.confidence ?? link.weight ?? 0.5);
            return 170 - score * 42;
          })
          .strength(0.24),
      )
      .force("charge", d3.forceManyBody().strength(-360))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((node) => 17 + Math.sqrt(Math.max(1, node.degree || 1)) * 3),
      );
    if (layoutLocked) {
      simulation.alpha(0);
      simulation.stop();
    }
    let autoFitFrame: number | null = null;
    let hasAutoFitted = false;
    zoomTierRef.current = resolveKnowledgeZoomTier(1);
    const updateBounds = () => {
      if (nodes.length === 0) {
        graphBoundsRef.current = null;
        return;
      }

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      nodes.forEach((node) => {
        const radius = clamp(9 + Math.sqrt(Math.max(1, node.degree || 1)) * 2.3, 9, 24) + 18;
        const x = node.x ?? width / 2;
        const y = node.y ?? height / 2;
        minX = Math.min(minX, x - radius);
        minY = Math.min(minY, y - radius);
        maxX = Math.max(maxX, x + radius);
        maxY = Math.max(maxY, y + radius);
      });

      graphBoundsRef.current = { minX, minY, maxX, maxY };
    };

    const lineLayer = root.append("g").attr("stroke-opacity", 0.78);
    const lineSelection = lineLayer
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("marker-end", "url(#kg-arrow)")
      .style("cursor", "pointer")
      .on("click", (event, link) => {
        if (!selectionEnabled) return;
        event.stopPropagation();
        hoveredEntityIdRef.current = null;
        hoveredRelationshipIdRef.current = null;
        setHoverCard(null);
        if (typeof onSelectEntity === "function") {
          onSelectEntity(null);
        }
        const nextRelationship =
          activeRelationshipId === link.id ? null : relationshipById.get(link.id) || null;
        if (typeof onSelectRelationship === "function") {
          onSelectRelationship(nextRelationship);
        }
        if (typeof onRelationshipInspect === "function") {
          onRelationshipInspect(nextRelationship);
        }
      })
      .on("mouseenter", (event, link) => {
        hoveredRelationshipIdRef.current = link.id;
        if (!containerRef.current) return;
        const bounds = containerRef.current.getBoundingClientRect();
        setHoverCard({
          x: clamp(event.clientX - bounds.left + 12, 8, Math.max(8, bounds.width - 220)),
          y: clamp(event.clientY - bounds.top + 12, 8, Math.max(8, bounds.height - 90)),
          label: link.type || "Relationship",
          meta: link.sourceType === "know" ? "Know relationship" : "Think relationship",
        });
        applyPresentationState();
      })
      .on("mouseleave", (_event, link) => {
        if (hoveredRelationshipIdRef.current === link.id) {
          hoveredRelationshipIdRef.current = null;
        }
        setHoverCard(null);
        applyPresentationState();
      });

    const relationshipLabelLayer = root.append("g").style("pointer-events", "none");
    const relationshipLabelSelection = relationshipLabelLayer
      .selectAll("text")
      .data(links)
      .join("text")
      .attr("fill", GRAPH_THEME.tooltip.text)
      .attr("font-size", 10)
      .attr("font-weight", 500)
      .attr("text-anchor", "middle")
      .attr("paint-order", "stroke")
      .attr("stroke", GRAPH_THEME.background.knowledgeSurface)
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .text((link) => formatRelationshipLabel(link.type || "related_to"));

    const nodeLayer = root.append("g");
    const nodeSelection = nodeLayer
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, node) => {
            if (layoutLocked) return;
            if (!event.active) simulation.alphaTarget(0.25).restart();
            node.fx = node.x;
            node.fy = node.y;
          })
          .on("drag", (event, node) => {
            if (layoutLocked) return;
            node.fx = event.x;
            node.fy = event.y;
          })
          .on("end", (event, node) => {
            if (layoutLocked) return;
            if (!event.active) simulation.alphaTarget(0);
            node.fx = null;
            node.fy = null;
          }),
      );

    const nodeCircleSelection = nodeSelection
      .append("circle")
      .attr("r", (node) => clamp(9 + Math.sqrt(Math.max(1, node.degree || 1)) * 2.3, 9, 24))
      .attr("fill", (node) => nodeColor(sourceForNode(node)))
      .on("click", (event, node) => {
        if (!selectionEnabled) return;
        event.stopPropagation();
        hoveredEntityIdRef.current = null;
        hoveredRelationshipIdRef.current = null;
        setHoverCard(null);
        if (typeof onSelectRelationship === "function") {
          onSelectRelationship(null);
        }
        if (typeof onRelationshipInspect === "function") {
          onRelationshipInspect(null);
        }
        if (typeof onSelectEntity === "function") {
          onSelectEntity(activeEntityId === node.id ? null : entityById.get(node.id) || null);
        }
      })
      .on("dblclick", (event, node) => {
        if (!selectionEnabled) return;
        event.stopPropagation();
        handleNodeDoubleClick(node.id);
      })
      .on("mouseenter", (event, node) => {
        hoveredEntityIdRef.current = node.id;
        if (!containerRef.current) return;
        const bounds = containerRef.current.getBoundingClientRect();
        setHoverCard({
          x: clamp(event.clientX - bounds.left + 12, 8, Math.max(8, bounds.width - 220)),
          y: clamp(event.clientY - bounds.top + 12, 8, Math.max(8, bounds.height - 90)),
          label: node.label || node.id,
          meta: `${node.type || "Entity"} • ${sourceBadge(sourceForNode(node))}`,
        });
        applyPresentationState();
      })
      .on("mouseleave", (_event, node) => {
        if (hoveredEntityIdRef.current === node.id) {
          hoveredEntityIdRef.current = null;
        }
        setHoverCard(null);
        applyPresentationState();
      });

    const nodeLabelSelection = nodeSelection
      .append("text")
      .attr("y", (node) => clamp(9 + Math.sqrt(Math.max(1, node.degree || 1)) * 2.3, 9, 24) + 14)
      .attr("text-anchor", "middle")
      .attr("fill", GRAPH_THEME.tooltip.text)
      .attr("font-size", 10)
      .attr("font-weight", 500)
      .attr("paint-order", "stroke")
      .attr("stroke", GRAPH_THEME.background.knowledgeSurface)
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .style("pointer-events", "none")
      .text((node) => truncateGraphLabel(node.label || node.id));

    function applyPresentationState(tier: KnowledgeZoomTier = zoomTierRef.current) {
      const focusEntityId = activeEntityId || hoveredEntityIdRef.current;
      const focusRelationshipId = activeRelationshipId || hoveredRelationshipIdRef.current;
      const relationshipSet = new Set(
        displayedGraph.relationships
          .filter((relationship) => {
            if (!focusEntityId) return false;
            return relationship.from === focusEntityId || relationship.to === focusEntityId;
          })
          .map((relationship) => relationship.id),
      );
      const neighborSet = buildFocusedNodeSet(focusEntityId, displayedGraph.neighborsByNode);
      const focusedRelationshipNodeIds = new Set<string>();
      const focusedRelationship =
        focusRelationshipId != null
          ? relationshipById.get(focusRelationshipId) || null
          : null;
      if (focusedRelationship) {
        focusedRelationshipNodeIds.add(focusedRelationship.from);
        focusedRelationshipNodeIds.add(focusedRelationship.to);
      }

      const nodeLabelIds = new Set<string>();
      recentExpandedEntityIds.forEach((nodeId) => {
        if (displayedGraph.rankedNodeIds.includes(nodeId)) {
          nodeLabelIds.add(nodeId);
        }
      });
      if (focusRelationship) {
        nodeLabelIds.add(focusRelationship.from);
        nodeLabelIds.add(focusRelationship.to);
      }
      if (focusEntityId) {
        nodeLabelIds.add(focusEntityId);
        Array.from(displayedGraph.neighborsByNode.get(focusEntityId) || []).forEach((nodeId) =>
          nodeLabelIds.add(nodeId),
        );
      }
      if (tier === "explore") {
        displayedGraph.anchorNodeIds
          .slice(0, focusEntityId ? 3 : 6)
          .forEach((nodeId) => nodeLabelIds.add(nodeId));
      }
      if (tier === "detail") {
        displayedGraph.rankedNodeIds
          .slice(0, focusEntityId ? 10 : 14)
          .forEach((nodeId) => nodeLabelIds.add(nodeId));
      }

      const relationshipLabelIds = new Set<string>();
      if (focusRelationshipId) {
        relationshipLabelIds.add(focusRelationshipId);
      }
      if (tier === "detail" && focusEntityId) {
        displayedGraph.relationships
          .filter((relationship) => relationship.from === focusEntityId || relationship.to === focusEntityId)
          .slice(0, 4)
          .forEach((relationship) => relationshipLabelIds.add(relationship.id));
      }

      lineSelection
        .attr("stroke", (link) => {
          if (focusRelationshipId === link.id || activeRelationshipId === link.id) {
            return GRAPH_THEME.edge.selected;
          }
          if (hoveredRelationshipIdRef.current === link.id) {
            return GRAPH_THEME.edge.hover;
          }
          return relationColor(link.sourceType);
        })
        .attr("stroke-width", (link) => {
          const baseWidth =
            tier === "overview"
              ? 0.72
              : tier === "explore"
                ? 0.9
                : 1.05;
          const emphasis = normalizeScore(link.confidence ?? link.weight ?? 0.4) * 1.4;
          if (focusRelationshipId === link.id) {
            return 2 + emphasis;
          }
          return baseWidth + emphasis;
        })
        .style("opacity", (link) => {
          if (focusRelationshipId) {
            return link.id === focusRelationshipId ? 0.98 : tier === "overview" ? 0.06 : 0.1;
          }
          if (!focusEntityId) {
            if (tier === "overview") return 0.18;
            if (tier === "explore") return 0.28;
            return 0.38;
          }
          return relationshipSet.has(link.id) ? (tier === "detail" ? 0.9 : 0.84) : tier === "overview" ? 0.05 : 0.08;
        });

      nodeSelection.style("opacity", (node) => {
        if (focusRelationshipId && focusedRelationshipNodeIds.size > 0) {
          return focusedRelationshipNodeIds.has(node.id) ? 1 : tier === "overview" ? 0.16 : 0.22;
        }
        if (!focusEntityId) return tier === "overview" ? 0.9 : 0.96;
        if (node.id === focusEntityId) return 1;
        return neighborSet.has(node.id) ? (tier === "detail" ? 0.9 : 0.84) : tier === "overview" ? 0.16 : 0.2;
      });

      nodeCircleSelection
        .attr("fill-opacity", (node) => (node.id === activeEntityId ? 0.96 : tier === "overview" ? 0.78 : 0.84))
        .attr("stroke", (node) => {
          if (node.id === activeEntityId) return GRAPH_THEME.accent.primary;
          if (node.id === hoveredEntityIdRef.current) return GRAPH_THEME.accent.hover;
          if (focusedRelationshipNodeIds.has(node.id)) return GRAPH_THEME.accent.primary;
          return GRAPH_THEME.surface.border;
        })
        .attr("stroke-width", (node) => {
          if (node.id === activeEntityId) return 2.1;
          if (node.id === hoveredEntityIdRef.current || focusedRelationshipNodeIds.has(node.id)) return 1.6;
          return 1.2;
        })
        .style("filter", (node) =>
          node.id === activeEntityId ? `drop-shadow(0 0 10px ${GRAPH_THEME.accent.primaryGlow})` : "none",
        );

      nodeLabelSelection
        .attr("display", (node) => (nodeLabelIds.has(node.id) ? null : "none"))
        .style("opacity", (node) =>
          nodeLabelIds.has(node.id) ? (tier === "detail" ? 0.94 : 0.76) : 0,
        );

      relationshipLabelSelection
        .attr("display", (link) => (relationshipLabelIds.has(link.id) ? null : "none"))
        .style("opacity", (link) =>
          relationshipLabelIds.has(link.id)
            ? focusRelationshipId === link.id
              ? 0.92
              : 0.66
            : 0,
        );
    }

    applyPresentationState();

    svg.on("click", () => {
      setHoverCard(null);
      hoveredEntityIdRef.current = null;
      hoveredRelationshipIdRef.current = null;
      applyPresentationState();
      if (!selectionEnabled) {
        return;
      }
      if (typeof onSelectEntity === "function") {
        onSelectEntity(null);
      }
      if (typeof onSelectRelationship === "function") {
        onSelectRelationship(null);
      }
      if (typeof onRelationshipInspect === "function") {
        onRelationshipInspect(null);
      }
    });

    simulation.on("tick", () => {
      updateBounds();
      lineSelection
        .attr("x1", (link) => ((link.source as SimNode).x ?? 0))
        .attr("y1", (link) => ((link.source as SimNode).y ?? 0))
        .attr("x2", (link) => ((link.target as SimNode).x ?? 0))
        .attr("y2", (link) => ((link.target as SimNode).y ?? 0));
      relationshipLabelSelection
        .attr("x", (link) => (((link.source as SimNode).x ?? 0) + ((link.target as SimNode).x ?? 0)) / 2)
        .attr("y", (link) => ((((link.source as SimNode).y ?? 0) + ((link.target as SimNode).y ?? 0)) / 2) - 8);

      nodeSelection.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
      if (!layoutLocked) {
        lockedNodePositionsRef.current = new Map(
          nodes.map((node) => [
            node.id,
            { x: node.x ?? width / 2, y: node.y ?? height / 2 },
          ]),
        );
      }

      if (!hasAutoFitted && graphBoundsRef.current) {
        hasAutoFitted = true;
        autoFitFrame = window.requestAnimationFrame(() => {
          fitGraphToView(false);
        });
      }
    });

    return () => {
      if (autoFitFrame != null) {
        window.cancelAnimationFrame(autoFitFrame);
      }
      simulation.stop();
      svg.on(".zoom", null);
      svgSelectionRef.current = null;
      zoomBehaviorRef.current = null;
    };
  }, [
    displayedGraph,
    activeEntityId,
    activeRelationshipId,
    handleNodeDoubleClick,
    layoutLocked,
    onRelationshipInspect,
    relationshipById,
    fitGraphToView,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight,
        borderRadius: 10,
        border: `1px solid ${GRAPH_THEME.surface.border}`,
        overflow: "hidden",
        background: GRAPH_THEME.background.knowledgeSurface,
        backgroundSize: GRAPH_THEME.background.knowledgePatternSize,
      }}
    >
      <div style={graphControlStackStyle}>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => adjustZoom(1)}
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => adjustZoom(-1)}
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Fit view"
          onClick={() => fitGraphToView(true)}
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2.25 5.25V2.25h3M8.75 2.25h3v3M11.75 8.75v3h-3M5.25 11.75h-3v-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label={layoutLocked ? "Unlock graph layout" : "Lock graph layout"}
          onClick={() => setLayoutLocked((current) => !current)}
          style={graphControlButtonStyle({
            color: layoutLocked ? GRAPH_THEME.accent.primary : GRAPH_THEME.controls.text,
          })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M4.5 6V4.75a2.5 2.5 0 1 1 5 0V6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
            <rect x="3" y="6" width="8" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
          </svg>
        </button>
      </div>

      <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {hoverCard && (
        <div
          className="text-xs"
          style={{
            position: "absolute",
            left: hoverCard.x,
            top: hoverCard.y,
            zIndex: 4,
            maxWidth: 240,
            padding: "7px 9px",
            borderRadius: 8,
            border: GRAPH_THEME.tooltip.border,
            background: GRAPH_THEME.tooltip.background,
            color: GRAPH_THEME.tooltip.text,
            pointerEvents: "none",
            boxShadow: GRAPH_THEME.tooltip.shadow,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: GRAPH_THEME.tooltip.title,
              marginBottom: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hoverCard.label}
          </div>
          <div style={{ opacity: 0.84 }}>{hoverCard.meta}</div>
        </div>
      )}

      {(loading || expandingEntityId) && (
        <div
          className="text-xs"
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            zIndex: 4,
            padding: "5px 8px",
            borderRadius: 6,
            border: `1px solid ${GRAPH_THEME.surface.border}`,
            background: GRAPH_THEME.tooltip.background,
            color: GRAPH_THEME.tooltip.text,
            pointerEvents: "none",
          }}
        >
          {expandingEntityId ? `Expanding ${expandingEntityId}...` : "Loading graph..."}
        </div>
      )}
    </div>
  );
}
