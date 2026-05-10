import { create } from "zustand";
import type { GraphNode, KnowledgeGraph } from "./types";

export type ViewMode = "structural" | "domain" | "knowledge";
export type NodeCategory = "code" | "config" | "docs" | "infra" | "data" | "domain" | "knowledge";

export interface SearchResult {
  nodeId: string;
  score: number;
}

interface DashboardStore {
  graph: KnowledgeGraph | null;
  selectedNodeId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchMode: "fuzzy" | "semantic";
  tourActive: boolean;
  currentTourStep: number;
  tourHighlightedNodeIds: string[];
  nodeHistory: string[];
  focusNodeId: string | null;
  viewMode: ViewMode;
  isKnowledgeGraph: boolean;
  domainGraph: KnowledgeGraph | null;
  activeDomainId: string | null;
  nodeTypeFilters: Record<NodeCategory, boolean>;

  setGraph: (graph: KnowledgeGraph) => void;
  selectNode: (nodeId: string | null) => void;
  navigateToNode: (nodeId: string) => void;
  navigateToNodeInLayer: (nodeId: string) => void;
  navigateToHistoryIndex: (index: number) => void;
  goBackNode: () => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: "fuzzy" | "semantic") => void;
  setFocusNode: (nodeId: string | null) => void;
  openCodeViewer: (nodeId: string) => void;
  setDomainGraph: (graph: KnowledgeGraph) => void;
  setViewMode: (mode: ViewMode) => void;
  setIsKnowledgeGraph: (value: boolean) => void;
  navigateToDomain: (domainId: string) => void;
  clearActiveDomain: () => void;
  appendLayoutIssues: (_issues: unknown[]) => void;
  startTour: () => void;
  stopTour: () => void;
  setTourStep: (step: number) => void;
  nextTourStep: () => void;
  prevTourStep: () => void;
}

function matchesNode(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    node.name.toLowerCase().includes(q) ||
    node.summary.toLowerCase().includes(q) ||
    node.tags.some((tag) => tag.toLowerCase().includes(q)) ||
    (node.filePath?.toLowerCase().includes(q) ?? false)
  );
}

function searchGraph(graph: KnowledgeGraph | null, query: string): SearchResult[] {
  if (!graph || !query.trim()) return [];
  return graph.nodes
    .filter((node) => matchesNode(node, query))
    .slice(0, 50)
    .map((node, index) => ({ nodeId: node.id, score: index / 50 }));
}

function sortedTour(graph: KnowledgeGraph | null) {
  return [...(graph?.tour ?? [])].sort((a, b) => a.order - b.order);
}

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  graph: null,
  selectedNodeId: null,
  searchQuery: "",
  searchResults: [],
  searchMode: "fuzzy",
  tourActive: false,
  currentTourStep: 0,
  tourHighlightedNodeIds: [],
  nodeHistory: [],
  focusNodeId: null,
  viewMode: "structural",
  isKnowledgeGraph: false,
  domainGraph: null,
  activeDomainId: null,
  nodeTypeFilters: { code: true, config: true, docs: true, infra: true, data: true, domain: true, knowledge: true },

  setGraph: (graph) => {
    const query = get().searchQuery;
    set({
      graph,
      selectedNodeId: null,
      searchResults: searchGraph(graph, query),
      nodeHistory: [],
      focusNodeId: null,
      tourActive: false,
      currentTourStep: 0,
      tourHighlightedNodeIds: [],
    });
  },

  selectNode: (nodeId) => {
    const current = get().selectedNodeId;
    set({
      selectedNodeId: nodeId,
      nodeHistory: current && nodeId && current !== nodeId
        ? [...get().nodeHistory, current].slice(-50)
        : get().nodeHistory,
    });
  },

  navigateToNode: (nodeId) => get().selectNode(nodeId),
  navigateToNodeInLayer: (nodeId) => get().selectNode(nodeId),

  navigateToHistoryIndex: (index) => {
    const history = get().nodeHistory;
    const nodeId = history[index];
    if (!nodeId) return;
    set({ selectedNodeId: nodeId, nodeHistory: history.slice(0, index) });
  },

  goBackNode: () => {
    const history = get().nodeHistory;
    const nodeId = history[history.length - 1];
    if (!nodeId) return;
    set({ selectedNodeId: nodeId, nodeHistory: history.slice(0, -1) });
  },

  setSearchQuery: (query) => set({ searchQuery: query, searchResults: searchGraph(get().graph, query) }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setFocusNode: (nodeId) => set({ focusNodeId: nodeId, selectedNodeId: nodeId }),
  openCodeViewer: (nodeId) => set({ selectedNodeId: nodeId }),
  setDomainGraph: (graph) => set({ domainGraph: graph }),
  setViewMode: (mode) => set({ viewMode: mode, selectedNodeId: null, focusNodeId: null }),
  setIsKnowledgeGraph: (value) => set({ isKnowledgeGraph: value }),
  navigateToDomain: (domainId) => set({ viewMode: "domain", activeDomainId: domainId, selectedNodeId: domainId }),
  clearActiveDomain: () => set({ activeDomainId: null, selectedNodeId: null }),
  appendLayoutIssues: () => {},

  startTour: () => {
    const steps = sortedTour(get().graph);
    if (steps.length === 0) return;
    set({
      tourActive: true,
      currentTourStep: 0,
      tourHighlightedNodeIds: steps[0].nodeIds,
      selectedNodeId: steps[0].nodeIds[0] ?? null,
    });
  },

  stopTour: () => set({ tourActive: false, currentTourStep: 0, tourHighlightedNodeIds: [] }),

  setTourStep: (step) => {
    const steps = sortedTour(get().graph);
    const selected = steps[step];
    if (!selected) return;
    set({
      currentTourStep: step,
      tourHighlightedNodeIds: selected.nodeIds,
      selectedNodeId: selected.nodeIds[0] ?? null,
    });
  },

  nextTourStep: () => get().setTourStep(get().currentTourStep + 1),
  prevTourStep: () => get().setTourStep(get().currentTourStep - 1),
}));
