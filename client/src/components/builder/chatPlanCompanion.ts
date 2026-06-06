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

function isLightweightUserTurn(message: string): boolean {
  const normalized = safeText(message).toLowerCase();
  if (!normalized) return true;
  if (
    /\b(explain|describe)\b/.test(normalized) &&
    /\b(plan canvas|canvas|chat|workspace|what can you do)\b/.test(normalized)
  ) {
    return true;
  }
  if (
    /\bwhat does\b/.test(normalized) &&
    /\b(plan canvas|canvas|chat|workspace)\b/.test(normalized)
  ) {
    return true;
  }
  if (/\b(research|knowgraph|evidence|object|canvas|setup|query|summarize graph|traverse|implement|build|create|draft|plan|refine|update|make)\b/.test(normalized)) {
    return false;
  }
  return (
    /\?$/.test(normalized) ||
    /\b(what can you do|who are you|help|hello|hi|thanks|thank you|ok|okay)\b/.test(
      normalized,
    )
  );
}

function inferMissionType(message: string): "plan_only" | "research_to_knowgraph" | "object_agent_setup" | "graph_query_summary" {
  if (
    /\b(query|summarize graph|traverse)\b/i.test(message) ||
    /\b(search|inspect|lookup)\s+(existing\s+)?(knowgraph|thinkgraph|codegraph)\b/i.test(message)
  ) return "graph_query_summary";
  if (/\b(object|canvas|setup)\b/i.test(message)) return "object_agent_setup";
  if (/\bresearch|knowgraph|evidence\b/i.test(message)) return "research_to_knowgraph";
  return "plan_only";
}

function buildChatReply(missionType: ReturnType<typeof inferMissionType>, message: string): string {
  if (missionType === "research_to_knowgraph") {
    return [
      "I drafted a research path that keeps reasoning and evidence separate:",
      "ThinkGraph frames intent and uncertainty, Research gathers source-backed evidence, KnowGraph ingests provenance-backed facts, and Magentic-One prepares the next-turn context.",
    ].join(" ");
  }
  if (missionType === "graph_query_summary") {
    if (/\bknowgraph\b/i.test(message)) {
      return "Existing KnowGraph query execution is not wired as a supported chat tool yet. I can draft the inspection path, but I will not call an unsupported knowgraph_query tool.";
    }
    return "I drafted a graph-inspection path without running graph tools before approval.";
  }
  if (missionType === "object_agent_setup") {
    return "I drafted an object setup plan for review before any canvas changes run.";
  }
  return "I drafted a plan for review. Nothing will run until you approve it.";
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
  if (isLightweightUserTurn(message)) {
    return {
      status: "ready",
      summary: "Lightweight chat turn; no agent execution proposed yet.",
      chatReply:
        "I can chat, draft plans, coordinate connected agents, and prepare research or implementation workflows for approval before anything runs.",
      suggestedNextAction: "Continue chatting or ask for a concrete plan when ready.",
    };
  }

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
  } else if (
    missionType === "graph_query_summary" ||
    /\bchange|update|refine|make\b/i.test(message)
  ) {
    if (missionType === "graph_query_summary") {
      base.title = message.slice(0, 72);
      base.agentRuns = [];
    }
    base.userGoal = message;
  }

  if (missionType === "research_to_knowgraph") {
    ensureAgentRun(
      base,
      "thinkgraph_agent",
      "Preprocess the request into intent, assumptions, constraints, uncertainty, hypotheses, and search goals. Keep this subjective reasoning separate from KnowGraph evidence.",
      true,
    );
    ensureAgentRun(
      base,
      "research_agent",
      "Gather external source-backed evidence with links, snippets, claims, tables or screenshots when available, and source metadata.",
      true,
    );
    ensureAgentRun(
      base,
      "knowgraph_agent",
      "Ingest research outputs into KnowGraph as objective evidence entities, relationships, properties, provenance, citations, and confidence. Do not perform external search.",
      true,
    );
    ensureAgentRun(
      base,
      "magentic_one",
      "Prepare separate ThinkGraph and KnowGraph context packets for the next turn, comparing congruence, conflicts, missing evidence, uncertainty, and confidence gaps.",
      false,
    );
  } else if (missionType === "object_agent_setup") {
    ensureAgentRun(base, "plan_agent", "Define object setup steps and expected outputs.", true);
    ensureAgentRun(base, "thinkgraph_agent", "Capture provisional object setup rationale.", false);
  } else if (missionType === "graph_query_summary") {
    if (/\bknowgraph\b/i.test(message)) {
      ensureAgentRun(
        base,
        "thinkgraph_agent",
        "Frame the existing-KnowGraph inspection request and list the evidence questions to answer. Do not call unsupported KnowGraph query tools.",
        false,
      );
    } else {
      ensureAgentRun(base, "codegraph_agent", "Query/traverse graph context and summarize key paths.", false);
      ensureAgentRun(base, "thinkgraph_agent", "Summarize graph findings for mission context.", false);
    }
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
    chatReply: buildChatReply(missionType, message),
    missionSpec: base,
    missionSpecPatch: base,
    suggestedNextAction: "Review and approve when ready.",
  };
}
