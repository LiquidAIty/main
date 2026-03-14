import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

export type KnowledgeGraphSource = "think" | "know" | "mixed";

export type KnowledgeGraphNode = {
  id: string;
  rawId?: string;
  label: string;
  type: string;
  source: KnowledgeGraphSource;
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
  type: string;
  source: string;
};

type Props = {
  entities: KnowledgeGraphNode[];
  relationships: KnowledgeGraphRelationship[];
  loading?: boolean;
  expandingEntityId?: string | null;
  onThinkGraphExpand?: (entityId: string) => void;
  onKnowGraphExpand?: (entity: KnowledgeGraphNode) => void;
  onRelationshipInspect?: (relationship: KnowledgeGraphRelationship | null) => void;
};

type NodeFilter = "all" | "think" | "know";
type NodeLimit = 60 | 120 | 200;

type SimNode = KnowledgeGraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
  type: string;
  sourceType: KnowledgeGraphSource;
  confidence?: number;
  weight?: number;
};

const THINK_NODE = "#43c3c7";
const KNOW_NODE = "#9a63d4";
const MIXED_NODE = "#c9d4e6";

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
  if (source === "mixed") return "Both Sources";
  return source === "know" ? "KnowGraph" : "ThinkGraph";
}

function sourceFilterOptionLabel(source: "think" | "know"): string {
  return source === "think" ? "ThinkGraph" : "KnowGraph";
}

function relationColor(source: KnowledgeGraphSource): string {
  return source === "know" ? "rgba(154,99,212,0.60)" : "rgba(67,195,199,0.72)";
}

function nodeColor(source: KnowledgeGraphSource): string {
  if (source === "mixed") return MIXED_NODE;
  return source === "know" ? KNOW_NODE : THINK_NODE;
}

export default function KnowledgeGraphNVL({
  entities,
  relationships,
  loading = false,
  expandingEntityId,
  onThinkGraphExpand,
  onKnowGraphExpand,
  onRelationshipInspect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);
  const [activeRelationshipId, setActiveRelationshipId] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<HoverCard | null>(null);
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const [nodeLimit, setNodeLimit] = useState<NodeLimit>(120);

  const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  const relationshipById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.id, relationship])),
    [relationships],
  );

  useEffect(() => {
    if (activeEntityId && !entityById.has(activeEntityId)) {
      setActiveEntityId(null);
    }
  }, [activeEntityId, entityById]);

  useEffect(() => {
    if (activeRelationshipId && !relationshipById.has(activeRelationshipId)) {
      setActiveRelationshipId(null);
      if (typeof onRelationshipInspect === "function") {
        onRelationshipInspect(null);
      }
    }
  }, [activeRelationshipId, relationshipById, onRelationshipInspect]);

  const displayedGraph = useMemo(() => {
    const sourceMatches = (node: KnowledgeGraphNode) => {
      if (nodeFilter === "all") return true;
      const source = sourceForNode(node);
      if (nodeFilter === "think") return source === "think" || source === "mixed";
      return source === "know" || source === "mixed";
    };

    const filteredNodes = entities.filter(sourceMatches);
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

    const filteredRelationships = relationships.filter((relationship) => {
      if (!filteredNodeIds.has(relationship.from) || !filteredNodeIds.has(relationship.to)) return false;
      if (nodeFilter === "all") return true;
      if (nodeFilter === "think") return relationship.source === "think" || relationship.source === "mixed";
      return relationship.source === "know" || relationship.source === "mixed";
    });

    const degreeByNode = new Map<string, number>();
    filteredRelationships.forEach((relationship) => {
      degreeByNode.set(relationship.from, (degreeByNode.get(relationship.from) || 0) + 1);
      degreeByNode.set(relationship.to, (degreeByNode.get(relationship.to) || 0) + 1);
    });

    const rankedNodes = filteredNodes
      .map((node) => ({
        ...node,
        degree: degreeByNode.get(node.id) || node.degree || 0,
      }))
      .sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.label.localeCompare(b.label));

    const keepIds = new Set(rankedNodes.slice(0, nodeLimit).map((n) => n.id));
    if (activeEntityId && filteredNodeIds.has(activeEntityId)) {
      keepIds.add(activeEntityId);
    }

    const nodes = rankedNodes.filter((n) => keepIds.has(n.id));
    const relationshipsById = filteredRelationships.filter(
      (relationship) => keepIds.has(relationship.from) && keepIds.has(relationship.to),
    );

    const neighborsByNode = new Map<string, Set<string>>();
    relationshipsById.forEach((relationship) => {
      if (!neighborsByNode.has(relationship.from)) neighborsByNode.set(relationship.from, new Set());
      if (!neighborsByNode.has(relationship.to)) neighborsByNode.set(relationship.to, new Set());
      neighborsByNode.get(relationship.from)?.add(relationship.to);
      neighborsByNode.get(relationship.to)?.add(relationship.from);
    });

    return {
      nodes,
      relationships: relationshipsById,
      neighborsByNode,
    };
  }, [entities, relationships, nodeFilter, nodeLimit, activeEntityId]);

  const handleNodeDoubleClick = useCallback(
    (entityId: string) => {
      const entity = entityById.get(entityId);
      if (!entity) return;
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

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = Math.max(420, Math.round(container.clientWidth || 860));
    const height = Math.max(320, Math.round(container.clientHeight || 520));
    svg.attr("width", width).attr("height", height);

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
      .attr("fill", "#6b7280");

    const root = svg.append("g");
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event) => root.attr("transform", event.transform.toString()));
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
    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((d) => {
            const score = normalizeScore(d.confidence ?? d.weight ?? 0.5);
            return 165 - score * 55;
          })
          .strength(0.3),
      )
      .force("charge", d3.forceManyBody().strength(-430))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => 18 + Math.sqrt(Math.max(1, d.degree || 1)) * 3.5));

    const relationshipSet = new Set(
      displayedGraph.relationships
        .filter((relationship) => {
          if (!activeEntityId) return false;
          return relationship.from === activeEntityId || relationship.to === activeEntityId;
        })
        .map((relationship) => relationship.id),
    );

    const neighborSet = activeEntityId
      ? new Set(Array.from(displayedGraph.neighborsByNode.get(activeEntityId) || []))
      : new Set<string>();

    const lineLayer = root.append("g").attr("stroke-opacity", 0.95);
    const lineSelection = lineLayer
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => relationColor(d.sourceType))
      .attr("stroke-width", (d) => 1.1 + normalizeScore(d.confidence ?? d.weight ?? 0.4) * 3.1)
      .attr("marker-end", "url(#kg-arrow)")
      .style("cursor", "pointer")
      .style("opacity", (d) => {
        if (activeRelationshipId) return d.id === activeRelationshipId ? 1 : 0.2;
        if (!activeEntityId) return 0.82;
        return relationshipSet.has(d.id) ? 1 : 0.1;
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        setActiveEntityId(null);
        setActiveRelationshipId(d.id);
        if (typeof onRelationshipInspect === "function") {
          onRelationshipInspect(relationshipById.get(d.id) || null);
        }
      })
      .on("mouseenter", (event, d) => {
        if (!containerRef.current) return;
        const r = containerRef.current.getBoundingClientRect();
        setHoverCard({
          x: clamp(event.clientX - r.left + 12, 8, Math.max(8, r.width - 220)),
          y: clamp(event.clientY - r.top + 12, 8, Math.max(8, r.height - 90)),
          label: d.type || "Relationship",
          type: "Relationship",
          source: d.sourceType === "know" ? "KnowGraph" : "ThinkGraph",
        });
      })
      .on("mouseleave", () => {
        setHoverCard(null);
      });

    const nodeLayer = root.append("g");
    const nodeSelection = nodeLayer
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .style("opacity", (d) => {
        if (!activeEntityId) return 1;
        if (d.id === activeEntityId) return 1;
        return neighborSet.has(d.id) ? 0.95 : 0.18;
      })
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    nodeSelection
      .append("circle")
      .attr("r", (d) => clamp(10 + Math.sqrt(Math.max(1, d.degree || 1)) * 2.7, 10, 29))
      .attr("fill", (d) => nodeColor(sourceForNode(d)))
      .attr("stroke", (d) => (d.id === activeEntityId ? "#f8fafc" : "#0f172a"))
      .attr("stroke-width", (d) => (d.id === activeEntityId ? 2.5 : 1.2))
      .on("click", (event, d) => {
        event.stopPropagation();
        setActiveRelationshipId(null);
        if (typeof onRelationshipInspect === "function") {
          onRelationshipInspect(null);
        }
        setActiveEntityId((prev) => (prev === d.id ? null : d.id));
      })
      .on("dblclick", (event, d) => {
        event.stopPropagation();
        handleNodeDoubleClick(d.id);
      })
      .on("mouseenter", (event, d) => {
        if (!containerRef.current) return;
        const r = containerRef.current.getBoundingClientRect();
        setHoverCard({
          x: clamp(event.clientX - r.left + 12, 8, Math.max(8, r.width - 220)),
          y: clamp(event.clientY - r.top + 12, 8, Math.max(8, r.height - 90)),
          label: d.label || d.id,
          type: d.type || "Entity",
          source: sourceBadge(sourceForNode(d)),
        });
      })
      .on("mouseleave", () => {
        setHoverCard(null);
      });

    nodeSelection
      .append("text")
      .text((d) => String(d.label || d.id))
      .attr("x", 14)
      .attr("y", 4)
      .attr("fill", "#e2e8f0")
      .attr("font-size", 11)
      .attr("font-weight", 500)
      .attr("paint-order", "stroke")
      .attr("stroke", "rgba(2, 6, 23, 0.9)")
      .attr("stroke-width", 3);

    let edgeLabelSelection: d3.Selection<SVGTextElement, SimLink, SVGGElement, unknown> | null = null;
    if (links.length <= 80) {
      edgeLabelSelection = root
        .append("g")
        .selectAll<SVGTextElement, SimLink>("text")
        .data(links)
        .join("text")
        .attr("fill", "rgba(226,232,240,0.8)")
        .attr("font-size", 10)
        .attr("text-anchor", "middle")
        .attr("pointer-events", "none")
        .text((d) => String(d.type || "related_to").replace(/_/g, " "))
        .style("opacity", (d) => {
          if (activeRelationshipId) return d.id === activeRelationshipId ? 1 : 0.05;
          if (!activeEntityId) return 0.6;
          return relationshipSet.has(d.id) ? 0.9 : 0.05;
        });
    }

    svg.on("click", () => {
      setHoverCard(null);
      setActiveEntityId(null);
      setActiveRelationshipId(null);
      if (typeof onRelationshipInspect === "function") {
        onRelationshipInspect(null);
      }
    });

    simulation.on("tick", () => {
      lineSelection
        .attr("x1", (d) => ((d.source as SimNode).x ?? 0))
        .attr("y1", (d) => ((d.source as SimNode).y ?? 0))
        .attr("x2", (d) => ((d.target as SimNode).x ?? 0))
        .attr("y2", (d) => ((d.target as SimNode).y ?? 0));

      nodeSelection.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      if (edgeLabelSelection) {
        edgeLabelSelection
          .attr("x", (d) => ((((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2))
          .attr("y", (d) => ((((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2) - 4);
      }
    });

    return () => {
      simulation.stop();
      svg.on(".zoom", null);
    };
  }, [
    displayedGraph,
    activeEntityId,
    activeRelationshipId,
    handleNodeDoubleClick,
    onRelationshipInspect,
    relationshipById,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 360,
        borderRadius: 10,
        border: "1px solid #334155",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 20% 18%, rgba(79,162,173,0.14), transparent 40%), radial-gradient(circle at 82% 22%, rgba(131,88,164,0.14), transparent 48%), #060a11",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          right: 8,
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "6px 8px",
          borderRadius: 8,
          border: "1px solid rgba(100,116,139,0.4)",
          background: "rgba(7, 12, 20, 0.86)",
        }}
      >
        <div style={{ color: "#cbd5e1", fontSize: 11 }}>
          Click node to focus. Double-click to expand.
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>
            Source{" "}
            <select
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value as NodeFilter)}
              style={{
                marginLeft: 4,
                background: "#0f172a",
                color: "#e2e8f0",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "2px 4px",
              }}
            >
              <option value="all">All</option>
              <option value="think">{sourceFilterOptionLabel("think")}</option>
              <option value="know">{sourceFilterOptionLabel("know")}</option>
            </select>
          </label>
          <label style={{ color: "#94a3b8", fontSize: 11 }}>
            Max nodes{" "}
            <select
              value={String(nodeLimit)}
              onChange={(e) => setNodeLimit(Number(e.target.value) as NodeLimit)}
              style={{
                marginLeft: 4,
                background: "#0f172a",
                color: "#e2e8f0",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "2px 4px",
              }}
            >
              <option value="60">60</option>
              <option value="120">120</option>
              <option value="200">200</option>
            </select>
          </label>
        </div>
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
            border: "1px solid rgba(148,163,184,0.3)",
            background: "rgba(6, 10, 16, 0.95)",
            color: "#e5edf5",
            pointerEvents: "none",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: "#f8fafc",
              marginBottom: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hoverCard.label}
          </div>
          <div style={{ opacity: 0.9 }}>Type: {hoverCard.type}</div>
          <div style={{ opacity: 0.9 }}>Source: {hoverCard.source}</div>
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
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid rgba(100,116,139,0.45)",
            background: "rgba(8, 12, 18, 0.92)",
            color: "#dbe7f3",
            pointerEvents: "none",
          }}
        >
          {expandingEntityId ? `Expanding ${expandingEntityId}...` : "Loading graph..."}
        </div>
      )}
    </div>
  );
}
