import { describe, expect, it } from "vitest";

import {
  canApplyGraphUpdateRequest,
  normalizeKnowGraphOutputToSemanticRecords,
  normalizeKnowGraphOutputToSemanticRecordsWithValidation,
  normalizeThinkGraphOutputToSemanticRecords,
  normalizeThinkGraphOutputToSemanticRecordsWithValidation,
  validateSemanticGraphRecord,
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
        provenance: { createdByAgent: "knowgraph-agent" },
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].writer).toBe("knowgraph-agent");
    expect(records[0].sourceRefs[0]?.ref).toBe("https://example.com/a");
  });

  it("accepts JSON-LD fields @context, @id, @type", () => {
    const records = normalizeKnowGraphOutputToSemanticRecords([
      {
        id: "kg-jsonld",
        label: "Claim JSON-LD",
        summary: "JSON-LD metadata present",
        provenance: { createdByAgent: "knowgraph-agent" },
        sourceRefs: [{ type: "url", ref: "https://example.com/jsonld" }],
        "@context": "https://schema.org",
        "@id": "urn:kg:jsonld",
        "@type": ["Claim"],
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]["@context"]).toBe("https://schema.org");
    expect(records[0]["@id"]).toBe("urn:kg:jsonld");
    expect(records[0]["@type"]).toEqual(["Claim"]);
  });

  it("preserves entities/relationships/properties and maps relationship/property OWL-compatible fields", () => {
    const records = normalizeKnowGraphOutputToSemanticRecords([
      {
        id: "kg-struct",
        label: "Structured record",
        summary: "Structured content",
        provenance: { createdByAgent: "knowgraph-agent" },
        sourceRefs: [{ type: "url", ref: "https://example.com/struct" }],
        entities: [{ id: "e1", label: "Tesla", type: "company" }],
        relationships: [{ id: "r1", from: "e1", to: "e2", type: "manufactures", confidence: 0.88 }],
        properties: { price: 12.5, volatility: 0.38 },
      },
    ]);
    expect(records[0].entities).toHaveLength(1);
    expect(records[0].relationships).toHaveLength(1);
    expect(records[0].objectProperties?.[0]?.type).toBe("manufactures");
    expect(records[0].datatypeProperties?.some((p) => p.key === "price" && p.value === 12.5)).toBe(true);
  });

  it("creates decision/summary/action records for ThinkGraph when provided", () => {
    const records = normalizeThinkGraphOutputToSemanticRecords([
      { id: "tg-1", kind: "decision", label: "Choose path", summary: "Decision made", provenance: { createdByAgent: "thinkgraph-agent" } },
      { id: "tg-2", kind: "summary", label: "Mission summary", summary: "Summary text", provenance: { createdByAgent: "thinkgraph-agent" } },
      { id: "tg-3", kind: "action", label: "Next step", summary: "Do X", provenance: { createdByAgent: "thinkgraph-agent" } },
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

  it("rejects missing provenance", () => {
    const result = normalizeThinkGraphOutputToSemanticRecordsWithValidation([
      { id: "tg-no-prov", kind: "summary", label: "No provenance", summary: "x" },
    ]);
    expect(result.records).toHaveLength(0);
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.join(" ")).toContain("missing provenance");
  });

  it("rejects KnowGraph claim without sourceRefs unless low confidence", () => {
    const strict = normalizeKnowGraphOutputToSemanticRecordsWithValidation([
      {
        id: "kg-claim-nosrc",
        kind: "claim",
        label: "Unsupported claim",
        summary: "No source refs",
        confidence: 0.9,
        provenance: { createdByAgent: "knowgraph-agent" },
      },
    ]);
    expect(strict.records).toHaveLength(0);
    expect(strict.validation.errors.join(" ")).toContain("missing sourceRef");

    const low = normalizeKnowGraphOutputToSemanticRecordsWithValidation([
      {
        id: "kg-claim-low",
        kind: "claim",
        label: "Low confidence claim",
        summary: "No source refs but low confidence",
        confidence: 0.2,
        provenance: { createdByAgent: "knowgraph-agent" },
      },
    ]);
    expect(low.records).toHaveLength(1);
    expect(low.validation.warnings.join(" ")).toContain("low confidence");
  });

  it("preserves numeric properties", () => {
    const records = normalizeKnowGraphOutputToSemanticRecords([
      {
        id: "kg-metrics",
        label: "Numeric payload",
        summary: "Has numeric properties",
        sourceRefs: [{ type: "url", ref: "https://example.com/metrics" }],
        provenance: { createdByAgent: "knowgraph-agent" },
        properties: { price: 42.5, count: 12, trend: [1, 2, 3], nested: { score: 0.91 } },
      },
    ]);
    expect(records[0].properties).toEqual({
      price: 42.5,
      count: 12,
      trend: [1, 2, 3],
      nested: { score: 0.91 },
    });
  });

  it("does not silently fallback unknown source type to chat", () => {
    const result = normalizeKnowGraphOutputToSemanticRecordsWithValidation([
      {
        id: "kg-bad-source",
        label: "Bad source ref type",
        summary: "Unsupported source type",
        sourceRefs: [{ type: "rss", ref: "https://example.com/rss" }],
        provenance: { createdByAgent: "knowgraph-agent" },
      },
    ]);
    expect(result.records[0].sourceRefs).toHaveLength(0);
    expect(result.validation.warnings.join(" ")).toContain("unsupported type");
  });

  it("normalizeKnowGraphOutputToSemanticRecords preserves URL sourceRefs", () => {
    const result = normalizeKnowGraphOutputToSemanticRecordsWithValidation([
      {
        id: "kg-url",
        label: "URL claim",
        summary: "Source-linked",
        sourceRefs: [{ type: "url", ref: "https://example.com/src" }],
        provenance: { createdByAgent: "knowgraph-agent" },
      },
    ]);
    expect(result.records[0].sourceRefs[0]?.type).toBe("url");
    expect(result.records[0].sourceRefs[0]?.ref).toBe("https://example.com/src");
  });

  it("maps provenance/source metadata to annotationProperties and sourceRefs", () => {
    const result = normalizeKnowGraphOutputToSemanticRecordsWithValidation([
      {
        id: "kg-ann",
        label: "Annotated",
        summary: "Metadata mapping",
        sourceRefs: [{ type: "url", ref: "https://example.com/ann", title: "Ann" }],
        provenance: { createdByAgent: "knowgraph-agent", reasoningSummary: "safe summary" },
      },
    ]);
    expect(result.records[0].sourceRefs[0]?.title).toBe("Ann");
    expect(result.records[0].annotationProperties?.some((p) => p.key === "provenance")).toBe(true);
  });

  it("normalizeThinkGraphOutputToSemanticRecords creates decision/summary/action records", () => {
    const result = normalizeThinkGraphOutputToSemanticRecordsWithValidation([
      { id: "tgd-1", kind: "decision", label: "D", summary: "D", provenance: { createdByAgent: "thinkgraph-agent" } },
      { id: "tgd-2", kind: "summary", label: "S", summary: "S", provenance: { createdByAgent: "thinkgraph-agent" } },
      { id: "tgd-3", kind: "action", label: "A", summary: "A", provenance: { createdByAgent: "thinkgraph-agent" } },
    ]);
    expect(result.records.map((r) => r.kind)).toEqual(["decision", "summary", "action"]);
  });

  it("allows useful ThinkGraph records with chat/user_input and mission sourceRefs", () => {
    const result = normalizeThinkGraphOutputToSemanticRecordsWithValidation([
      {
        id: "tg-chat-1",
        kind: "decision",
        label: "Decision",
        summary: "Decision summary",
        sourceRefs: [{ type: "chat", ref: "chat:1" }, { type: "user_input", ref: "input:1" }],
        provenance: { createdByAgent: "thinkgraph-agent" },
      },
      {
        id: "tg-mission-1",
        kind: "summary",
        label: "Mission summary",
        summary: "Mission summary text",
        sourceRefs: [{ type: "mission", ref: "mission:run-1" }],
        provenance: { createdByAgent: "thinkgraph-agent", missionRunId: "run-1" },
      },
      {
        id: "tg-question-1",
        kind: "question",
        label: "Open question",
        summary: "What should we test first?",
        sourceRefs: [{ type: "user_input", ref: "input:2" }],
        provenance: { createdByAgent: "thinkgraph-agent" },
      },
    ]);
    expect(result.validation.ok).toBe(true);
    expect(result.records).toHaveLength(3);
  });

  it("allows useful KnowGraph claim/evidence records with URL sourceRefs", () => {
    const result = normalizeKnowGraphOutputToSemanticRecordsWithValidation([
      {
        id: "kg-claim-1",
        kind: "claim",
        label: "Claim",
        summary: "Claim summary",
        sourceRefs: [{ type: "url", ref: "https://example.com/c" }],
        provenance: { createdByAgent: "knowgraph-agent" },
      },
      {
        id: "kg-evidence-1",
        kind: "evidence",
        label: "Evidence",
        summary: "Evidence summary",
        sourceRefs: [{ type: "url", ref: "https://example.com/e" }],
        provenance: { createdByAgent: "knowgraph-agent" },
      },
    ]);
    expect(result.validation.ok).toBe(true);
    expect(result.records).toHaveLength(2);
  });
});
