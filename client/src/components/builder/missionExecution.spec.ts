import { describe, expect, it } from "vitest";

import type { DeckDocument, MissionSpec } from "../../types/agentgraph";
import { applyMissionDeckPatch, buildMissionDeckPatch } from "./missionExecution";

const deck: DeckDocument = {
  id: "deck_builder",
  name: "Deck",
  promptTemplates: [],
  version: 1,
  nodes: [
    { id: "card_magentic", templateId: "t", title: "M", position: { x: 0, y: 0 } },
    { id: "card_research_agent", templateId: "t", title: "R", position: { x: 1, y: 0 } },
    { id: "card_knowgraph_agent", templateId: "t", title: "K", position: { x: 2, y: 0 } },
  ],
  edges: [
    { id: "edge_user_custom", source: "card_research_agent", target: "card_knowgraph_agent" },
  ],
};

const mission: MissionSpec = {
  id: "mission_1",
  title: "Run",
  userGoal: "Goal",
  target: "deck",
  readContext: [],
  runState: "approved",
  agentRuns: [
    { id: "a1", agentId: "research_agent", promptSeed: "research this", required: true },
    { id: "a2", agentId: "knowgraph_agent", promptSeed: "store facts", required: true },
  ],
};

describe("missionExecution helpers", () => {
  it("buildMissionDeckPatch seeds prompts and does not infer new edges", () => {
    const patch = buildMissionDeckPatch(mission, deck);
    expect(patch.promptFieldsToUpdate.length).toBe(2);
    expect(patch.edgesToCreate.length).toBe(0);
  });

  it("applyMissionDeckPatch preserves existing node positions and user edges", () => {
    const patch = buildMissionDeckPatch(mission, deck);
    const once = applyMissionDeckPatch(deck, patch);
    const twice = applyMissionDeckPatch(once, patch);
    expect(once.nodes.length).toBeGreaterThanOrEqual(deck.nodes.length);
    expect(twice.edges.length).toBe(once.edges.length);
    expect(once.edges.find((edge) => edge.id === "edge_user_custom")).toBeTruthy();
    expect(once.nodes.find((node) => node.id === "card_research_agent")?.position).toEqual({
      x: 1,
      y: 0,
    });
  });
});
