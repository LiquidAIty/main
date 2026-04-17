import { useCallback, useEffect, useMemo, useState } from "react";

import { CodeGraphFilterPanel } from "./CodeGraphFilterPanel";
import { CodeGraphScene } from "./CodeGraphScene";
import type { CodeGraphData, CodeGraphNode, CodeGraphViewContract } from "./types";

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

export function CodeGraphSurface({
  projectId = null,
  viewContract = null,
  onViewContractChange,
  onRefreshRequest,
}: CodeGraphSurfaceProps): React.ReactElement {
  const [graphData, setGraphData] = useState<CodeGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number> | null>(null);
  const [enabledLabels, setEnabledLabels] = useState<Set<string>>(new Set());
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string>>(new Set());

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
            style={{
              background: "rgba(15,15,15,0.78)",
              color: "rgba(79,162,173,0.98)",
              border: "1px solid rgba(79,162,173,0.35)",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              padding: "6px 10px",
              cursor: "pointer",
            }}
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
      style={{ display: "grid", gridTemplateColumns: "290px 1fr", minHeight: 0, background: "#141414" }}
    >
      <div
        style={{
          borderRight: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.18)",
          overflow: "auto",
        }}
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
      </div>

      <div style={{ position: "relative", minHeight: 0 }}>
        <div style={{ position: "absolute", zIndex: 3, right: 12, top: 12 }}>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              background: "rgba(15,15,15,0.78)",
              color: "rgba(79,162,173,0.98)",
              border: "1px solid rgba(79,162,173,0.35)",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              padding: "6px 10px",
              cursor: refreshing ? "wait" : "pointer",
            }}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <CodeGraphScene
          data={filteredData}
          highlightedIds={highlightedIds}
          showLabels={showLabels}
          onNodeClick={(node) => {
            setSelectedNode(node);
            const connected = new Set([node.id]);
            for (const edge of filteredData.edges) {
              if (edge.source === node.id) connected.add(edge.target);
              if (edge.target === node.id) connected.add(edge.source);
            }
            setHighlightedIds(connected);
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            color: "rgba(255,255,255,0.4)",
            fontSize: 11,
            fontFamily: "monospace",
            pointerEvents: "none",
          }}
        >
          {filteredData.nodes.length.toLocaleString()} nodes / {filteredData.edges.length.toLocaleString()} edges
        </div>
        {selectedNode ? (
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              background: "rgba(8,8,8,0.75)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              padding: "8px 10px",
              maxWidth: 360,
              color: "rgba(255,255,255,0.8)",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{selectedNode.name}</div>
            <div style={{ color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>{selectedNode.label}</div>
            {selectedNode.file_path ? (
              <div style={{ color: "rgba(255,255,255,0.45)", fontFamily: "monospace", fontSize: 11 }}>
                {selectedNode.file_path}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
