import { describe, expect, it } from "vitest";

import {
  canApplyGraphUpdateRequest,
  normalizeKnowGraphOutputToSemanticRecords,
  normalizeThinkGraphOutputToSemanticRecords,
} from "./semanticLanguage";

describe("semanticLanguage", () => {
  it("preserves sourceRefs for KnowGraph normalization", () => {
    const records = normalizeKnowGraphOutputToSemanticRecords([
      {
        id: "kg-1",
        label: "Claim A",
        summary: "Source-backed claim",
        sourceRefs: [
          {
            type: "url",
            ref: "https://example.com/a",
            title: "Example A",
          },
        ],
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].writer).toBe("knowgraph-agent");
    expect(records[0].sourceRefs[0]?.ref).toBe("https://example.com/a");
  });

  it("creates decision/summary/action records for ThinkGraph when provided", () => {
    const records = normalizeThinkGraphOutputToSemanticRecords([
      { id: "tg-1", kind: "decision", label: "Choose path", summary: "Decision made" },
      { id: "tg-2", kind: "summary", label: "Mission summary", summary: "Summary text" },
      { id: "tg-3", kind: "action", label: "Next step", summary: "Do X" },
    ]);
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.kind)).toEqual([
      "decision",
      "summary",
      "action",
    ]);
    expect(records.every((record) => record.writer === "thinkgraph-agent")).toBe(true);
  });

  it("blocks direct graph update apply for non-graph actors", () => {
    expect(canApplyGraphUpdateRequest("workspace-harness")).toBe(false);
    expect(canApplyGraphUpdateRequest("sol")).toBe(false);
    expect(canApplyGraphUpdateRequest("thinkgraph-agent")).toBe(true);
  });
});

