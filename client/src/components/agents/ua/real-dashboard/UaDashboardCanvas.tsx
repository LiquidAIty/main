import { useEffect, useMemo } from "react";
import type { UaDashboardLens } from "../../../../runtime/uaAgentDefinitions";
import type { UaWorkbenchContext } from "../UaAgentPanelHost";
import DomainGraphView from "./components/DomainGraphView";
import KnowledgeGraphView from "./components/KnowledgeGraphView";
import NodeInfo from "./components/NodeInfo";
import { buildUaSampleGraph } from "./sampleGraph";
import { useDashboardStore, type ViewMode } from "./store";
import "./uaDashboard.css";

const LENS_TO_VIEW_MODE: Record<UaDashboardLens, ViewMode> = {
  project_scanner: "structural",
  file_analyzer: "structural",
  architecture_analyzer: "structural",
  domain_analyzer: "domain",
  tour_builder: "structural",
  graph_reviewer: "structural",
  article_analyzer: "knowledge",
  assemble_reviewer: "knowledge",
  knowledge_graph_guide: "knowledge",
};

export default function UaDashboardCanvas({
  lens,
  workbenchContext,
}: {
  lens: UaDashboardLens;
  workbenchContext: UaWorkbenchContext;
}) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const setIsKnowledgeGraph = useDashboardStore((s) => s.setIsKnowledgeGraph);
  const startTour = useDashboardStore((s) => s.startTour);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);

  const graphData = useMemo(() => {
    const projectLabel = workbenchContext.projectId
      ? `Project ${workbenchContext.projectId}`
      : "LiquidAIty";
    const sample = buildUaSampleGraph(projectLabel);
    return {
      ...sample,
      project: {
        ...sample.project,
        description:
          workbenchContext.graphSource === "sample_fallback"
            ? `Fallback graph for ${workbenchContext.repoPath}; real analysis is not run yet.`
            : sample.project.description,
      },
    };
  }, [workbenchContext.graphSource, workbenchContext.projectId, workbenchContext.repoPath]);

  useEffect(() => {
    const mode = LENS_TO_VIEW_MODE[lens];
    setGraph(graphData);
    setDomainGraph(graphData);
    setIsKnowledgeGraph(mode === "knowledge");
    setViewMode(mode);
    if (lens === "tour_builder" || lens === "knowledge_graph_guide") {
      window.setTimeout(() => startTour(), 0);
    }
  }, [graphData, lens, setDomainGraph, setGraph, setIsKnowledgeGraph, setViewMode, startTour]);

  return (
    <div
      className="ua-dashboard-host h-full w-full flex flex-col bg-root text-text-primary"
      data-ui-engine="ua_dashboard"
      data-ui-lens={lens}
      data-view-mode={viewMode}
      data-project-id={workbenchContext.projectId ?? ""}
      data-repo-path={workbenchContext.repoPath}
      data-workspace-root={workbenchContext.workspaceRoot}
      data-graph-source={workbenchContext.graphSource}
      data-analysis-status={workbenchContext.analysisStatus}
    >
      <div className="flex-1 flex min-h-0 relative">
        <div className="flex-1 min-w-0 min-h-0 relative">
          {viewMode === "domain" ? (
            <DomainGraphView />
          ) : (
            /* structural and knowledge both use KnowledgeGraphView (force-layout canvas).
               KnowledgeGraphView handles all 21 UA node types: file, function, class,
               module, service, endpoint, config, schema, pipeline (structural) as well
               as article, entity, topic, claim, source (knowledge). The isKnowledgeGraph
               flag in the store controls which node types are visible via nodeTypeFilters. */
            <KnowledgeGraphView />
          )}
        </div>

        {selectedNodeId ? (
          <aside className="absolute top-3 right-3 bottom-3 w-[340px] max-w-[42vw] bg-surface border border-border-subtle rounded-lg overflow-hidden flex flex-col shadow-lg z-20">
            <div className="flex-1 min-h-0 overflow-auto">
              <NodeInfo />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
