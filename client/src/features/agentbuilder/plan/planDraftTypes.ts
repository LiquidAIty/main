import type { MissionSpecRunState, PlanDraftStatus } from "../../../types/agentgraph";

export type PlanDraftApprovalState =
  | "draft"
  | "approved"
  | "rejected"
  | "running"
  | "complete"
  | "failed";

export type PlanDraftGraphWriteTarget =
  | "ThinkGraph"
  | "KnowGraph"
  | "CodeGraph";

export type PlanDraftSource =
  | "mission_spec"
  | "structured_assist_plan_surface"
  | "plan_mission_graph"
  | "chat_plan_draft_result"
  | "hybrid";

export type PlanDraftStepStatus =
  | "proposed"
  | "approved"
  | "running"
  | "blocked"
  | "done";

export type PlanDraftEdge = {
  fromStepId: string;
  toStepId: string;
  kind: "sequence" | "dependency";
};

export type PlanDraftStep = {
  id: string;
  title: string;
  description: string;
  assignedAgent: string | null;
  required: boolean;
  requiredTools: string[];
  inputs: string[];
  expectedOutput: string;
  status: PlanDraftStepStatus;
  dependsOn: string[];
  graphWriteTargets: PlanDraftGraphWriteTarget[];
};

export type PlanDraft = {
  missionId: string;
  projectId: string | null;
  source: PlanDraftSource;
  userRequest: string;
  chatReply: string | null;
  summary: string;
  approvalState: PlanDraftApprovalState;
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
  requiredAgents: string[];
  requiredTools: string[];
  expectedOutputs: string[];
  risks: string[];
  graphWriteTargets: PlanDraftGraphWriteTarget[];
  steps: PlanDraftStep[];
  edges: PlanDraftEdge[];
};

export function missionRunStateToPlanDraftApprovalState(
  runState: MissionSpecRunState | null | undefined,
): PlanDraftApprovalState {
  switch (runState) {
    case "approved":
      return "approved";
    case "running":
    case "wiring":
    case "needs_user_input":
      return "running";
    case "complete":
      return "complete";
    case "failed":
    case "cancelled":
      return "failed";
    case "draft":
    default:
      return "draft";
  }
}

export function planDraftStatusToApprovalState(
  status: PlanDraftStatus | null | undefined,
): PlanDraftApprovalState {
  switch (status) {
    case "failed":
      return "failed";
    case "ready":
    case "drafting":
    case "needs_user_input":
    case "idle":
    default:
      return "draft";
  }
}
