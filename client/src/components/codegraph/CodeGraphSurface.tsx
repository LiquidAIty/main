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
  /** Stable CodeGraph record reference selected from a Hermes report. */
  focusReference?: string | null;
  onViewContractChange?: (contract: CodeGraphViewContract) => void;
  onRefreshRequest?: (projectId: string) => Promise<CodeGraphData | void> | CodeGraphData | void;
};

export async function fetchLayout(project: string, maxNodes = 50000): Promise<CodeGraphData> {
  const params = new URLSearchParams({ project, max_nodes: String(maxNodes) });
  const response = await fetch(`/api/layout?${params.toString()}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

export function CodeGraphSurface({
  projectId = null,
  viewContract = null,
  focusReference = null,
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
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<{
    token: number;
    action: "zoom_in" | "zoom_out" | "fit_view";
  } | null>(null);

  const allLabels = useMemo(
    () => Array.from(new Set((graphData?.nodes ?? []).map((node) => node.label))),
    [graphData?.nodes],
  );
  const allEdgeTypes = useMemo(
    () => Array.from(new Set((graphData?.edges ?? []).map((edge) => edge.type))),
    [graphData?.edges],
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
    [onViewContractChange, projectId],
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
      (edge) => enabledEdgeTypes.has(edge.type) && allowedIds.has(edge.source) && allowedIds.has(edge.target),
    );
    return {
      nodes,
      edges,
      total_nodes: graphData.total_nodes,
    };
  }, [enabledEdgeTypes, enabledLabels, graphData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshGraph();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!focusReference || !graphData) return;
    const node = graphData.nodes.find((candidate) =>
      candidate.name === focusReference || candidate.file_path === focusReference,
    );
    if (!node) return;
    setSelectedNode(node);
    const connected = new Set([node.id]);
    for (const edge of graphData.edges) {
      if (edge.source === node.id) connected.add(edge.target);
      if (edge.target === node.id) connected.add(edge.source);
    }
    setHighlightedIds(connected);
  }, [focusReference, graphData]);

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
            setFilterDrawerOpen(true);
            const connected = new Set([node.id]);
            for (const edge of filteredData.edges) {
              if (edge.source === node.id) connected.add(edge.target);
              if (edge.target === node.id) connected.add(edge.source);
            }
            setHighlightedIds(connected);
          }}
        />
      </div>

      <div style={{ position: "absolute", zIndex: 4, right: 12, top: 12, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setFilterDrawerOpen(true)}
          style={graphDrawerButtonStyle({
            fontSize: 11,
            padding: "6px 9px",
          })}
        >
          Filters
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
        title="CodeGraph Inspector"
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
        {selectedNode ? (
          <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${GRAPH_THEME.surface.border}` }}>
            <div style={{ color: GRAPH_THEME.surface.text, fontWeight: 700, marginBottom: 4 }}>{selectedNode.name}</div>
            <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 11, marginBottom: 3 }}>{selectedNode.label}</div>
            {selectedNode.file_path ? <div style={{ color: GRAPH_THEME.surface.mutedText, fontFamily: 'monospace', fontSize: 10, overflowWrap: 'anywhere' }}>{selectedNode.file_path}</div> : null}
          </div>
        ) : null}
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
              emitViewContract({ labels: next, edgeTypes: enabledEdgeTypes, nextShowLabels: showLabels });
              return next;
            });
          }}
          onToggleEdgeType={(type) => {
            setEnabledEdgeTypes((previous) => {
              const next = new Set(previous);
              if (next.has(type)) next.delete(type);
              else next.add(type);
              emitViewContract({ labels: enabledLabels, edgeTypes: next, nextShowLabels: showLabels });
              return next;
            });
          }}
          onToggleShowLabels={() =>
            setShowLabels((previous) => {
              const nextShowLabels = !previous;
              emitViewContract({ labels: enabledLabels, edgeTypes: enabledEdgeTypes, nextShowLabels });
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
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setCameraCommand({ token: Date.now(), action: "zoom_out" })}
          style={graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` })}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Recenter view"
          onClick={() => setCameraCommand({ token: Date.now(), action: "fit_view" })}
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
