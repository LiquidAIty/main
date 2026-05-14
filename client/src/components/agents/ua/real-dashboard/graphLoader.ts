import type { KnowledgeGraph } from "./types";

export type UaLoadedGraphResult = {
  graph: KnowledgeGraph;
  source: "local_ua_json";
  url: string;
};

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
): Promise<UaLoadedGraphResult | null> {
  const candidates = buildUaGraphCandidateUrls(repoPath);
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const data: unknown = await response.json();
      if (!isKnowledgeGraphShape(data)) continue;
      return {
        graph: data,
        source: "local_ua_json",
        url,
      };
    } catch {
      // Try next candidate.
    }
  }
  return null;
}
