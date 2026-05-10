import { useEffect, useMemo, useState } from "react";
import type { UaDashboardLens } from "../../../../runtime/uaAgentDefinitions";
import DomainGraphView from "./components/DomainGraphView";
import FileExplorer from "./components/FileExplorer";
import KnowledgeGraphView from "./components/KnowledgeGraphView";
import NodeInfo from "./components/NodeInfo";
import ProjectOverview from "./components/ProjectOverview";
import SearchBar from "./components/SearchBar";
import { buildUaSampleGraph } from "./sampleGraph";
import { useDashboardStore, type ViewMode } from "./store";
import "./uaDashboard.css";

type SidebarTab = "info" | "files";

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

function getInitialSidebarTab(lens: UaDashboardLens): SidebarTab {
  return lens === "project_scanner" || lens === "file_analyzer" ? "files" : "info";
}

export default function UaDashboardCanvas({
  lens,
  title,
}: {
  lens: UaDashboardLens;
  title: string;
}) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const setIsKnowledgeGraph = useDashboardStore((s) => s.setIsKnowledgeGraph);
  const startTour = useDashboardStore((s) => s.startTour);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const graph = useDashboardStore((s) => s.graph);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(() => getInitialSidebarTab(lens));

  const graphData = useMemo(() => buildUaSampleGraph("LiquidAIty UA Dashboard"), []);

  useEffect(() => {
    const mode = LENS_TO_VIEW_MODE[lens];
    setGraph(graphData);
    setDomainGraph(graphData);
    setIsKnowledgeGraph(mode === "knowledge");
    setViewMode(mode);
    setSidebarTab(getInitialSidebarTab(lens));
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
    >
      <header className="flex items-center px-4 py-3 bg-surface border-b border-border-subtle shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="font-heading text-lg text-text-primary tracking-wide truncate">
            {graph?.project.name ?? "Understand Anything"}
          </h1>
          <div className="w-px h-5 bg-elevated" />
          <span className="text-xs text-accent uppercase tracking-wider">{title}</span>
        </div>
        <div className="ml-auto flex items-center bg-elevated rounded-lg p-0.5">
          {(["structural", "domain", "knowledge"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === mode
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {mode === "structural" ? "Structural" : mode === "domain" ? "Domain" : "Knowledge"}
            </button>
          ))}
        </div>
      </header>

      <SearchBar />

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

        <aside className="w-[320px] shrink-0 bg-surface border-l border-border-subtle overflow-hidden flex flex-col">
          <div className="flex items-center gap-1 p-2 border-b border-border-subtle bg-surface shrink-0">
            {(["info", "files"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSidebarTab(tab)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                  sidebarTab === tab
                    ? "bg-accent/15 text-accent"
                    : "text-text-muted hover:text-text-primary hover:bg-elevated"
                }`}
              >
                {tab === "info" ? "Info" : "Files"}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {sidebarTab === "files" ? (
              <FileExplorer />
            ) : selectedNodeId ? (
              <NodeInfo />
            ) : (
              <ProjectOverview />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
