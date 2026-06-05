export type PlanStructureOwnership =
  | "canonical"
  | "derived"
  | "adapter"
  | "runtime_only"
  | "visual_only"
  | "envelope";

export type PlanStructureOwnershipRecord = {
  structure: string;
  currentLocation: string;
  role: string;
  ownership: PlanStructureOwnership;
  futureDirection: string;
  riskIfUsedIncorrectly: string;
};

// Ownership contract for Stage 0: PlanDraft is the authoring truth.
// Everything else here is either a derived presentation, an execution adapter,
// or a runtime envelope that may map into/out of PlanDraft.
export const PLAN_STRUCTURE_OWNERSHIP_TABLE: readonly PlanStructureOwnershipRecord[] = [
  {
    structure: "PlanDraft",
    currentLocation: "client/src/features/agentbuilder/plan/planDraftTypes.ts",
    role: "Canonical business truth for the current draft plan.",
    ownership: "canonical",
    futureDirection:
      "Own goal, summary, ordered steps, approvalState, requiredAgents, requiredTools, expectedOutputs, risks, graphWriteTargets, revision, and timestamps.",
    riskIfUsedIncorrectly:
      "If treated as derived or optional, draft state will fragment again across chat, plan, and run paths.",
  },
  {
    structure: "MissionSpec / MissionRun",
    currentLocation: "client/src/types/agentgraph.ts",
    role: "Execution adapter for the existing approved-run path.",
    ownership: "adapter",
    futureDirection:
      "Derive from PlanDraft when execution is approved instead of becoming authoring truth again.",
    riskIfUsedIncorrectly:
      "If reused as the canonical draft object, execution details will leak back into authoring state and block cleaner runtime evolution.",
  },
  {
    structure: "ChatPlanDraftRequest / ChatPlanDraftResult",
    currentLocation: "client/src/types/agentgraph.ts",
    role: "Chat-to-plan request/response envelope.",
    ownership: "envelope",
    futureDirection:
      "Carry chatReply plus PlanDraft-compatible payloads, but do not become the plan state container by themselves.",
    riskIfUsedIncorrectly:
      "If used as the canonical plan object, transient chat response fields will blur plan ownership and revision handling.",
  },
  {
    structure: "StructuredAssistPlanSurface / StructuredAssistPlanStep",
    currentLocation: "client/src/components/builder/assistPlanSurface.ts",
    role: "Readable plan presentation model for the Plan companion surface.",
    ownership: "derived",
    futureDirection:
      "Map from/to PlanDraft as a user-facing presentation layer, not as execution truth.",
    riskIfUsedIncorrectly:
      "If treated as canonical, presentation-oriented fallback fields and prose-oriented shaping can corrupt executable plan semantics.",
  },
  {
    structure: "PlanMissionGraph / PlanMissionFlowNode / PlanMissionFlowEdge",
    currentLocation: "client/src/components/assist/planMissionModel.ts",
    role: "Visual Plan Canvas graph representation.",
    ownership: "visual_only",
    futureDirection:
      "Derive nodes and edges from PlanDraft steps and dependencies without owning plan business truth or runtime error content.",
    riskIfUsedIncorrectly:
      "If treated as business truth, layout geometry and visual fallback nodes will leak into execution and draft authoring.",
  },
  {
    structure: "deckRunState structuredPlan payload",
    currentLocation: "client/src/components/builder/deckRunState.ts",
    role: "Runtime continuity snapshot reconstructed from persisted deck runs.",
    ownership: "runtime_only",
    futureDirection:
      "Preserve reload continuity and runtime history, but not replace the current authoring source of truth.",
    riskIfUsedIncorrectly:
      "If reused as live authoring truth, stale run artifacts can overwrite the current draft after reload or stream recovery.",
  },
  {
    structure: "AutoGen PlanContext",
    currentLocation: "apps/python-models/app/python_models/orchestration_contracts.py",
    role: "Orchestrator context/result envelope exchanged with the AutoGen sidecar.",
    ownership: "envelope",
    futureDirection:
      "Map into and out of PlanDraft-compatible structures while remaining backend/orchestrator-facing context.",
    riskIfUsedIncorrectly:
      "If allowed to replace PlanDraft in frontend state, sidecar-specific shape drift will destabilize the workspace contract.",
  },
] as const;
