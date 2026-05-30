import { describe, expect, it } from "vitest";

import type { MissionSpec } from "../../types/agentgraph";
import { draftMissionSpecFromChat } from "./chatPlanCompanion";

describe("draftMissionSpecFromChat", () => {
  it("creates a new draft when no mission exists", () => {
    const result = draftMissionSpecFromChat({
      userMessage: "research climate risk and add knowgraph",
      activeCanvasId: "deck_builder",
      availableAgents: [],
    });
    expect(result.status).toBe("ready");
    expect(result.missionSpec?.agentRuns.length).toBeGreaterThan(0);
  });

  it("refines existing mission and adds knowgraph", () => {
    const existing: MissionSpec = {
      id: "m1",
      title: "Mission",
      userGoal: "Goal",
      target: "deck",
      readContext: [],
      runState: "draft",
      agentRuns: [{ id: "r1", agentId: "research_agent", promptSeed: "research", required: true }],
    };
    const result = draftMissionSpecFromChat({
      userMessage: "add KnowGraph and make it research-heavy",
      currentMissionSpec: existing,
    });
    expect(result.missionSpec?.id).toBe("m1");
    expect(result.missionSpec?.agentRuns.some((run) => run.agentId === "knowgraph_agent")).toBe(true);
  });

  it("skip CodeGraph removes CodeGraph run", () => {
    const existing: MissionSpec = {
      id: "m2",
      title: "Mission",
      userGoal: "Goal",
      target: "deck",
      readContext: [],
      runState: "draft",
      agentRuns: [{ id: "r2", agentId: "codegraph_agent", promptSeed: "summarize", required: false }],
    };
    const result = draftMissionSpecFromChat({
      userMessage: "skip CodeGraph for this run",
      currentMissionSpec: existing,
    });
    expect(result.missionSpec?.agentRuns.some((run) => run.agentId === "codegraph_agent")).toBe(false);
  });

  it("vague input returns needs_user_input", () => {
    const result = draftMissionSpecFromChat({
      userMessage: "help",
    });
    expect(result.status).toBe("needs_user_input");
  });

  it("continued chat refines same draft instead of creating duplicates", () => {
    const first = draftMissionSpecFromChat({
      userMessage: "research AI agent marketplaces and build a knowledge map",
      activeCanvasId: "deck_builder",
    });
    const second = draftMissionSpecFromChat({
      userMessage: "add KnowGraph and make it source-backed",
      currentMissionSpec: first.missionSpec,
    });
    const third = draftMissionSpecFromChat({
      userMessage: "skip CodeGraph for now",
      currentMissionSpec: second.missionSpec,
    });
    expect(first.missionSpec?.id).toBeTruthy();
    expect(second.missionSpec?.id).toBe(first.missionSpec?.id);
    expect(third.missionSpec?.id).toBe(first.missionSpec?.id);
    expect(third.missionSpec?.agentRuns.some((run) => run.agentId === "codegraph_agent")).toBe(false);
  });
});
