import { useEffect, useMemo, useState } from "react";

import { CodeGraphScene } from "../codegraph/CodeGraphScene";
import { colorForCodeGraphLabel } from "../codegraph/colors";
import RightGlassDrawer from "../graph/RightGlassDrawer";
import type { CodeGraphData } from "../codegraph/types";
import type { GraphViewContract, GraphViewData, KnowledgeGraphKind } from "../../types/agentgraph";

type KnowledgeGraphFrameworkProps = {
  kind: KnowledgeGraphKind;
  onKindChange: (kind: KnowledgeGraphKind) => void;
  contract: GraphViewContract;
  onContractChange: (contract: GraphViewContract) => void;
  thinkGraphData: GraphViewData;
  knowGraphData: GraphViewData;
  codeGraphProjectName: string;
  minHeight?: number;
};

const DEFAULT_FILTERS: Record<
  KnowledgeGraphKind,
  { nodeLabelAllowlist: string[]; edgeTypeAllowlist: string[]; maxNodes: number }
> = {
  thinkgraph: {
    nodeLabelAllowlist: ["entity", "concept", "goal", "hypothesis"],
    edgeTypeAllowlist: ["related_to", "supports", "contradicts", "depends_on"],
    maxNodes: 6000,
  },
  knowgraph: {
    nodeLabelAllowlist: ["entity", "document", "topic", "person", "organization"],
    edgeTypeAllowlist: ["related_to", "references", "cites", "evidence_for"],
    maxNodes: 8000,
  },
  codegraph: {
    nodeLabelAllowlist: ["file", "symbol", "module", "route", "dependency"],
    edgeTypeAllowlist: ["IMPORTS", "CALLS", "DEPENDS_ON", "USES"],
    maxNodes: 50000,
  },
};
const KNOWLEDGE_CONTROLS_DEFAULT_WIDTH = 340;
const KNOWLEDGE_CONTROLS_MIN_WIDTH = 320;
const KNOWLEDGE_CONTROLS_MAX_WIDTH = 520;

function resolveModeDefaultAllowlist(
  available: string[],
  defaults: string[],
): string[] {
  if (available.length === 0) return [];
  const byLower = new Map<string, string>();
  available.forEach((value) => {
    byLower.set(value.toLowerCase(), value);
  });
  const resolved = defaults
    .map((entry) => byLower.get(entry.toLowerCase()) || null)
    .filter((entry): entry is string => Boolean(entry));
  if (resolved.length > 0) return Array.from(new Set(resolved));
  return [...available];
}

type NumericGraphData = {
  graph: CodeGraphData;
  idMap: Map<string, number>;
};

function toNumericGraphData(input: GraphViewData): NumericGraphData {
  const idMap = new Map<string, number>();
  const indexFor = (id: string): number => {
    const existing = idMap.get(id);
    if (existing != null) return existing;
    const next = idMap.size + 1;
    idMap.set(id, next);
    return next;
  };

  const nodes = input.nodes.map((node, index) => {
    const id = indexFor(node.id);
    const radius = Math.sqrt(index + 1) * 18;
    const theta = index * 0.5;
    return {
      id,
      x: node.x ?? Math.cos(theta) * radius,
      y: node.y ?? Math.sin(theta) * radius,
      z: node.z ?? ((index % 17) - 8) * 6,
      label: String(node.type || "node"),
      name: String(node.label || node.id),
      file_path: node.sourceIds?.[0],
      size: Math.max(2, Number(node.size ?? 8)),
      color: node.color || colorForCodeGraphLabel(String(node.type || "node")),
    };
  });

  const edges = input.edges
    .map((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (source == null || target == null) return null;
      return {
        source,
        target,
        type: String(edge.type || "related_to"),
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));

  return {
    graph: {
      nodes,
      edges,
      total_nodes: nodes.length,
    },
    idMap,
  };
}

async function fetchCodeGraphLayout(project: string, maxNodes: number): Promise<CodeGraphData> {
  const params = new URLSearchParams({
    project,
    max_nodes: String(maxNodes),
  });
  const response = await fetch(`/api/layout?${params.toString()}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return response.json();
}

function labelSetFromGraph(data: CodeGraphData): string[] {
  return Array.from(new Set(data.nodes.map((node) => node.label))).sort();
}

function edgeSetFromGraph(data: CodeGraphData): string[] {
  return Array.from(new Set(data.edges.map((edge) => edge.type))).sort();
}

export default function KnowledgeGraphFramework({
  kind,
  onKindChange,
  contract,
  onContractChange,
  thinkGraphData,
  knowGraphData,
  codeGraphProjectName,
  minHeight = 360,
}: KnowledgeGraphFrameworkProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [codeGraphData, setCodeGraphData] = useState<CodeGraphData | null>(null);
  const [loadingCodeGraph, setLoadingCodeGraph] = useState(false);
  const [codeGraphError, setCodeGraphError] = useState<string | null>(null);

  const effectiveMaxNodes = Math.max(1, Number(contract.maxNodes || DEFAULT_FILTERS[kind].maxNodes));

  useEffect(() => {
    if (kind !== "codegraph") return;
    let cancelled = false;
    setLoadingCodeGraph(true);
    setCodeGraphError(null);
    void fetchCodeGraphLayout(codeGraphProjectName, effectiveMaxNodes)
      .then((layout) => {
        if (cancelled) return;
        setCodeGraphData(layout);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setCodeGraphError(String(error?.message || "Failed to load graph layout"));
      })
      .finally(() => {
        if (!cancelled) setLoadingCodeGraph(false);
      });
    return () => {
      cancelled = true;
    };
  }, [codeGraphProjectName, effectiveMaxNodes, kind]);

  const normalized = useMemo(() => {
    if (kind === "codegraph") {
      return {
        graph: codeGraphData ?? { nodes: [], edges: [], total_nodes: 0 },
        idMap: new Map<string, number>(),
      };
    }
    return toNumericGraphData(kind === "thinkgraph" ? thinkGraphData : knowGraphData);
  }, [kind, codeGraphData, thinkGraphData, knowGraphData]);

  const allLabels = useMemo(() => labelSetFromGraph(normalized.graph), [normalized.graph]);
  const allEdgeTypes = useMemo(() => edgeSetFromGraph(normalized.graph), [normalized.graph]);
  const defaultLabels = useMemo(
    () => resolveModeDefaultAllowlist(allLabels, DEFAULT_FILTERS[kind].nodeLabelAllowlist),
    [allLabels, kind],
  );
  const defaultEdgeTypes = useMemo(
    () => resolveModeDefaultAllowlist(allEdgeTypes, DEFAULT_FILTERS[kind].edgeTypeAllowlist),
    [allEdgeTypes, kind],
  );

  const labelAllow = useMemo(() => {
    if (contract.graphKind === kind && contract.nodeLabelAllowlist?.length) {
      return new Set(contract.nodeLabelAllowlist);
    }
    return new Set(defaultLabels);
  }, [contract.graphKind, contract.nodeLabelAllowlist, defaultLabels, kind]);
  const edgeAllow = useMemo(() => {
    if (contract.graphKind === kind && contract.edgeTypeAllowlist?.length) {
      return new Set(contract.edgeTypeAllowlist);
    }
    return new Set(defaultEdgeTypes);
  }, [contract.edgeTypeAllowlist, contract.graphKind, defaultEdgeTypes, kind]);
  const showLabels = typeof contract.showLabels === "boolean" ? contract.showLabels : true;

  const filteredData = useMemo<CodeGraphData>(() => {
    const nodes = normalized.graph.nodes.filter((node) => labelAllow.has(node.label));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = normalized.graph.edges.filter(
      (edge) => edgeAllow.has(edge.type) && nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
    return {
      nodes,
      edges,
      total_nodes: normalized.graph.total_nodes,
    };
  }, [edgeAllow, labelAllow, normalized.graph]);

  const highlightedIds = useMemo(() => {
    if (!contract.focusNodeIds?.length) return null;
    const ids = new Set<number>();
    contract.focusNodeIds.forEach((rawId) => {
      const str = String(rawId);
      const mapped = normalized.idMap.get(str);
      if (mapped != null) ids.add(mapped);
      const maybeNumeric = Number(str);
      if (Number.isFinite(maybeNumeric)) ids.add(maybeNumeric);
    });
    return ids.size > 0 ? ids : null;
  }, [contract.focusNodeIds, normalized.idMap]);

  const applyContractPatch = (patch: Partial<GraphViewContract>) => {
    onContractChange({
      ...contract,
      ...patch,
      graphKind: kind,
    });
  };

  const modeButtonStyle = (value: KnowledgeGraphKind) => ({
    border: `1px solid ${kind === value ? "rgba(79,162,173,0.45)" : "rgba(255,255,255,0.12)"}`,
    background: kind === value ? "rgba(79,162,173,0.16)" : "rgba(8,8,8,0.55)",
    color: kind === value ? "rgba(79,162,173,1)" : "rgba(255,255,255,0.65)",
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    padding: "6px 8px",
    cursor: "pointer",
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(5,5,8,0.7)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          padding: 6,
        }}
        data-no-surface-promote="true"
      >
        <button type="button" style={modeButtonStyle("thinkgraph")} onClick={() => onKindChange("thinkgraph")}>
          ThinkGraph
        </button>
        <button type="button" style={modeButtonStyle("knowgraph")} onClick={() => onKindChange("knowgraph")}>
          KnowGraph
        </button>
        <button type="button" style={modeButtonStyle("codegraph")} onClick={() => onKindChange("codegraph")}>
          CodeGraph
        </button>
      </div>

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        data-no-surface-promote="true"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 5,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(13,16,20,0.9)",
          color: "rgba(224,222,213,0.9)",
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 600,
          padding: "6px 9px",
          cursor: "pointer",
        }}
      >
        Controls
      </button>

      <RightGlassDrawer
        isOpen={drawerOpen}
        title="Controls"
        onClose={() => setDrawerOpen(false)}
        defaultWidth={KNOWLEDGE_CONTROLS_DEFAULT_WIDTH}
        minWidth={KNOWLEDGE_CONTROLS_MIN_WIDTH}
        maxWidth={KNOWLEDGE_CONTROLS_MAX_WIDTH}
        storageKey="liquidaity.drawer.knowledge-controls.width"
        dataTestId="knowledge-utility-drawer"
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
        <div
          data-no-surface-promote="true"
          style={{
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>Display</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
              <input
                type="checkbox"
                checked={showLabels}
                onChange={() => applyContractPatch({ showLabels: !showLabels })}
              />
              Show labels
            </label>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>Node Labels</div>
            {allLabels.map((label) => {
              const enabled = labelAllow.has(label);
              return (
                <button
                  key={label}
                  type="button"
                  style={{
                    textAlign: "left",
                    border: `1px solid ${enabled ? "rgba(79,162,173,0.35)" : "rgba(255,255,255,0.08)"}`,
                    background: enabled ? "rgba(79,162,173,0.12)" : "rgba(255,255,255,0.02)",
                    color: enabled ? "rgba(79,162,173,0.96)" : "rgba(255,255,255,0.62)",
                    borderRadius: 6,
                    padding: "5px 7px",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                  onClick={() => {
                    const next = new Set(labelAllow);
                    if (next.has(label)) next.delete(label);
                    else next.add(label);
                    applyContractPatch({ nodeLabelAllowlist: Array.from(next) });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>Edge Types</div>
            {allEdgeTypes.map((edgeType) => {
              const enabled = edgeAllow.has(edgeType);
              return (
                <button
                  key={edgeType}
                  type="button"
                  style={{
                    textAlign: "left",
                    border: `1px solid ${enabled ? "rgba(79,162,173,0.35)" : "rgba(255,255,255,0.08)"}`,
                    background: enabled ? "rgba(79,162,173,0.12)" : "rgba(255,255,255,0.02)",
                    color: enabled ? "rgba(79,162,173,0.96)" : "rgba(255,255,255,0.62)",
                    borderRadius: 6,
                    padding: "5px 7px",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                  onClick={() => {
                    const next = new Set(edgeAllow);
                    if (next.has(edgeType)) next.delete(edgeType);
                    else next.add(edgeType);
                    applyContractPatch({ edgeTypeAllowlist: Array.from(next) });
                  }}
                >
                  {edgeType}
                </button>
              );
            })}
          </div>
        </div>
      </RightGlassDrawer>

      <div style={{ width: "100%", height: "100%", minHeight }}>
        {kind === "codegraph" && codeGraphError ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              color: "#f87171",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#06090f",
            }}
          >
            {codeGraphError}
          </div>
        ) : (
          <CodeGraphScene
            data={filteredData}
            showLabels={showLabels}
            highlightedIds={highlightedIds}
            onNodeClick={(node) => {
              const focused = new Set((contract.focusNodeIds || []).map((value) => String(value)));
              const nodeKey = String(node.id);
              if (focused.has(nodeKey)) {
                applyContractPatch({ focusNodeIds: [] });
                return;
              }
              applyContractPatch({ focusNodeIds: [nodeKey] });
            }}
          />
        )}
      </div>

      <div
        data-no-surface-promote="true"
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          zIndex: 4,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(8,8,8,0.72)",
          color: "rgba(255,255,255,0.82)",
          borderRadius: 8,
          fontSize: 11,
          padding: "6px 8px",
          maxWidth: 420,
        }}
      >
        <div>
          Nodes {filteredData.nodes.length.toLocaleString()} - Edges {filteredData.edges.length.toLocaleString()}
        </div>
        {kind === "knowgraph" && filteredData.nodes.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
            KnowGraph returned zero nodes from /api/knowgraph/graph for the selected project.
          </div>
        ) : null}
      </div>

      {kind === "codegraph" && loadingCodeGraph ? (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            zIndex: 4,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(8,8,8,0.72)",
            color: "rgba(255,255,255,0.75)",
            borderRadius: 8,
            fontSize: 11,
            padding: "6px 8px",
          }}
        >
          Loading CodeGraph...
        </div>
      ) : null}
    </div>
  );
}
