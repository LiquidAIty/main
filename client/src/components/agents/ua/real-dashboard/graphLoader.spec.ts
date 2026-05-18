import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUaGraphCandidateUrls,
  loadUaKnowledgeGraph,
} from "./graphLoader";
import type { KnowledgeGraph } from "./types";

const VALID_GRAPH: KnowledgeGraph = {
  version: "1.0.0",
  kind: "codebase",
  project: {
    name: "LiquidAIty",
    languages: ["TypeScript"],
    frameworks: ["React"],
    description: "fixture",
    analyzedAt: "2026-01-01T00:00:00.000Z",
    gitCommitHash: "local",
  },
  nodes: [],
  edges: [],
  layers: [],
  tour: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("graphLoader", () => {
  it("builds stable candidate URLs including vite /@fs path on windows repo path", () => {
    const urls = buildUaGraphCandidateUrls("C:\\Projects\\LiquidAIty\\main");
    expect(urls).toContain("/.understand-anything/knowledge-graph.json");
    expect(urls).toContain("/knowledge-graph.json");
    expect(urls.some((url) => url.includes("/@fs/C:/Projects/LiquidAIty/main/.understand-anything/knowledge-graph.json"))).toBe(true);
  });

  it("returns empty fallback graph on missing knowledge-graph file (404)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(loadUaKnowledgeGraph("C:\\Projects\\LiquidAIty\\main")).resolves.toMatchObject({
      source: "empty_fallback",
      url: null,
      warning: "missing_graph_file",
      graph: {
        nodes: [],
        edges: [],
        layers: [],
        tour: [],
      },
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns local graph when a candidate returns valid graph JSON", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => VALID_GRAPH,
      } as Response);

    const loaded = await loadUaKnowledgeGraph("C:\\Projects\\LiquidAIty\\main");

    expect(loaded.source).toBe("local_ua_json");
    expect(loaded.warning).toBeUndefined();
    expect(loaded.url).toContain("/@fs/");
    expect(loaded.graph).toEqual(VALID_GRAPH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
