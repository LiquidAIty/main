import { useCallback, useEffect, useMemo, useState } from "react";

import { CodeGraphFilterPanel } from "./CodeGraphFilterPanel";
import { CodeGraphScene } from "./CodeGraphScene";
import type { CodeGraphData, CodeGraphNode, CodeGraphViewContract } from "./types";
import RightGlassDrawer from "../graph/RightGlassDrawer";
import { GRAPH_WORKSPACE, getGraphMajorGridGap } from "../graph/graphWorkspaceContract";
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
  graphDrawerButtonStyle,
  graphGlassPillStyle,
} from "../graph/graphVisualTokens";

type CodeGraphSurfaceProps = {
  projectId?: string | null;
  viewContract?: CodeGraphViewContract | null;
  onViewContractChange?: (contract: CodeGraphViewContract) => void;
  onRefreshRequest?: (projectId: string) => Promise<CodeGraphData | void> | CodeGraphData | void;
};

async function fetchLayout(project: string, maxNodes = 50000): Promise<CodeGraphData> {
  const params = new URLSearchParams({ project, max_nodes: String(maxNodes) });
  const response = await fetch(`/api/layout?${params.toString()}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

function formatCodeGraphLabel(value: string): string {
  return String(value || "node")
    .replace(/_/g, " ")
    .toLowerCase();
}

function getCodeGraphFileName(filePath?: string): string | null {
  if (!filePath) return null;
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

export function CodeGraphSurface({
  projectId = null,
  viewContract = null,
  onViewContractChange,
  onRefreshRequest,
}: CodeGraphSurfaceProps): React.ReactElement {
  const majorGridGap = getGraphMajorGridGap();
  const [graphData, setGraphData] = useState<CodeGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number> | null>(null);
  const [enabledLabels, setEnabledLabels] = useState<Set<string>>(new Set());
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string>>(new Set());
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<{
    token: number;
    action: "zoom_in" | "zoom_out" | "fit_view";
  } | null>(null);

  const allLabels = useMemo(
    () => Array.from(new Set((graphData?.nodes ?? []).map((node) => node.label))),
    [graphData?.nodes]
  );
  const allEdgeTypes = useMemo(
    () => Array.from(new Set((graphData?.edges ?? []).map((edge) => edge.type))),
    [graphData?.edges]
  );

  const emitViewContract = useCallback(
    (next: { labels: Set<string>; edgeTypes: Set<string>; nextShowLabels: boolean }) => {
      onViewContractChange?.({
        projectId,
        nodeLabelAllowlist: [...next.labels],
        edgeTypeAllowlist: [...next.edgeTypes],
        showLabels: next.nextShowLabels,
      });
    },
    [onViewContractChange, projectId]
  );

  useEffect(() => {
    if (!graphData) return;
    setEnabledLabels(new Set(graphData.nodes.map((node) => node.label)));
    setEnabledEdgeTypes(new Set(graphData.edges.map((edge) => edge.type)));
  }, [graphData]);

  useEffect(() => {
    if (!viewContract) return;
    if (viewContract.nodeLabelAllowlist?.length) {
      setEnabledLabels(new Set(viewContract.nodeLabelAllowlist));
    }
    if (viewContract.edgeTypeAllowlist?.length) {
      setEnabledEdgeTypes(new Set(viewContract.edgeTypeAllowlist));
    }
    if (typeof viewContract.showLabels === "boolean") {
      setShowLabels(viewContract.showLabels);
    }
  }, [viewContract]);

  const refreshGraph = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const refreshed = await onRefreshRequest?.(projectId);
      if (refreshed) {
        setGraphData(refreshed);
      } else {
        const layout = await fetchLayout(projectId, viewContract?.maxNodes ?? 50000);
        setGraphData(layout);
      }
    } catch (nextError: any) {
      setError(nextError?.message || "Failed to fetch code graph layout");
    } finally {
      setLoading(false);
    }
  }, [onRefreshRequest, projectId, viewContract?.maxNodes]);

  useEffect(() => {
    void refreshGraph();
  }, [refreshGraph]);

  const filteredData: CodeGraphData | null = useMemo(() => {
    if (!graphData) return null;
    const nodes = graphData.nodes.filter((node) => enabledLabels.has(node.label));
    const allowedIds = new Set(nodes.map((node) => node.id));
    const edges = graphData.edges.filter(
      (edge) => enabledEdgeTypes.has(edge.type) && allowedIds.has(edge.source) && allowedIds.has(edge.target)
    );
    return {
      nodes,
      edges,
      total_nodes: graphData.total_nodes,
    };
  }, [enabledEdgeTypes, enabledLabels, graphData]);

  const selectedNodeDetails = useMemo(() => {
    if (!selectedNode || !filteredData) return null;
    const node = filteredData.nodes.find((candidate) => candidate.id === selectedNode.id) || selectedNode;
    const nodeById = new Map(filteredData.nodes.map((candidate) => [candidate.id, candidate]));
    const incoming = [];
    const outgoing = [];
    const fileRefs = new Set<string>();
    if (node.file_path) fileRefs.add(node.file_path);

    for (const edge of filteredData.edges) {
      if (edge.source === node.id) {
        const target = nodeById.get(edge.target);
        if (target) {
          outgoing.push({ edge, relatedNode: target });
          if (target.file_path) fileRefs.add(target.file_path);
        }
      }
      if (edge.target === node.id) {
        const source = nodeById.get(edge.source);
        if (source) {
          incoming.push({ edge, relatedNode: source });
          if (source.file_path) fileRefs.add(source.file_path);
        }
      }
    }

    const relationshipCount = incoming.length + outgoing.length;
    const kind = formatCodeGraphLabel(node.label);
    const fileName = getCodeGraphFileName(node.file_path);
    const summary = fileName
      ? `${node.name} is a ${kind} node from ${fileName}. It has ${relationshipCount} visible relationship${
          relationshipCount === 1 ? "" : "s"
        } in the current CodeGraph filter set.`
      : `${node.name} is a ${kind} node with ${relationshipCount} visible relationship${
          relationshipCount === 1 ? "" : "s"
        } in the current CodeGraph filter set.`;

    return {
      node,
      kind,
      summary,
      incoming,
      outgoing,
      fileRefs: Array.from(fileRefs).slice(0, 8),
      relationshipCount,
    };
  }, [filteredData, selectedNode]);

  useEffect(() => {
    if (!selectedNode || !filteredData) return;
    if (filteredData.nodes.some((node) => node.id === selectedNode.id)) return;
    setSelectedNode(null);
    setHighlightedIds(null);
    setDetailDrawerOpen(false);
  }, [filteredData, selectedNode]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshGraph();
    } finally {
      setRefreshing(false);
    }
  };

  if (!projectId) {
    return (
      <div data-testid="codegraph-surface" className="h-full w-full flex items-center justify-center">
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Select a project to load CodeGraph.</p>
      </div>
    );
  }

  if (loading && !graphData) {
    return (
      <div data-testid="codegraph-surface" className="h-full w-full flex items-center justify-center">
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Computing code graph layout...</p>
      </div>
    );
  }

  if (error && !graphData) {
    return (
      <div data-testid="codegraph-surface" className="h-full w-full flex items-center justify-center">
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</p>
          <button
            type="button"
            onClick={handleRefresh}
            style={graphDrawerButtonStyle({
              fontSize: 11,
              padding: "6px 10px",
            })}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!graphData || !filteredData) {
    return <div data-testid="codegraph-surface" className="h-full w-full" />;
  }

  return (
    <div
      data-testid="codegraph-surface"
      className="h-full w-full"
      style={{
        position: "relative",
        minHeight: 0,
        background: GRAPH_THEME.background.knowledgeSurface,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          backgroundImage: [
            `linear-gradient(to right, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
            `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
            `linear-gradient(to right, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
            `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
          ].join(", "),
          backgroundSize: [
            `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
            `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
            `${majorGridGap}px ${majorGridGap}px`,
            `${majorGridGap}px ${majorGridGap}px`,
          ].join(", "),
        }}
      />

      <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
        <CodeGraphScene
          data={filteredData}
          highlightedIds={highlightedIds}
          showLabels={showLabels}
          interactionLocked={interactionLocked}
          cameraAction={cameraCommand?.action || null}
          cameraActionToken={cameraCommand?.token || 0}
          onNodeClick={(node) => {
            setSelectedNode(node);
            setDetailDrawerOpen(true);
            setFilterDrawerOpen(false);
            const connected = new Set([node.id]);
            for (const edge of filteredData.edges) {
              if (edge.source === node.id) connected.add(edge.target);
              if (edge.target === node.id) connected.add(edge.source);
            }
            setHighlightedIds(connected);
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          zIndex: 4,
          right: 12,
          top: 12,
          display: "flex",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setFilterDrawerOpen(true);
            setDetailDrawerOpen(false);
          }}
          style={graphDrawerButtonStyle({
            fontSize: 11,
            padding: "6px 9px",
          })}
        >
          Filters
        </button>
        <button
          type="button"
          onClick={() => {
            if (!selectedNode) return;
            setDetailDrawerOpen(true);
            setFilterDrawerOpen(false);
          }}
          disabled={!selectedNode}
          style={graphDrawerButtonStyle({
            fontSize: 11,
            padding: "6px 9px",
            cursor: selectedNode ? "pointer" : "not-allowed",
            opacity: selectedNode ? 1 : 0.45,
          })}
        >
          Details
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          style={graphDrawerButtonStyle({
            fontSize: 11,
            padding: "6px 9px",
            cursor: refreshing ? "wait" : "pointer",
          })}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <RightGlassDrawer
        isOpen={filterDrawerOpen}
        title="Filters"
        onClose={() => setFilterDrawerOpen(false)}
        onOpen={() => setFilterDrawerOpen(true)}
        defaultWidth={340}
        minWidth={320}
        maxWidth={520}
        storageKey="liquidaity.drawer.codegraph-filters.width"
        dataTestId="codegraph-filters-drawer"
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
        <CodeGraphFilterPanel
          data={graphData}
          enabledLabels={enabledLabels}
          enabledEdgeTypes={enabledEdgeTypes}
          showLabels={showLabels}
          onToggleLabel={(label) => {
            setEnabledLabels((previous) => {
              const next = new Set(previous);
              if (next.has(label)) next.delete(label);
              else next.add(label);
              emitViewContract({
                labels: next,
                edgeTypes: enabledEdgeTypes,
                nextShowLabels: showLabels,
              });
              return next;
            });
          }}
          onToggleEdgeType={(type) => {
            setEnabledEdgeTypes((previous) => {
              const next = new Set(previous);
              if (next.has(type)) next.delete(type);
              else next.add(type);
              emitViewContract({
                labels: enabledLabels,
                edgeTypes: next,
                nextShowLabels: showLabels,
              });
              return next;
            });
          }}
          onToggleShowLabels={() =>
            setShowLabels((previous) => {
              const nextShowLabels = !previous;
              emitViewContract({
                labels: enabledLabels,
                edgeTypes: enabledEdgeTypes,
                nextShowLabels,
              });
              return nextShowLabels;
            })
          }
          onEnableAll={() => {
            const labels = new Set(allLabels);
            const edgeTypes = new Set(allEdgeTypes);
            setEnabledLabels(labels);
            setEnabledEdgeTypes(edgeTypes);
            emitViewContract({ labels, edgeTypes, nextShowLabels: showLabels });
          }}
          onDisableAll={() => {
            const labels = new Set<string>();
            const edgeTypes = new Set<string>();
            setEnabledLabels(labels);
            setEnabledEdgeTypes(edgeTypes);
            emitViewContract({ labels, edgeTypes, nextShowLabels: showLabels });
          }}
        />
      </RightGlassDrawer>

      <RightGlassDrawer
        isOpen={detailDrawerOpen && Boolean(selectedNodeDetails)}
        title="Node Tour"
        onClose={() => setDetailDrawerOpen(false)}
        defaultWidth={380}
        minWidth={340}
        maxWidth={560}
        storageKey="liquidaity.drawer.codegraph-node-tour.width"
        dataTestId="codegraph-node-tour-drawer"
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
        {selectedNodeDetails ? (
          <div style={{ display: "grid", gap: 14 }}>
            <section
              style={{
                border: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
                borderRadius: 10,
                background: GRAPH_THEME.drawer.sectionBackground,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
                    background: GRAPH_THEME.accent.primarySoft,
                    color: GRAPH_THEME.drawer.inputText,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "3px 7px",
                    textTransform: "uppercase",
                  }}
                >
                  {selectedNodeDetails.kind}
                </span>
                <span style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 11 }}>
                  {selectedNodeDetails.relationshipCount} relationship
                  {selectedNodeDetails.relationshipCount === 1 ? "" : "s"}
                </span>
              </div>
              <h2
                style={{
                  color: GRAPH_THEME.drawer.inputText,
                  fontSize: 18,
                  fontWeight: 750,
                  lineHeight: 1.18,
                  margin: "0 0 8px",
                  overflowWrap: "anywhere",
                }}
              >
                {selectedNodeDetails.node.name}
              </h2>
              <p
                style={{
                  color: GRAPH_THEME.drawer.inputMuted,
                  fontSize: 12,
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                {selectedNodeDetails.summary}
              </p>
            </section>

            {selectedNodeDetails.fileRefs.length > 0 ? (
              <section style={{ display: "grid", gap: 8 }}>
                <div
                  style={{
                    color: GRAPH_THEME.accent.primary,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Referenced Files
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {selectedNodeDetails.fileRefs.map((filePath) => (
                    <div
                      key={filePath}
                      title={filePath}
                      style={{
                        border: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
                        borderRadius: 8,
                        background: "rgba(167,176,186,0.035)",
                        color: GRAPH_THEME.drawer.inputMuted,
                        fontFamily: "monospace",
                        fontSize: 11,
                        lineHeight: 1.35,
                        padding: "7px 8px",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {filePath}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  color: GRAPH_THEME.accent.primary,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Relationships
              </div>
              {[...selectedNodeDetails.outgoing, ...selectedNodeDetails.incoming].length > 0 ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {[...selectedNodeDetails.outgoing, ...selectedNodeDetails.incoming]
                    .slice(0, 12)
                    .map((item, index) => {
                      const direction = item.edge.source === selectedNodeDetails.node.id ? "to" : "from";
                      return (
                        <button
                          key={`${item.edge.source}-${item.edge.target}-${item.edge.type}-${index}`}
                          type="button"
                          onClick={() => {
                            setSelectedNode(item.relatedNode);
                            const connected = new Set([item.relatedNode.id]);
                            for (const edge of filteredData.edges) {
                              if (edge.source === item.relatedNode.id) connected.add(edge.target);
                              if (edge.target === item.relatedNode.id) connected.add(edge.source);
                            }
                            setHighlightedIds(connected);
                          }}
                          style={{
                            border: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
                            borderRadius: 8,
                            background: "rgba(167,176,186,0.035)",
                            color: GRAPH_THEME.drawer.inputMuted,
                            cursor: "pointer",
                            display: "grid",
                            gap: 3,
                            padding: "8px 9px",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              color: GRAPH_THEME.drawer.inputText,
                              fontSize: 12,
                              fontWeight: 650,
                            }}
                          >
                            {item.relatedNode.name}
                          </span>
                          <span style={{ fontSize: 11 }}>
                            {formatCodeGraphLabel(item.edge.type)} {direction}{" "}
                            {formatCodeGraphLabel(item.relatedNode.label)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ) : (
                <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12 }}>
                  No visible relationships under the current filters.
                </div>
              )}
            </section>

            <section
              style={{
                border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
                borderRadius: 10,
                background: "rgba(55,173,170,0.07)",
                padding: 12,
              }}
            >
              <div
                style={{
                  color: GRAPH_THEME.accent.primary,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Tour Step
              </div>
              <div
                style={{
                  color: GRAPH_THEME.drawer.inputMuted,
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                Start here by reading the node type, file reference, and nearest relationships. Follow an outgoing
                relationship to see what this code touches next, or an incoming relationship to see what depends on it.
              </div>
            </section>
          </div>
        ) : (
          <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12 }}>
            Select a CodeGraph node to inspect its relationships.
          </div>
        )}
      </RightGlassDrawer>

      <div
        style={{
          ...graphControlStackStyle,
          left: 12,
          bottom: 12,
        }}
      >
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setCameraCommand({ token: Date.now(), action: "zoom_in" })}
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setCameraCommand({ token: Date.now(), action: "zoom_out" })}
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Recenter view"
          onClick={() => setCameraCommand({ token: Date.now(), action: "fit_view" })}
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
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
          aria-label={interactionLocked ? "Unlock interaction" : "Lock interaction"}
          onClick={() => setInteractionLocked((current) => !current)}
          style={graphControlButtonStyle({
            color: interactionLocked ? GRAPH_THEME.accent.primary : GRAPH_THEME.controls.text,
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

      <div
        style={graphGlassPillStyle({
          position: "absolute",
          left: 56,
          bottom: 12,
          zIndex: 4,
          fontSize: 11,
          padding: "6px 8px",
          lineHeight: 1.35,
          pointerEvents: "none",
        })}
      >
        {filteredData.nodes.length.toLocaleString()} nodes / {filteredData.edges.length.toLocaleString()} edges
      </div>
    </div>
  );
}
