import { describe, expect, it } from "vitest";

import {
  compareThinkAndKnowContext,
  createEmptyGraphContextPacket,
  mergeSelectedContextPacket,
  summarizeGraphContextForPrompt,
  type GraphContextPacket,
} from "./graphContextPacket";

describe("graphContextPacket", () => {
  it("creates an empty packet with separate streams preserved", () => {
    const packet = createEmptyGraphContextPacket({
      projectId: "project_admin",
      requestId: "req_1",
      turnId: "turn_1",
    });

    expect(packet.projectId).toBe("project_admin");
    expect(packet.thinkGraphContext.intent).toEqual([]);
    expect(packet.knowGraphContext.evidence).toEqual([]);
    expect(packet.codeGraphContext).toBeNull();
    expect(packet.comparison.conflicts).toEqual([]);
  });

  it("merges selected board context without disturbing graph streams", () => {
    const packet = createEmptyGraphContextPacket();
    const merged = mergeSelectedContextPacket(packet, {
      selectedNodeIds: ["card_magentic", "card_thinkgraph_agent", "card_magentic"],
      selectedCardId: "card_magentic",
      references: [
        { id: "card_magentic", label: "Magentic-One", kind: "card" },
        { id: "card_magentic", label: "Magentic-One", kind: "card" },
      ],
    });

    expect(merged.selectedBoardContext.selectedNodeIds).toEqual([
      "card_magentic",
      "card_thinkgraph_agent",
    ]);
    expect(merged.selectedBoardContext.references).toHaveLength(1);
    expect(merged.thinkGraphContext.intent).toEqual([]);
    expect(merged.knowGraphContext.evidence).toEqual([]);
  });

  it("compares ThinkGraph and KnowGraph without merging evidence into reasoning", () => {
    const comparison = compareThinkAndKnowContext(
      {
        intent: ["lithium battery recycling"],
        assumptions: ["recycling demand rising"],
        hypotheses: [],
        uncertainties: [],
        goals: ["populate knowgraph"],
        decisions: [],
        outcomes: ["stale draft replaced"],
        reasoningNotes: [],
        confidenceNotes: [],
      },
      {
        entities: [
          { id: "entity_1", label: "lithium battery recycling", type: "topic" },
        ],
        relations: [],
        evidence: [],
        sources: [],
        citations: [],
        provenance: [{ id: "prov_1", label: "source-1", confidence: "low" }],
        confidence: [],
        timestamps: [],
      },
    );

    expect(comparison.congruence[0]?.label).toBe("lithium battery recycling");
    expect(comparison.missingEvidence.some((item) => item.label === "populate knowgraph")).toBe(
      true,
    );
    expect(comparison.staleContextWarnings).toHaveLength(1);
    expect(comparison.conflicts).toEqual([]);
  });

  it("summarizes prompt context with source labels preserved", () => {
    const packet: GraphContextPacket = {
      ...createEmptyGraphContextPacket({ projectId: "project_admin" }),
      thinkGraphContext: {
        intent: ["research lithium battery recycling"],
        assumptions: ["need evidence-backed claims"],
        hypotheses: [],
        uncertainties: [],
        goals: [],
        decisions: [],
        outcomes: [],
        reasoningNotes: [],
        confidenceNotes: [],
      },
      knowGraphContext: {
        entities: [],
        relations: [],
        evidence: [
          {
            id: "evidence_1",
            title: "DOE recycling overview",
            snippet: "Federal summary of recycling capacity.",
            sourceLabel: "DOE",
          },
        ],
        sources: [{ id: "source_1", label: "DOE" }],
        citations: [],
        provenance: [],
        confidence: [],
        timestamps: [],
      },
      provenance: {
        generatedAt: "2026-06-05T00:00:00.000Z",
        sourceLabels: ["ThinkGraph", "KnowGraph"],
        debugNotes: [],
        packetVersion: "stage0.v1",
      },
    };

    const summary = summarizeGraphContextForPrompt(packet);
    expect(summary).toContain("ThinkGraph intent:");
    expect(summary).toContain("KnowGraph evidence:");
    expect(summary).toContain("[source=DOE]");
    expect(summary).toContain("Context sources: ThinkGraph; KnowGraph");
  });

  it("keeps CodeGraph context optional", () => {
    const packet = createEmptyGraphContextPacket();
    const summary = summarizeGraphContextForPrompt(packet);

    expect(packet.codeGraphContext).toBeNull();
    expect(summary).toBe("");
  });
});
