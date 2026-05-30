import { describe, expect, it } from "vitest";

import type { DeckDocument, MissionRun, MissionSpec, WorkspaceHarnessRequest } from "../../types/agentgraph";
import { applyMissionDeckPatch, buildMissionDeckPatch } from "./missionExecution";
import { runInternalWorkspaceHarness } from "./workspaceHarness";

const deck: DeckDocument = {
  id: "deck_builder",
  name: "Deck",
  promptTemplates: [],
  version: 1,
  nodes: [
    { id: "card_magentic", templateId: "t", title: "Magentic", position: { x: 0, y: 0 } },
    { id: "card_research_agent", templateId: "t", title: "Research", position: { x: 1, y: 0 } },
    { id: "card_knowgraph_agent", templateId: "t", title: "KnowGraph", position: { x: 2, y: 0 } },
    { id: "card_thinkgraph_agent", templateId: "t", title: "ThinkGraph", position: { x: 3, y: 0 } },
  ],
  edges: [],
};

const missionSpec: MissionSpec = {
  id: "mission_1",
  title: "Mission",
  userGoal: "Run research mission",
  target: "deck",
  readContext: [],
  runState: "approved",
  agentRuns: [{ id: "a1", agentId: "research_agent", promptSeed: "research", required: true }],
};

const missionRun: MissionRun = {
  id: "mr_1",
  missionSpecId: "mission_1",
  status: "approved",
  activeAgentRunId: null,
  agentRuns: [{ id: "a1", agentId: "research_agent", status: "queued", required: true, promptSeed: "research" }],
  results: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseRequest: WorkspaceHarnessRequest = {
  provider: "internal-workspace",
  operation: "inspect_context",
  userGoal: "inspect deck context",
  permissions: ["deck.read", "mission.read"],
};

describe("workspace harness", () => {
  it("inspect_context returns summary", async () => {
    const result = await runInternalWorkspaceHarness(baseRequest, {
      currentDeck: deck,
      buildMissionDeckPatch,
      applyMissionDeckPatch,
    });
    expect(result.status).toBe("complete");
  });

  it("draft_mission returns MissionSpec patch", async () => {
    const result = await runInternalWorkspaceHarness(
      { ...baseRequest, operation: "draft_mission", userGoal: "build mission" },
      { currentDeck: deck, buildMissionDeckPatch, applyMissionDeckPatch },
    );
    expect(result.missionSpecPatch?.userGoal).toContain("build mission");
  });

  it("generate_deck_patch returns mission patch", async () => {
    const result = await runInternalWorkspaceHarness(
      { ...baseRequest, operation: "generate_deck_patch", missionSpec },
      { currentDeck: deck, buildMissionDeckPatch, applyMissionDeckPatch },
    );
    expect(result.missionDeckPatch?.missionSpecId).toBe("mission_1");
  });

  it("ask_clarifying_questions returns questions for vague input", async () => {
    const result = await runInternalWorkspaceHarness(
      { ...baseRequest, operation: "ask_clarifying_questions", userGoal: "help" },
      { currentDeck: deck, buildMissionDeckPatch, applyMissionDeckPatch },
    );
    expect(result.questions && result.questions.length > 0).toBe(true);
  });

  it("run_approved_mission delegates to provided mission runner", async () => {
    const result = await runInternalWorkspaceHarness(
      { ...baseRequest, operation: "run_approved_mission", missionSpec, missionRun },
      {
        currentDeck: deck,
        buildMissionDeckPatch,
        applyMissionDeckPatch,
        runApprovedMission: async (_spec, run) => ({
          missionRun: { ...run, status: "complete" },
        }),
      },
    );
    expect(result.status).toBe("complete");
  });
});
