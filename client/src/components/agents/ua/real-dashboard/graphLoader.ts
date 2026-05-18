import type { KnowledgeGraph } from "./types";

export type UaLoadedGraphResult = {
  graph: KnowledgeGraph;
  source: "local_ua_json" | "empty_fallback";
  url: string | null;
  warning?: "missing_graph_file" | "graph_unavailable";
};

const UA_EMPTY_GRAPH_VERSION = "1.0.0";

function buildEmptyKnowledgeGraph(repoPath: string): KnowledgeGraph {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  const projectName = normalizedRepoPath.split("/").pop() || "LiquidAIty";
  return {
    version: UA_EMPTY_GRAPH_VERSION,
    kind: "codebase",
    project: {
      name: projectName,
      languages: [],
      frameworks: ["Agent Builder"],
      description:
        "No local Understand-Anything knowledge graph file was found. Using an empty fallback graph.",
      analyzedAt: new Date().toISOString(),
      gitCommitHash: "unavailable",
    },
    nodes: [],
    edges: [],
    layers: [],
    tour: [],
  };
}

function normalizeRepoPath(repoPath: string): string {
  return String(repoPath || "").trim().replace(/\\/g, "/");
}

function toViteFsUrl(repoPath: string): string | null {
  const normalized = normalizeRepoPath(repoPath);
  if (!/^[A-Za-z]:\//.test(normalized)) return null;
  return `/@fs/${encodeURI(normalized)}/.understand-anything/knowledge-graph.json`;
}

export function buildUaGraphCandidateUrls(repoPath: string): string[] {
  const urls = new Set<string>();
  urls.add("/.understand-anything/knowledge-graph.json");
  const viteFs = toViteFsUrl(repoPath);
  if (viteFs) urls.add(viteFs);
  urls.add("/knowledge-graph.json");
  return Array.from(urls);
}

function isKnowledgeGraphShape(value: unknown): value is KnowledgeGraph {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KnowledgeGraph>;
  return (
    typeof candidate.version === "string" &&
    !!candidate.project &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    Array.isArray(candidate.layers) &&
    Array.isArray(candidate.tour)
  );
}

export async function loadUaKnowledgeGraph(
  repoPath: string,
  signal?: AbortSignal,
): Promise<UaLoadedGraphResult> {
  const candidates = buildUaGraphCandidateUrls(repoPath);
  let sawMissingGraphFile = false;
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 404 || response.status === 410) {
        sawMissingGraphFile = true;
        continue;
      }
      if (!response.ok) continue;
      const data: unknown = await response.json();
      if (!isKnowledgeGraphShape(data)) continue;
      return {
        graph: data,
        source: "local_ua_json",
        url,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      // Try next candidate.
    }
  }
  return {
    graph: buildEmptyKnowledgeGraph(repoPath),
    source: "empty_fallback",
    url: null,
    warning: sawMissingGraphFile ? "missing_graph_file" : "graph_unavailable",
  };
}
