import type {
  ChatPlanDraftResult,
  MissionSpec,
} from "../../../types/agentgraph";
import type {
  StructuredAssistPlanStep,
  StructuredAssistPlanSurface,
} from "../../../components/builder/assistPlanSurface";
import {
  buildPlanMissionGraph,
  type PlanMissionFlowEdge,
  type PlanMissionFlowNode,
  type PlanMissionGraph,
} from "../../../components/assist/planMissionModel";
import type {
  PlanDraft,
  PlanDraftApprovalState,
  PlanDraftEdge,
  PlanDraftGraphWriteTarget,
  PlanDraftSource,
  PlanDraftStep,
  PlanDraftStepStatus,
} from "./planDraftTypes";
import {
  missionRunStateToPlanDraftApprovalState,
  planDraftStatusToApprovalState,
} from "./planDraftTypes";

type PlanDraftMappingOptions = {
  projectId?: string | null;
  chatReply?: string | null;
  revision?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  source?: PlanDraftSource;
};

type ChatPlanDraftResultMappingOptions = PlanDraftMappingOptions & {
  currentMissionSpec?: MissionSpec | null;
};

function safeText(value: unknown): string {
  return String(value || "").trim();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const normalized = safeText(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function createDraftId(prefix: string, fallback = "draft"): string {
  const normalized = safeText(prefix).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return normalized ? `${normalized}_draft` : fallback;
}

function inferStepStatus(value: unknown): PlanDraftStepStatus {
  const normalized = safeText(value).toLowerCase();
  switch (normalized) {
    case "approved":
    case "review":
    case "awaiting_review":
      return "approved";
    case "running":
      return "running";
    case "blocked":
    case "error":
      return "blocked";
    case "done":
    case "complete":
      return "done";
    case "ready":
    case "seeded":
    case "proposed":
    default:
      return "proposed";
  }
}

function inferGraphWriteTargets(
  values: Array<unknown>,
  assignedAgent?: string | null,
): PlanDraftGraphWriteTarget[] {
  const joined = values.map((value) => safeText(value).toLowerCase()).join(" ");
  const targets = new Set<PlanDraftGraphWriteTarget>();
  const normalizedAgent = safeText(assignedAgent).toLowerCase();

  if (
    normalizedAgent.includes("thinkgraph") ||
    /\bthinkgraph\b/.test(joined)
  ) {
    targets.add("ThinkGraph");
  }
  if (
    normalizedAgent.includes("knowgraph") ||
    normalizedAgent.includes("research") ||
    /\bknowgraph\b/.test(joined) ||
    /\bevidence\b/.test(joined) ||
    /\bsource\b/.test(joined)
  ) {
    targets.add("KnowGraph");
  }
  if (
    normalizedAgent.includes("codegraph") ||
    normalizedAgent.includes("local_coder") ||
    /\bcodegraph\b/.test(joined) ||
    /\bcode\b/.test(joined) ||
    /\bsymbol\b/.test(joined)
  ) {
    targets.add("CodeGraph");
  }

  return [...targets];
}

function buildDraftSummary(goal: string, steps: PlanDraftStep[], fallback: string): string {
  const explicitGoal = safeText(goal);
  if (explicitGoal) return explicitGoal;
  if (steps.length > 0) {
    return steps
      .slice(0, 3)
      .map((step, index) => `${index + 1}. ${step.title}`)
      .join(" ");
  }
  return fallback;
}

function buildDraftEdgesFromOrderedSteps(steps: PlanDraftStep[]): PlanDraftEdge[] {
  const edges: PlanDraftEdge[] = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    edges.push({
      fromStepId: steps[index].id,
      toStepId: steps[index + 1].id,
      kind: "sequence",
    });
  }
  return edges;
}

function buildAggregateFields(steps: PlanDraftStep[]): Pick<
  PlanDraft,
  "requiredAgents" | "requiredTools" | "expectedOutputs" | "graphWriteTargets" | "risks"
> {
  return {
    requiredAgents: uniqueStrings(steps.map((step) => step.assignedAgent)),
    requiredTools: uniqueStrings(steps.flatMap((step) => step.requiredTools)),
    expectedOutputs: uniqueStrings(steps.map((step) => step.expectedOutput)),
    graphWriteTargets: uniqueStrings(
      steps.flatMap((step) => step.graphWriteTargets),
    ) as PlanDraftGraphWriteTarget[],
    risks: uniqueStrings(
      steps
        .filter((step) => step.status === "blocked")
        .map((step) => step.description || step.title),
    ),
  };
}

function buildPlanDraft(
  input: {
    missionId: string;
    projectId?: string | null;
    source: PlanDraftSource;
    userRequest: string;
    chatReply?: string | null;
    summary: string;
    approvalState: PlanDraftApprovalState;
    revision?: number;
    createdAt?: string | null;
    updatedAt?: string | null;
    steps: PlanDraftStep[];
    edges: PlanDraftEdge[];
  },
): PlanDraft {
  const aggregate = buildAggregateFields(input.steps);
  return {
    missionId: input.missionId,
    projectId: input.projectId ?? null,
    source: input.source,
    userRequest: input.userRequest,
    chatReply: input.chatReply ?? null,
    summary: input.summary,
    approvalState: input.approvalState,
    revision: input.revision ?? 1,
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
    requiredAgents: aggregate.requiredAgents,
    requiredTools: aggregate.requiredTools,
    expectedOutputs: aggregate.expectedOutputs,
    risks: aggregate.risks,
    graphWriteTargets: aggregate.graphWriteTargets,
    steps: input.steps,
    edges: input.edges,
  };
}

function missionAgentRunToPlanDraftStep(
  run: MissionSpec["agentRuns"][number],
  index: number,
): PlanDraftStep {
  const stepId = safeText(run.id) || `step_${index + 1}`;
  const assignedAgent = safeText(run.agentId) || null;
  return {
    id: stepId,
    title: assignedAgent ? assignedAgent.replace(/_/g, " ") : `Step ${index + 1}`,
    description: safeText(run.promptSeed),
    assignedAgent,
    required: run.required !== false,
    requiredTools: [],
    inputs: [],
    expectedOutput: "",
    status: "proposed",
    dependsOn: index > 0 ? [safeText(run.id ? `step_${index}` : `step_${index}`)] : [],
    graphWriteTargets: inferGraphWriteTargets([run.promptSeed], assignedAgent),
  };
}

function structuredStepToPlanDraftStep(
  step: StructuredAssistPlanStep,
  index: number,
  dependsOn: string[],
): PlanDraftStep {
  return {
    id: safeText(step.id) || `step_${index + 1}`,
    title: safeText(step.title) || `Step ${index + 1}`,
    description: safeText(step.generatedPrompt || step.blocker || ""),
    assignedAgent: safeText(step.assignedAgentId) || null,
    required: step.approvalRequired !== false,
    requiredTools: uniqueStrings(step.toolIds),
    inputs: uniqueStrings([
      ...step.relatedFiles,
      ...step.relatedObjects,
      step.relatedSurface,
    ]),
    expectedOutput: safeText(step.expectedOutput || step.resultSummary || ""),
    status: inferStepStatus(step.status),
    dependsOn,
    graphWriteTargets: inferGraphWriteTargets(
      [
        step.expectedOutput,
        step.resultSummary,
        step.relatedSurface,
        ...step.relatedFiles,
        ...step.relatedObjects,
      ],
      step.assignedAgentId,
    ),
  };
}

function topologicalNodeIds(
  nodes: PlanMissionFlowNode[],
  edges: PlanMissionFlowEdge[],
): string[] {
  const nodeIds = nodes.map((node) => node.id);
  const incoming = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));

  edges.forEach((edge) => {
    if (!incoming.has(edge.target) || !outgoing.has(edge.source)) return;
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const queue = nodeIds.filter((id) => (incoming.get(id) || 0) === 0);
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    ordered.push(current);
    (outgoing.get(current) || []).forEach((target) => {
      const nextCount = (incoming.get(target) || 0) - 1;
      incoming.set(target, nextCount);
      if (nextCount === 0) queue.push(target);
    });
  }

  return ordered.length === nodeIds.length ? ordered : nodeIds;
}

export function missionSpecToPlanDraft(
  missionSpec: MissionSpec,
  options: PlanDraftMappingOptions = {},
): PlanDraft {
  const steps = missionSpec.agentRuns.map((run, index) =>
    missionAgentRunToPlanDraftStep(run, index),
  );
  const edges = buildDraftEdgesFromOrderedSteps(steps);
  steps.forEach((step, index) => {
    step.dependsOn = index > 0 ? [steps[index - 1].id] : [];
  });

  return buildPlanDraft({
    missionId: safeText(missionSpec.id) || createDraftId(missionSpec.title),
    projectId: options.projectId ?? null,
    source: options.source || "mission_spec",
    userRequest: safeText(missionSpec.userGoal),
    chatReply: options.chatReply ?? null,
    summary: buildDraftSummary(missionSpec.title, steps, "Mission draft"),
    approvalState: missionRunStateToPlanDraftApprovalState(missionSpec.runState),
    revision: options.revision ?? 1,
    createdAt: options.createdAt ?? null,
    updatedAt: options.updatedAt ?? null,
    steps,
    edges,
  });
}

export function structuredAssistPlanSurfaceToPlanDraft(
  structuredPlan: StructuredAssistPlanSurface,
  options: PlanDraftMappingOptions = {},
): PlanDraft {
  const sourceSteps =
    structuredPlan.steps.length > 0
      ? structuredPlan.steps
      : structuredPlan.nextMove.map((title, index) => ({
          id: `next_move_${index + 1}`,
          title,
          status: "proposed" as const,
          assignedAgentId: null,
          skillId: null,
          toolIds: [],
          generatedPrompt: "",
          expectedOutput: "",
          relatedFiles: [],
          relatedObjects: [],
          relatedSurface: null,
          validationCommand: null,
          approvalRequired: true,
          resultSummary: "",
          blocker: "",
        }));

  const steps = sourceSteps.map((step, index) =>
    structuredStepToPlanDraftStep(
      step,
      index,
      index > 0 ? [safeText(sourceSteps[index - 1].id) || `step_${index}`] : [],
    ),
  );
  const edges = buildDraftEdgesFromOrderedSteps(steps);

  return buildPlanDraft({
    missionId: createDraftId(structuredPlan.goal || structuredPlan.explicitPlanText || "plan"),
    projectId: options.projectId ?? null,
    source: options.source || "structured_assist_plan_surface",
    userRequest: safeText(structuredPlan.goal || structuredPlan.explicitPlanText),
    chatReply: options.chatReply ?? null,
    summary: buildDraftSummary(
      structuredPlan.goal || structuredPlan.explicitPlanText,
      steps,
      "Plan draft",
    ),
    approvalState: "draft",
    revision: options.revision ?? 1,
    createdAt: options.createdAt ?? null,
    updatedAt: options.updatedAt ?? null,
    steps,
    edges,
  });
}

export function planMissionGraphToPlanDraft(
  missionGraph: PlanMissionGraph,
  options: PlanDraftMappingOptions = {},
): PlanDraft {
  const nodeMap = new Map(missionGraph.nodes.map((node) => [node.id, node] as const));
  const incomingByNode = new Map<string, string[]>(
    missionGraph.nodes.map((node) => [node.id, [] as string[]]),
  );

  missionGraph.edges.forEach((edge) => {
    if (!incomingByNode.has(edge.target)) return;
    incomingByNode.get(edge.target)?.push(edge.source);
  });

  const orderedIds = topologicalNodeIds(missionGraph.nodes, missionGraph.edges);
  const steps = orderedIds
    .map((nodeId, index) => {
      const node = nodeMap.get(nodeId);
      if (!node) return null;
      const data = node.data || {};
      return {
        id: node.id,
        title: safeText(data.label) || `Step ${index + 1}`,
        description: safeText(data.description),
        assignedAgent: safeText(data.assignedAgentId) || null,
        required: data.approvalRequired !== false,
        requiredTools: Array.isArray(data.toolIds)
          ? data.toolIds.map((toolId) => safeText(toolId)).filter(Boolean)
          : [],
        inputs: uniqueStrings([
          ...(Array.isArray(data.relatedFiles) ? data.relatedFiles : []),
          ...(Array.isArray(data.relatedObjects) ? data.relatedObjects : []),
          safeText(data.relatedSurface),
        ]),
        expectedOutput: safeText(data.expectedOutput || data.outputKey),
        status: inferStepStatus(data.status),
        dependsOn: incomingByNode.get(node.id) || [],
        graphWriteTargets: inferGraphWriteTargets(
          [
            data.expectedOutput,
            data.resultSummary,
            data.relatedSurface,
            ...(Array.isArray(data.relatedFiles) ? data.relatedFiles : []),
            ...(Array.isArray(data.relatedObjects) ? data.relatedObjects : []),
          ],
          safeText(data.assignedAgentId),
        ),
      } satisfies PlanDraftStep;
    })
    .filter((step): step is PlanDraftStep => Boolean(step));

  const edges: PlanDraftEdge[] = missionGraph.edges.map((edge) => ({
    fromStepId: edge.source,
    toStepId: edge.target,
    kind: "dependency",
  }));

  return buildPlanDraft({
    missionId: createDraftId(steps[0]?.title || "mission_graph"),
    projectId: options.projectId ?? null,
    source: options.source || "plan_mission_graph",
    userRequest: options.chatReply ?? "",
    chatReply: options.chatReply ?? null,
    summary: buildDraftSummary("", steps, "Mission graph draft"),
    approvalState: "draft",
    revision: options.revision ?? 1,
    createdAt: options.createdAt ?? null,
    updatedAt: options.updatedAt ?? null,
    steps,
    edges,
  });
}

export function chatPlanDraftResultToPlanDraft(
  result: ChatPlanDraftResult,
  options: ChatPlanDraftResultMappingOptions = {},
): PlanDraft | null {
  if (result.missionSpec) {
    return missionSpecToPlanDraft(result.missionSpec, {
      ...options,
      chatReply: options.chatReply ?? result.chatReply ?? null,
      source: "chat_plan_draft_result",
    });
  }

  if (result.missionSpecPatch && options.currentMissionSpec) {
    return missionSpecToPlanDraft(
      {
        ...options.currentMissionSpec,
        ...result.missionSpecPatch,
        agentRuns:
          result.missionSpecPatch.agentRuns || options.currentMissionSpec.agentRuns,
      },
      {
        ...options,
        chatReply: options.chatReply ?? result.chatReply ?? null,
        source: "chat_plan_draft_result",
      },
    );
  }

  const summary = safeText(result.summary);
  if (!summary) return null;

  return buildPlanDraft({
    missionId: createDraftId(summary),
    projectId: options.projectId ?? null,
    source: options.source || "chat_plan_draft_result",
    userRequest: summary,
    chatReply: options.chatReply ?? result.chatReply ?? null,
    summary,
    approvalState: planDraftStatusToApprovalState(result.status),
    revision: options.revision ?? 1,
    createdAt: options.createdAt ?? null,
    updatedAt: options.updatedAt ?? null,
    steps: [],
    edges: [],
  });
}

export function planDraftToMissionSpec(planDraft: PlanDraft): MissionSpec {
  return {
    id: safeText(planDraft.missionId) || createDraftId(planDraft.summary || planDraft.userRequest),
    title: safeText(planDraft.summary) || safeText(planDraft.userRequest) || "Plan Draft",
    userGoal: safeText(planDraft.userRequest) || safeText(planDraft.summary),
    target: safeText(planDraft.projectId) || "agentbuilder_deck",
    readContext: [],
    runState:
      planDraft.approvalState === "approved"
        ? "approved"
        : planDraft.approvalState === "running"
          ? "running"
          : planDraft.approvalState === "complete"
            ? "complete"
            : planDraft.approvalState === "failed"
              ? "failed"
              : "draft",
    agentRuns: planDraft.steps
      .filter((step) => safeText(step.assignedAgent))
      .map((step) => ({
        id: step.id,
        agentId: safeText(step.assignedAgent),
        promptSeed: safeText(step.description || step.title),
        required: step.required,
      })),
  };
}

export function planDraftToStructuredAssistPlanSurface(
  planDraft: PlanDraft,
): StructuredAssistPlanSurface {
  return {
    planMode: planDraft.approvalState === "approved" ? "approved" : "draft",
    goal: safeText(planDraft.userRequest),
    steps: planDraft.steps.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      assignedAgentId: step.assignedAgent,
      skillId: null,
      toolIds: step.requiredTools,
      generatedPrompt: step.description,
      expectedOutput: step.expectedOutput,
      relatedFiles: [],
      relatedObjects: step.inputs,
      relatedSurface: null,
      validationCommand: null,
      approvalRequired: step.required,
      resultSummary: "",
      blocker: step.status === "blocked" ? step.description : "",
    })),
    whatMattersNow: [],
    nextMove: planDraft.steps.map((step) => step.title),
    assumptions: [],
    research: [],
    openQuestions: [],
    humanTasks: [],
    agentTasks: [],
    pathOptions: [],
    explicitPlanText: safeText(planDraft.summary),
    hasExplicitPlanDocument: false,
    whatChanged: [],
    sources: [],
  };
}

export function planDraftToPlanMissionGraph(planDraft: PlanDraft): PlanMissionGraph {
  return buildPlanMissionGraph(planDraftToStructuredAssistPlanSurface(planDraft));
}
