import type { PlanDraft } from "./planDraftTypes";

const RUNTIME_NOISE_PATTERNS = [
  /\bautogen_orchestrator_http_500\b/i,
  /\bteam_runtime_participants_required\b/i,
  /\bassistant_tool_not_supported\b/i,
  /\bmagentic_callable_heads_required\b/i,
  /\binternal server error\b/i,
  /\brequest failed\b/i,
  /\bplan draft idle\b/i,
  /\bactive plan goal\b/i,
  /\bplan note\b/i,
] as const;

function safeText(value: unknown): string {
  return String(value || "").trim();
}

export function isRuntimeNoiseText(value: unknown): boolean {
  const text = safeText(value);
  if (!text) return false;
  return RUNTIME_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

export function cleanPlanDraftText(value: unknown): string {
  const text = safeText(value);
  if (!text) return "";
  return isRuntimeNoiseText(text) ? "" : text;
}

export function stripRuntimeNoiseFromPlanDraft(planDraft: PlanDraft): PlanDraft {
  return {
    ...planDraft,
    userRequest: cleanPlanDraftText(planDraft.userRequest),
    chatReply: cleanPlanDraftText(planDraft.chatReply) || null,
    summary: cleanPlanDraftText(planDraft.summary),
    risks: planDraft.risks.map(cleanPlanDraftText).filter(Boolean),
    expectedOutputs: planDraft.expectedOutputs
      .map(cleanPlanDraftText)
      .filter(Boolean),
    steps: planDraft.steps
      .map((step) => ({
        ...step,
        title: cleanPlanDraftText(step.title),
        description: cleanPlanDraftText(step.description),
        expectedOutput: cleanPlanDraftText(step.expectedOutput),
      }))
      .filter((step) => Boolean(step.title)),
  };
}

export function isLightweightPlanDraft(planDraft: PlanDraft): boolean {
  return planDraft.steps.length === 0 && planDraft.requiredAgents.length === 0;
}

export function ensureMinimalValidPlanDraft(planDraft: PlanDraft): PlanDraft {
  const cleaned = stripRuntimeNoiseFromPlanDraft(planDraft);
  return {
    ...cleaned,
    approvalState: cleaned.approvalState || "draft",
    userRequest:
      cleanPlanDraftText(cleaned.userRequest) ||
      cleanPlanDraftText(cleaned.chatReply) ||
      "Lightweight chat turn",
    summary:
      cleanPlanDraftText(cleaned.summary) ||
      "Lightweight chat turn; no agent execution proposed yet.",
    chatReply: cleanPlanDraftText(cleaned.chatReply) || null,
    requiredAgents: cleaned.steps.length > 0 ? cleaned.requiredAgents : [],
    requiredTools: cleaned.steps.length > 0 ? cleaned.requiredTools : [],
    expectedOutputs: cleaned.steps.length > 0 ? cleaned.expectedOutputs : [],
    graphWriteTargets: cleaned.steps.length > 0 ? cleaned.graphWriteTargets : [],
    risks: cleaned.steps.length > 0 ? cleaned.risks : [],
    steps: cleaned.steps,
    edges:
      cleaned.steps.length > 0
        ? cleaned.edges.filter(
            (edge) =>
              cleaned.steps.some((step) => step.id === edge.fromStepId) &&
              cleaned.steps.some((step) => step.id === edge.toStepId),
          )
        : [],
  };
}

export function sanitizePlanDraftForCanvas(planDraft: PlanDraft): PlanDraft {
  const normalized = ensureMinimalValidPlanDraft(planDraft);
  if (isLightweightPlanDraft(normalized)) {
    return {
      ...normalized,
      steps: [],
      edges: [],
      requiredAgents: [],
      requiredTools: [],
      expectedOutputs: [],
      graphWriteTargets: [],
      risks: [],
    };
  }
  return normalized;
}
