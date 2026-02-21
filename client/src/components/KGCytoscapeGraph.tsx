import { useEffect, useMemo, useRef } from "react";
import cytoscape, { type Core, type EdgeSingular, type ElementDefinition, type NodeSingular } from "cytoscape";

export type KgViewNode = {
  id: string;
  label: string;
  type: string;
  last_seen_ts?: string;
  degree?: number;
};

export type KgViewEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  weight?: number;
  confidence?: number;
  last_seen_ts?: string;
  evidence_doc_id?: string;
  evidence_snippet?: string;
};

type Props = {
  nodes: KgViewNode[];
  edges: KgViewEdge[];
  loading?: boolean;
  expandingNodeId?: string | null;
  onNodeExpand?: (nodeId: string) => void;
  onEdgeInspect?: (edge: KgViewEdge | null) => void;
  searchText?: string;
  focusSearchToken?: number;
};

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

function typeColor(rawType: string): string {
  const t = String(rawType || "unknown").toLowerCase();
  if (t === "person") return "#6ea8fe";
  if (t === "organization") return "#63e6be";
  if (t === "concept") return "#ffd43b";
  if (t === "tool") return "#ff922b";
  if (t === "event") return "#f783ac";
  if (t === "document") return "#91a7ff";
  return "#94a3b8";
}

function edgeFromElement(edge: EdgeSingular): KgViewEdge {
  return {
    id: String(edge.id()),
    source: String(edge.data("source") ?? ""),
    target: String(edge.data("target") ?? ""),
    type: String(edge.data("type") ?? "related_to"),
    weight: Number(edge.data("weight") ?? 0),
    confidence: Number(edge.data("confidence") ?? 0),
    last_seen_ts: String(edge.data("last_seen_ts") ?? ""),
    evidence_doc_id: String(edge.data("evidence_doc_id") ?? ""),
    evidence_snippet: String(edge.data("evidence_snippet") ?? ""),
  };
}

export default function KGCytoscapeGraph({
  nodes,
  edges,
  loading = false,
  expandingNodeId,
  onNodeExpand,
  onEdgeInspect,
  searchText = "",
  focusSearchToken = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const elements = useMemo<ElementDefinition[]>(() => {
    const out: ElementDefinition[] = [];

    nodes.forEach((n) => {
      const degree = Math.max(0, Number(n.degree ?? 0));
      out.push({
        group: "nodes",
        data: {
          id: n.id,
          label: n.label || n.id,
          type: n.type || "unknown",
          color: typeColor(n.type || "unknown"),
          degree,
          last_seen_ts: n.last_seen_ts || "",
        },
      });
    });

    edges.forEach((e) => {
      const weightRaw = Number(e.weight ?? e.confidence ?? 0.5);
      const weight = Number.isFinite(weightRaw) ? clamp(weightRaw, 0, 1) : 0.5;
      out.push({
        group: "edges",
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type || "related_to",
          weight,
          confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : weight,
          last_seen_ts: e.last_seen_ts || "",
          evidence_doc_id: e.evidence_doc_id || "",
          evidence_snippet: e.evidence_snippet || "",
        },
      });
    });

    return out;
  }, [nodes, edges]);

  const styleRules = useMemo<any[]>(
    () => [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          width: "mapData(degree, 0, 20, 18, 54)",
          height: "mapData(degree, 0, 20, 18, 54)",
          label: "data(label)",
          color: "#e8eef4",
          "font-size": 11,
          "font-weight": 500,
          "text-wrap": "wrap",
          "text-max-width": 130,
          "text-halign": "center",
          "text-valign": "center",
          "text-outline-color": "#0f1720",
          "text-outline-width": 2,
          "border-width": 1.2,
          "border-color": "#111827",
        },
      },
      {
        selector: "node:selected, node.search-hit",
        style: {
          "border-width": 3,
          "border-color": "#f59e0b",
          "overlay-opacity": 0,
        },
      },
      {
        selector: "edge",
        style: {
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "target-arrow-color": "#7c8ea3",
          "line-color": "#7c8ea3",
          width: "mapData(weight, 0, 1, 1, 5)",
          opacity: "mapData(weight, 0, 1, 0.25, 0.95)",
          label: "",
          "font-size": 10,
          color: "#dbe7f3",
          "text-background-color": "#0a1018",
          "text-background-opacity": 0.9,
          "text-background-padding": 2,
          "text-rotation": "autorotate",
        },
      },
      {
        selector: "edge.hovered, edge:selected",
        style: {
          label: "data(type)",
          "line-color": "#8ac5ff",
          "target-arrow-color": "#8ac5ff",
          "z-index": 999,
        },
      },
    ],
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cy = cytoscape({
      container,
      elements: [],
      style: styleRules,
      layout: { name: "preset" },
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;
    return () => {
      if (cyRef.current === cy) {
        cyRef.current = null;
      }
      cy.destroy();
    };
  }, [styleRules]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const clearEdgeHighlights = () => {
      cy.edges().removeClass("hovered");
    };

    const onTapNode = (evt: any) => {
      const node = evt.target as NodeSingular;
      cy.animate({
        center: { eles: node },
        duration: 260,
      });
      if (typeof onNodeExpand === "function") {
        onNodeExpand(node.id());
      }
    };

    const onHoverEdge = (evt: any) => {
      const edge = evt.target as EdgeSingular;
      clearEdgeHighlights();
      edge.addClass("hovered");
      if (typeof onEdgeInspect === "function") {
        onEdgeInspect(edgeFromElement(edge));
      }
    };

    const onOutEdge = (evt: any) => {
      const edge = evt.target as EdgeSingular;
      edge.removeClass("hovered");
      if (typeof onEdgeInspect === "function") {
        onEdgeInspect(null);
      }
    };

    const onTapBlank = (evt: any) => {
      if (evt.target === cy) {
        clearEdgeHighlights();
        cy.nodes().removeClass("search-hit");
        if (typeof onEdgeInspect === "function") {
          onEdgeInspect(null);
        }
      }
    };

    cy.on("tap", "node", onTapNode);
    cy.on("mouseover", "edge", onHoverEdge);
    cy.on("tap", "edge", onHoverEdge);
    cy.on("mouseout", "edge", onOutEdge);
    cy.on("tap", onTapBlank);

    return () => {
      cy.off("tap", "node", onTapNode);
      cy.off("mouseover", "edge", onHoverEdge);
      cy.off("tap", "edge", onHoverEdge);
      cy.off("mouseout", "edge", onOutEdge);
      cy.off("tap", onTapBlank);
    };
  }, [onNodeExpand, onEdgeInspect]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const prevPos = new Map<string, { x: number; y: number }>();
    cy.nodes().forEach((n) => {
      prevPos.set(n.id(), { x: n.position("x"), y: n.position("y") });
    });

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
      cy.nodes().forEach((n) => {
        const p = prevPos.get(n.id());
        if (p) {
          n.position(p);
        }
      });
    });

    const layout = cy.layout({
      name: "cose",
      animate: true,
      animationDuration: prevPos.size > 0 ? 260 : 550,
      fit: true,
      randomize: prevPos.size === 0,
      padding: 36,
      nodeRepulsion: 140000,
      idealEdgeLength: 130,
      edgeElasticity: 90,
      gravity: 0.18,
      numIter: 950,
    });
    layout.run();
  }, [elements]);

  useEffect(() => {
    if (!focusSearchToken) return;
    const cy = cyRef.current;
    const needle = searchText.trim().toLowerCase();
    if (!cy || !needle) return;

    cy.nodes().removeClass("search-hit");
    const match = cy
      .nodes()
      .toArray()
      .find((n) => String(n.data("label") || "").toLowerCase().includes(needle));

    if (!match) return;

    match.addClass("search-hit");
    cy.animate({
      center: { eles: match },
      zoom: Math.max(cy.zoom(), 1.2),
      duration: 320,
    });
  }, [focusSearchToken, searchText]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 320,
        borderRadius: 8,
        border: "1px solid #3A3A3A",
        overflow: "hidden",
        background: "#0b0f14",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {(loading || expandingNodeId) && (
        <div
          className="text-xs"
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #334155",
            background: "rgba(8, 12, 18, 0.9)",
            color: "#dbe7f3",
            pointerEvents: "none",
          }}
        >
          {expandingNodeId ? `Expanding ${expandingNodeId}...` : "Loading graph..."}
        </div>
      )}
    </div>
  );
}
