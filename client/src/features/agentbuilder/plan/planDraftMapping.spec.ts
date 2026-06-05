import { describe, expect, it } from "vitest";

import type {
  ChatPlanDraftResult,
  MissionSpec,
} from "../../../types/agentgraph";
import type {
  StructuredAssistPlanSurface,
} from "../../../components/builder/assistPlanSurface";
import type {
  PlanMissionGraph,
  PlanMissionFlowEdge,
  PlanMissionFlowNode,
} from "../../../components/assist/planMissionModel";
import {
  chatPlanDraftResultToPlanDraft,
  missionSpecToPlanDraft,
  planDraftToMissionSpec,
  planDraftToStructuredAssistPlanSurface,
  planMissionGraphToPlanDraft,
  structuredAssistPlanSurfaceToPlanDraft,
} from "./planDraftMapping";

describe("planDraftMapping", () => {
  it("maps MissionSpec research path into PlanDraft steps", () => {
    const missionSpec: MissionSpec = {
      id: "mission_research",
      title: "Research Mission",
      userGoal: "Research climate risk and build evidence.",
      target: "deck_builder",
      readContext: ["knowgraph", "research"],
      runState: "draft",
      agentRuns: [
        {
          id: "run_research",
          agentId: "research_agent",
          promptSeed: "Research and gather evidence.",
          required: true,
        },
        {
          id: "run_knowgraph",
          agentId: "knowgraph_agent",
          promptSeed: "Convert evidence into grounded knowledge updates.",
          required: true,
        },
        {
          id: "run_thinkgraph",
          agentId: "thinkgraph_agent",
          promptSeed: "Summarize outcome as provisional plan memory.",
          required: false,
        },
      ],
    };

    const draft = missionSpecToPlanDraft(missionSpec, { projectId: "project_admin" });

    expect(draft.missionId).toBe("mission_research");
    expect(draft.projectId).toBe("project_admin");
    expect(draft.steps).toHaveLength(3);
    expect(draft.requiredAgents).toEqual([
      "research_agent",
      "knowgraph_agent",
      "thinkgraph_agent",
    ]);
    expect(draft.steps[1].dependsOn).toEqual(["run_research"]);
    expect(draft.steps[1].graphWriteTargets).toContain("KnowGraph");
    expect(draft.steps[2].graphWriteTargets).toContain("ThinkGraph");
  });

  it("maps StructuredAssistPlanSurface into PlanDraft summary and steps", () => {
    const structuredPlan: StructuredAssistPlanSurface = {
      planMode: "draft",
      goal: "Research agent marketplaces",
      steps: [
        {
          id: "step_1",
          title: "Gather sources",
          status: "proposed",
          assignedAgentId: "research_agent",
          skillId: null,
          toolIds: ["tavily_search"],
          generatedPrompt: "Find evidence-backed sources.",
          expectedOutput: "Source-backed evidence list",
          relatedFiles: [],
          relatedObjects: [],
          relatedSurface: "knowgraph",
          validationCommand: null,
          approvalRequired: true,
          resultSummary: "",
          blocker: "",
        },
      ],
      whatMattersNow: [],
      nextMove: ["Gather sources"],
      assumptions: [],
      research: [],
      openQuestions: [],
      humanTasks: [],
      agentTasks: [],
      pathOptions: [],
      explicitPlanText: "Research then populate KnowGraph.",
      hasExplicitPlanDocument: true,
      whatChanged: [],
      sources: ["https://example.com/source"],
    };

    const draft = structuredAssistPlanSurfaceToPlanDraft(structuredPlan, {
      projectId: "project_admin",
    });

    expect(draft.summary).toBe("Research agent marketplaces");
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0].requiredTools).toEqual(["tavily_search"]);
    expect(draft.steps[0].expectedOutput).toBe("Source-backed evidence list");
    expect(draft.graphWriteTargets).toContain("KnowGraph");
  });

  it("maps PlanMissionGraph to PlanDraft without treating geometry as business truth", () => {
    const nodes: PlanMissionFlowNode[] = [
      {
        id: "step_b",
        type: "mission",
        position: { x: 999, y: 20 },
        data: {
          label: "Populate KnowGraph",
          kind: "Output",
          status: "approved",
          assignedAgentId: "knowgraph_agent",
          expectedOutput: "Knowledge graph updates",
          approvalRequired: true,
        },
      },
      {
        id: "step_a",
        type: "mission",
        position: { x: -100, y: 20 },
        data: {
          label: "Gather Research",
          kind: "Research",
          status: "running",
          assignedAgentId: "research_agent",
          expectedOutput: "Evidence set",
          approvalRequired: true,
        },
      },
    ];
    const edges: PlanMissionFlowEdge[] = [
      {
        id: "edge_a_b",
        source: "step_a",
        target: "step_b",
        type: "turboFlow",
        data: { motion: "idle" },
      },
    ];
    const missionGraph: PlanMissionGraph = { nodes, edges };

    const draft = planMissionGraphToPlanDraft(missionGraph);

    expect(draft.steps.map((step) => step.id)).toEqual(["step_a", "step_b"]);
    expect(draft.steps[1].dependsOn).toEqual(["step_a"]);
    expect(draft.steps[1].graphWriteTargets).toContain("KnowGraph");
  });

  it("maps ChatPlanDraftResult with missionSpec to PlanDraft", () => {
    const result: ChatPlanDraftResult = {
      status: "ready",
      summary: "Plan draft updated (research_to_knowgraph).",
      missionSpec: {
        id: "mission_chat",
        title: "Research Mission",
        userGoal: "Research EV charging trends",
        target: "deck_builder",
        readContext: [],
        runState: "draft",
        agentRuns: [
          {
            id: "run_research",
            agentId: "research_agent",
            promptSeed: "Research EV charging trends.",
            required: true,
          },
        ],
      },
      suggestedNextAction: "Review and approve when ready.",
    };

    const draft = chatPlanDraftResultToPlanDraft(result, {
      projectId: "project_admin",
      chatReply: "I drafted a research plan for that.",
    });

    expect(draft).not.toBeNull();
    expect(draft?.chatReply).toBe("I drafted a research plan for that.");
    expect(draft?.steps).toHaveLength(1);
    expect(draft?.steps[0].assignedAgent).toBe("research_agent");
  });

  it("maps PlanDraft back to MissionSpec for the existing approval path", () => {
    const missionSpec: MissionSpec = {
      id: "mission_roundtrip",
      title: "Roundtrip",
      userGoal: "Research the topic",
      target: "deck_builder",
      readContext: [],
      runState: "approved",
      agentRuns: [
        {
          id: "run_research",
          agentId: "research_agent",
          promptSeed: "Research the topic.",
          required: true,
        },
        {
          id: "run_knowgraph",
          agentId: "knowgraph_agent",
          promptSeed: "Store grounded graph updates.",
          required: true,
        },
      ],
    };

    const draft = missionSpecToPlanDraft(missionSpec);
    const roundTrip = planDraftToMissionSpec(draft);

    expect(roundTrip.id).toBe("mission_roundtrip");
    expect(roundTrip.runState).toBe("approved");
    expect(roundTrip.agentRuns.map((run) => run.agentId)).toEqual([
      "research_agent",
      "knowgraph_agent",
    ]);
  });

  it("bridges PlanDraft into StructuredAssistPlanSurface for the current Plan Canvas path", () => {
    const missionSpec: MissionSpec = {
      id: "mission_bridge",
      title: "Bridge",
      userGoal: "Research then ground the result",
      target: "deck_builder",
      readContext: [],
      runState: "draft",
      agentRuns: [
        {
          id: "run_research",
          agentId: "research_agent",
          promptSeed: "Research the topic and gather evidence.",
          required: true,
        },
      ],
    };

    const draft = missionSpecToPlanDraft(missionSpec, {
      chatReply: "I drafted a research step.",
    });
    const structuredPlan = planDraftToStructuredAssistPlanSurface(draft);

    expect(structuredPlan.goal).toBe("Research then ground the result");
    expect(structuredPlan.explicitPlanText).toBe("Bridge");
    expect(structuredPlan.steps).toHaveLength(1);
    expect(structuredPlan.steps[0].assignedAgentId).toBe("research_agent");
  });
});
