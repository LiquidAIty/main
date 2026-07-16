import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Button } from "./ui/button";
import { useGraphData } from "../hooks/useGraphData";
import {
  GraphScene,
  computeCameraTarget,
  type CameraCommand,
  type CameraTarget,
} from "./GraphScene";
import { Sidebar } from "./Sidebar";
import { FilterPanel } from "./FilterPanel";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import type { GraphNode, GraphData } from "../lib/types";
import { colorForLabel } from "../lib/colors";
import RightGlassDrawer from "../../../../components/graph/RightGlassDrawer";
import GlassInspectorSection from "../../../../components/graph/GlassInspectorSection";
import { GraphNavigationControls, GraphPaperBackground } from "../../../../components/graph/GraphCanvasChrome";

interface GraphTabProps {
  project: string | null;
  onAskMainNode?: (node: GraphNode) => void;
  onSelectedNodeChange?: (node: GraphNode | null) => void;
}

export function GraphTab({ project, onAskMainNode, onSelectedNodeChange }: GraphTabProps) {
  const { data, loading, error, fetchOverview } = useGraphData();
  const [highlightedIds, setHighlightedIds] = useState<Set<number> | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [cameraCommand, setCameraCommand] = useState<CameraCommand>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const initiallyFittedProject = useRef<string | null>(null);
  const graphHostRef = useRef<HTMLDivElement | null>(null);

  /* Filter state — all enabled by default */
  const [enabledLabels, setEnabledLabels] = useState<Set<string>>(new Set());
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    onSelectedNodeChange?.(selectedNode);
  }, [onSelectedNodeChange, selectedNode]);

  /* Initialize filters when data loads */
  useEffect(() => {
    if (!data) return;
    const labels = new Set(data.nodes.map((n) => n.label));
    const types = new Set(data.edges.map((e) => e.type));
    setEnabledLabels(labels);
    setEnabledEdgeTypes(types);
  }, [data]);

  /* Compute filtered data */
  const filteredData: GraphData | null = useMemo(() => {
    if (!data) return null;

    const nodes = data.nodes
      .filter((n) => enabledLabels.has(n.label))
      .map((n) => ({ ...n, color: colorForLabel(n.label) }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter(
      (e) =>
        enabledEdgeTypes.has(e.type) &&
        nodeIds.has(e.source) &&
        nodeIds.has(e.target),
    );

    return { nodes, edges, total_nodes: data.total_nodes };
  }, [data, enabledLabels, enabledEdgeTypes]);

  useEffect(() => {
    if (!project || !data?.nodes.length || initiallyFittedProject.current === project) return;
    let frame = 0;
    let attempts = 0;
    const fitWhenReady = () => {
      const canvas = graphHostRef.current?.querySelector('canvas');
      const bounds = canvas?.getBoundingClientRect();
      const layoutReady = data.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z));
      if (bounds && bounds.width > 0 && bounds.height > 0 && layoutReady) {
        setCameraTarget(computeCameraTarget(data.nodes, new Set(data.nodes.map((node) => node.id))));
        initiallyFittedProject.current = project;
        return;
      }
      attempts += 1;
      if (attempts < 120) frame = window.requestAnimationFrame(fitWhenReady);
    };
    frame = window.requestAnimationFrame(fitWhenReady);
    return () => window.cancelAnimationFrame(frame);
  }, [data, project]);

  useEffect(() => {
    if (project) {
      fetchOverview(project);
      setHighlightedIds(null);
      setSelectedPath(null);
    }
  }, [project, fetchOverview]);

  const handleSelectPath = useCallback(
    (path: string, nodeIds: Set<number>) => {
      if (!filteredData || !path || nodeIds.size === 0) {
        setHighlightedIds(null);
        setSelectedPath(null);
        setCameraTarget(null);
        return;
      }
      setSelectedPath(path);
      setHighlightedIds(nodeIds);
      setCameraTarget(computeCameraTarget(filteredData.nodes, nodeIds));
    },
    [filteredData],
  );

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (!filteredData) return;
      setSelectedNode(node);

      /* Highlight the node and its direct connections */
      const connectedIds = new Set([node.id]);
      for (const edge of filteredData.edges) {
        if (edge.source === node.id) connectedIds.add(edge.target);
        if (edge.target === node.id) connectedIds.add(edge.source);
      }
      setHighlightedIds(connectedIds);
      setSelectedPath(node.file_path ?? null);
      setInspectorOpen(true);
    },
    [filteredData],
  );

  const handleNavigateToNode = useCallback(
    (node: GraphNode) => {
      handleNodeClick(node);
    },
    [handleNodeClick],
  );

  const toggleLabel = useCallback((label: string) => {
    setEnabledLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const toggleEdgeType = useCallback((type: string) => {
    setEnabledEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const enableAll = useCallback(() => {
    if (!data) return;
    setEnabledLabels(new Set(data.nodes.map((n) => n.label)));
    setEnabledEdgeTypes(new Set(data.edges.map((e) => e.type)));
  }, [data]);

  const disableAll = useCallback(() => {
    setEnabledLabels(new Set());
    setEnabledEdgeTypes(new Set());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHighlightedIds(null);
      setSelectedPath(null);
      setSelectedNode(null);
      setCameraTarget(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/30 text-sm">
          Select a project from the Stats tab
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/40 text-sm">Computing layout...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <p className="text-red-400 text-sm mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={() => fetchOverview(project)}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data || !filteredData || filteredData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-white/30 text-sm mb-3">
            {data && filteredData?.nodes.length === 0
              ? "All nodes filtered out"
              : "No nodes in this project"}
          </p>
          {data && filteredData?.nodes.length === 0 && (
            <Button size="sm" onClick={enableAll}>
              Reset Filters
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={graphHostRef} className="h-full relative overflow-hidden">
      <GraphPaperBackground />
      <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
        <ErrorBoundary>
          <GraphScene
            data={filteredData}
            highlightedIds={highlightedIds}
            cameraTarget={cameraTarget}
            cameraCommand={cameraCommand}
            showLabels={showLabels}
            onNodeClick={handleNodeClick}
          />
        </ErrorBoundary>

        {/* HUD */}
        <div className="absolute text-[11px] text-white/40 pointer-events-none font-mono" style={{ top: 56, left: 12 }}>
          <p>
            {filteredData.nodes.length.toLocaleString()} nodes /{" "}
            {filteredData.edges.length.toLocaleString()} edges
          </p>
          {data.nodes.length > filteredData.nodes.length && (
            <p className="text-white/25 mt-0.5">
              filtered from {data.nodes.length.toLocaleString()}
            </p>
          )}
          {highlightedIds && highlightedIds.size > 0 && (
            <p className="text-cyan-400/50 mt-0.5">
              {highlightedIds.size} selected
            </p>
          )}
        </div>

        <GraphNavigationControls
          onZoomIn={() => setCameraCommand({ action: "zoom_in", token: Date.now() })}
          onZoomOut={() => setCameraCommand({ action: "zoom_out", token: Date.now() })}
          onFit={() => setCameraTarget(computeCameraTarget(filteredData.nodes, new Set(filteredData.nodes.map((node) => node.id))))}
        />
        {loading ? <div className="absolute bottom-4 left-32 text-[10px] text-white/45">Refreshing…</div> : null}
        {error ? <div className="absolute bottom-4 left-32 text-[10px] text-red-300">Refresh failed · current graph retained</div> : null}
      </div>

      <RightGlassDrawer
        isOpen={inspectorOpen}
        title="CodeGraph Inspector"
        onClose={() => setInspectorOpen(false)}
        onOpen={() => setInspectorOpen(true)}
        collapsedLabel={null}
        openAriaLabel="Open CodeGraph Inspector"
        defaultWidth={360}
        minWidth={320}
        maxWidth={560}
        storageKey="liquidaity.drawer.codegraph-native.width"
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
        <GlassInspectorSection title="Selection" signal={selectedNode?.label || "none"}>
          {selectedNode ? (
            <>
              <NodeDetailPanel
                node={selectedNode}
                allNodes={filteredData.nodes}
                allEdges={filteredData.edges}
                onClose={() => {
                  setSelectedNode(null);
                  setHighlightedIds(null);
                  setSelectedPath(null);
                }}
                onNavigate={handleNavigateToNode}
              />
              {onAskMainNode ? <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onAskMainNode(selectedNode)}>Ask Main</Button> : null}
            </>
          ) : <div className="text-[11px] text-white/35">Select a repository node to inspect its identity and relationships.</div>}
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => fetchOverview(project)} disabled={loading}>{loading ? "Refreshing…" : "Refresh graph"}</Button>
        </GlassInspectorSection>
        <GlassInspectorSection title="Node, edge & display filters" signal={`${filteredData.nodes.length.toLocaleString()} nodes`} defaultOpen={false}>
          <FilterPanel
            data={data}
            enabledLabels={enabledLabels}
            enabledEdgeTypes={enabledEdgeTypes}
            showLabels={showLabels}
            onToggleLabel={toggleLabel}
            onToggleEdgeType={toggleEdgeType}
            onToggleShowLabels={() => setShowLabels((v) => !v)}
            onEnableAll={enableAll}
            onDisableAll={disableAll}
          />
        </GlassInspectorSection>
        <GlassInspectorSection title="Repository tree" defaultOpen={false}>
          <Sidebar nodes={filteredData.nodes} onSelectPath={handleSelectPath} selectedPath={selectedPath} />
        </GlassInspectorSection>
      </RightGlassDrawer>
    </div>
  );
}
