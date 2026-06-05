import type {
  ChatPlanDraftRequest,
  ChatPlanDraftResult,
  MissionSpec,
} from "../../types/agentgraph";

function safeText(value: unknown): string {
  return String(value || "").trim();
}

function ensureAgentRun(
  missionSpec: MissionSpec,
  agentId: string,
  promptSeed: string,
  required: boolean,
) {
  const idx = missionSpec.agentRuns.findIndex((run) => run.agentId === agentId);
  if (idx >= 0) {
    missionSpec.agentRuns[idx] = {
      ...missionSpec.agentRuns[idx],
      promptSeed,
      required,
    };
    return;
  }
  missionSpec.agentRuns.push({
    id: `run_${Date.now()}_${agentId}`,
    agentId,
    promptSeed,
    required,
  });
}

function removeAgentRun(missionSpec: MissionSpec, agentId: string) {
  missionSpec.agentRuns = missionSpec.agentRuns.filter((run) => run.agentId !== agentId);
}

function inferMissionType(message: string): "plan_only" | "research_to_knowgraph" | "object_agent_setup" | "graph_query_summary" {
  if (/\b(query|summarize graph|traverse)\b/i.test(message)) return "graph_query_summary";
  if (/\b(object|canvas|setup)\b/i.test(message)) return "object_agent_setup";
  if (/\bresearch|knowgraph|evidence\b/i.test(message)) return "research_to_knowgraph";
  return "plan_only";
}

export function draftMissionSpecFromChat(
  request: ChatPlanDraftRequest,
): ChatPlanDraftResult {
  const message = safeText(request.userMessage);
  if (!message || message.split(/\s+/).length < 2) {
    return {
      status: "needs_user_input",
      summary: "Need more detail to draft a usable mission.",
      chatReply: null,
      questions: [
        "What concrete outcome should this mission produce?",
        "Which object or canvas should this target?",
      ],
      suggestedNextAction: "Provide mission goal and target.",
    };
  }

  const missionType = inferMissionType(message);
  const base: MissionSpec = request.currentMissionSpec
    ? {
        ...request.currentMissionSpec,
        agentRuns: [...request.currentMissionSpec.agentRuns],
      }
    : {
        id: `mission_${Date.now()}`,
        title: message.slice(0, 72),
        userGoal: message,
        target: request.activeCanvasId || "agentbuilder_deck",
        readContext: request.graphContextRefs || [],
        runState: "draft",
        agentRuns: [],
      };

  if (!request.currentMissionSpec) {
    base.title = message.slice(0, 72);
    base.userGoal = message;
  } else if (/\bchange|update|refine|make\b/i.test(message)) {
    base.userGoal = message;
  }

  if (missionType === "research_to_knowgraph") {
    ensureAgentRun(base, "research_agent", "Research the topic and gather evidence-backed findings.", true);
    ensureAgentRun(base, "knowgraph_agent", "Convert research findings into grounded KnowGraph updates.", true);
    ensureAgentRun(base, "thinkgraph_agent", "Summarize mission outcome and unresolved questions.", false);
  } else if (missionType === "object_agent_setup") {
    ensureAgentRun(base, "plan_agent", "Define object setup steps and expected outputs.", true);
    ensureAgentRun(base, "thinkgraph_agent", "Capture provisional object setup rationale.", false);
  } else if (missionType === "graph_query_summary") {
    ensureAgentRun(base, "codegraph_agent", "Query/traverse graph context and summarize key paths.", false);
    ensureAgentRun(base, "thinkgraph_agent", "Summarize graph findings for mission context.", false);
  } else {
    ensureAgentRun(base, "plan_agent", "Produce a clear execution plan and gate criteria.", true);
  }

  if (/\badd knowgraph\b/i.test(message)) {
    ensureAgentRun(base, "knowgraph_agent", "Add grounded knowledge extraction/update step.", true);
  }
  if (/\bskip codegraph\b/i.test(message)) {
    removeAgentRun(base, "codegraph_agent");
  }
  if (/\bresearch-heavy|research heavy\b/i.test(message)) {
    ensureAgentRun(base, "research_agent", "Perform deeper research with broader evidence coverage.", true);
  }
  if (/\bask questions first|questions first\b/i.test(message)) {
    if (base.agentRuns.length > 0) {
      base.agentRuns[0] = {
        ...base.agentRuns[0],
        promptSeed: `Ask clarifying questions first, then proceed: ${base.agentRuns[0].promptSeed}`,
      };
    }
  }

  return {
    status: "ready",
    summary: `Plan draft updated (${missionType}).`,
    chatReply: null,
    missionSpec: base,
    missionSpecPatch: base,
    suggestedNextAction: "Review and approve when ready.",
  };
}
