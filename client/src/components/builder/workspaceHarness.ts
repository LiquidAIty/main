import type {
  DeckDocument,
  MissionDeckPatch,
  MissionRun,
  MissionSpec,
  OpenMissionMessage,
  WorkspaceHarnessOperation,
  WorkspaceHarnessRequest,
  WorkspaceHarnessResult,
} from "../../types/agentgraph";

type InternalWorkspaceHarnessDeps = {
  currentDeck: DeckDocument;
  buildMissionDeckPatch: (missionSpec: MissionSpec, currentDeck: DeckDocument) => MissionDeckPatch;
  applyMissionDeckPatch: (currentDeck: DeckDocument, patch: MissionDeckPatch) => DeckDocument;
  runApprovedMission?: (
    missionSpec: MissionSpec,
    missionRun: MissionRun,
  ) => Promise<{
    missionRun: MissionRun;
    openMissionMessage?: OpenMissionMessage | null;
  }>;
};

function safeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function buildDraftMissionSpec(request: WorkspaceHarnessRequest): MissionSpec {
  const goal = safeText(request.userGoal) || "Run approved mission.";
  const available = Array.isArray(request.availableAgents) ? request.availableAgents : [];
  const idFromAgent = (id: string) => available.some((entry) => entry.id === id);
  const agentRuns = [
    idFromAgent("research_agent") ? { agentId: "research_agent", promptSeed: "Research and gather evidence.", required: true } : null,
    idFromAgent("knowgraph_agent") ? { agentId: "knowgraph_agent", promptSeed: "Convert evidence into grounded knowledge updates.", required: true } : null,
    idFromAgent("thinkgraph_agent") ? { agentId: "thinkgraph_agent", promptSeed: "Summarize outcome as provisional plan memory.", required: false } : null,
  ].filter(Boolean) as MissionSpec["agentRuns"];
  return {
    id: `mission_${Date.now()}`,
    title: goal.length > 72 ? `${goal.slice(0, 69)}...` : goal,
    userGoal: goal,
    target: request.activeCanvasId || "agentbuilder_deck",
    readContext: request.graphContextRefs || [],
    agentRuns,
    runState: "draft",
  };
}

function clarifyingQuestions(request: WorkspaceHarnessRequest): string[] {
  const questions: string[] = [];
  if (!safeText(request.userGoal) || safeText(request.userGoal).split(/\s+/).length < 3) {
    questions.push("What concrete outcome should this mission produce?");
  }
  if (!request.selectedObject) {
    questions.push("Which canvas object or plan block should this mission target?");
  }
  if (!request.missionSpec && request.operation !== "inspect_context") {
    questions.push("Should I draft a MissionSpec from this request before wiring agents?");
  }
  return questions;
}

export async function runInternalWorkspaceHarness(
  request: WorkspaceHarnessRequest,
  deps: InternalWorkspaceHarnessDeps,
): Promise<WorkspaceHarnessResult> {
  const operation: WorkspaceHarnessOperation = request.operation;
  const missionSpec = request.missionSpec || buildDraftMissionSpec(request);
  if (request.provider !== "internal-workspace") {
    return {
      status: "failed",
      summary: "Unsupported harness provider for this pass.",
      errorReason: "provider_not_supported",
      suggestedNextAction: "inspect_context",
    };
  }

  if (operation === "inspect_context") {
    return {
      status: "complete",
      summary: `Canvas ${request.activeCanvasId || "unknown"} with ${deps.currentDeck.nodes.length} nodes and ${deps.currentDeck.edges.length} edges.`,
      suggestedNextAction: "draft_mission",
    };
  }

  if (operation === "ask_clarifying_questions") {
    const questions = clarifyingQuestions(request);
    return {
      status: questions.length > 0 ? "needs_user_input" : "complete",
      summary:
        questions.length > 0
          ? "Need clarification before workspace mutation."
          : "Context is clear enough to proceed.",
      questions,
      suggestedNextAction: questions.length > 0 ? "ask_clarifying_questions" : "draft_mission",
    };
  }

  if (operation === "draft_mission") {
    return {
      status: "complete",
      summary: "Drafted MissionSpec from current workspace context.",
      missionSpecPatch: missionSpec,
      suggestedNextAction: "generate_deck_patch",
    };
  }

  if (operation === "refine_mission") {
    return {
      status: "complete",
      summary: "Refined MissionSpec draft.",
      missionSpecPatch: {
        ...missionSpec,
        userGoal: safeText(request.userGoal) || missionSpec.userGoal,
      },
      suggestedNextAction: "generate_deck_patch",
    };
  }

  if (
    operation === "generate_deck_patch" ||
    operation === "connect_agents" ||
    operation === "seed_prompts"
  ) {
    const patch = deps.buildMissionDeckPatch(missionSpec, deps.currentDeck);
    return {
      status: "complete",
      summary: "Generated mission deck patch.",
      missionDeckPatch: patch,
      suggestedNextAction: "apply_deck_patch",
    };
  }

  if (operation === "apply_deck_patch") {
    const patch = request.missionSpec
      ? deps.buildMissionDeckPatch(request.missionSpec, deps.currentDeck)
      : deps.buildMissionDeckPatch(missionSpec, deps.currentDeck);
    return {
      status: "complete",
      summary: "Applied mission deck patch to workspace state.",
      missionDeckPatch: patch,
      suggestedNextAction: "run_approved_mission",
    };
  }

  if (operation === "run_approved_mission") {
    if (!request.missionRun || !deps.runApprovedMission) {
      return {
        status: "failed",
        summary: "Mission run execution callback is unavailable.",
        errorReason: "mission_runner_unavailable",
      };
    }
    const output = await deps.runApprovedMission(missionSpec, request.missionRun);
    return {
      status: output.missionRun.status === "needs_user_input" ? "needs_user_input" : "complete",
      summary: `Mission run ${output.missionRun.status}.`,
      missionRunUpdate: output.missionRun,
      openMissionMessage: output.openMissionMessage || null,
      suggestedNextAction:
        output.missionRun.status === "complete" ? null : "ask_clarifying_questions",
    };
  }

  if (operation === "request_graph_update") {
    return {
      status: "complete",
      summary: "Prepared graph update request for graph-owned agents.",
      graphUpdateRequests: [
        {
          id: `gur_${Date.now()}`,
          targetGraph: "think",
          requestedBy: "workspace-harness",
          reason: "Mission result should be reflected in provisional reasoning graph.",
          proposedRecords: [],
          sourceRefs: [],
          confidence: null,
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  if (operation === "query_graph" || operation === "traverse_graph") {
    return {
      status: "complete",
      summary: "Graph read operation acknowledged; use existing graph APIs from workspace.",
      suggestedNextAction: "draft_mission",
    };
  }

  return {
    status: "failed",
    summary: "Unsupported workspace harness operation.",
    errorReason: "unsupported_operation",
  };
}
