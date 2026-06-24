import type { Edge, Node } from '@xyflow/react';

import type {
  PlanStepStatus,
  StructuredAssistPlanStep,
  StructuredAssistPlanSurface,
} from '../builder/assistPlanSurface';
import type { PlanDraft } from '../../types/agentgraph';
import { GRAPH_THEME } from '../graph/graphVisualTokens';

export type PlanMissionNodeKind =
  | 'CurrentMission'
  | 'TaskLedger'
  | 'CurrentSpec'
  | 'ProgressLedger'
  | 'TaskResult'
  | 'NextSpecCandidate'
  | 'PlanRoute'
  | 'Goal'
  | 'Step'
  | 'Task'
  | 'Decision'
  | 'Assumption'
  | 'MagenticOnePlan'
  | 'RunTask'
  | 'SelectedAction'
  | 'CodeConsoleRun'
  | 'MagOneTraceEvent'
  | 'RuntimeRun'
  | 'Proof'
  | 'SkillReference'
  | 'CodeEvidenceReference'
  | 'ThinkGraphEvent'
  | 'Research'
  | 'Synthesize'
  | 'Approval'
  | 'Output'
  | 'Note'
  | 'AgentAssignment';

export type PlanMissionNodeStatus =
  | 'proposed'
  | 'approved'
  | 'seeded'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'awaiting_review'
  | 'complete'
  | 'error'
  // legacy support for any previously persisted plan states
  | 'review'
  | 'done';

export type PlanMissionNodeData = {
  label: string;
  kind: PlanMissionNodeKind;
  description?: string;
  status?: PlanMissionNodeStatus;
  updateKey?: string;
  outputKey?: string;
  assignedAgentId?: string;
  skillId?: string;
  toolIds?: string[];
  starterPrompt?: string;
  expectedOutput?: string;
  relatedFiles?: string[];
  relatedObjects?: string[];
  relatedSurface?: string;
  validationCommand?: string;
  approvalRequired?: boolean;
  resultSummary?: string;
  blocker?: string;
  source?: string;
  sourcePath?: string;
  provenance?: string;
  links?: string[];
  editable?: boolean;
  /** Concise human summary derived from the real Mag One payload. */
  summary?: string;
  /** Pretty-printed full real payload for the read-only inspector view. */
  payloadJson?: string;
  /** Verbatim real Task Ledger artifact fields, shown only in the inspector
   *  (never on the node face). Copied as-is from the AutoGen artifact — never
   *  summarized, rewritten, sanitized, or split into steps. */
  factsResponse?: string;
  planResponse?: string;
  taskLedgerResponse?: string;
  teamDescription?: string;
  /** Model-produced PlanFlow task-object fields (inspector only; node face shows
   *  the title only). Copied verbatim from the structured artifact objects — never
   *  parsed from prose. */
  detail?: string;
  stepNumber?: number;
  dependsOn?: string[];
  nextNeeded?: string;
  proofNeeded?: string;
  /** Pretty-printed single task object for the inspector "raw object" view. */
  rawTaskObject?: string;
  /** Reference to the source Task Ledger artifact node id. */
  sourceArtifactRef?: string;
  /** Unified-canvas routing (Phase 7): the Mag One bus / Magentic-One card id this
   *  task routes through, the agent cards it references as tools, and the source
   *  artifact id. Agent cards stay canonical — these are references by id only. */
  routeThrough?: string;
  assignedAgentIds?: string[];
  sourceArtifactId?: string;
  /** Number of task objects this plan/source node produced (inspector only). */
  taskCount?: number;
  /** True only for the deterministic Plan canvas "Run Task" approval node. */
  isRunTaskNode?: boolean;
  /** Whether the displayed Task Ledger is runnable (gates Run Task). */
  runnable?: boolean;
  /** Human approval action — dispatches the displayed Task Ledger. */
  onRunTask?: () => void;
  /** SWAT (Selected Work Action Tray) approval gate, attached to the selected
   *  Step node. Stages the selected step at the gate only — never executes. */
  onGoGate?: () => void;
  /** Gate status text shown in the selected node's SWAT tray (e.g. not wired). */
  goGateStatus?: string | null;
  /** Harness native Plan Draft (write_plan_draft) inspector/face fields. Copied
   *  verbatim from the structured PlanDraft — never parsed from markdown/prose.
   *  Plan steps stay draft|planned; no execution status is ever set here. */
  shortSummary?: string;
  expectedOutcome?: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
  assumptions?: string[];
  openQuestions?: string[];
  targetFlow?: string;
  targetAgent?: string;
  planState?: 'draft' | 'planned';
  /** Marks nodes projected from a PlanDraft (root vs step) so the canvas/inspector
   *  render the plan shape and suppress execution affordances for them. */
  isPlanDraftRoot?: boolean;
  isPlanDraftStep?: boolean;
};

export type PlanArtifactNodeData = {
  label: string;
  artifactType: 'image' | 'pdf';
  fileName: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
};

export type PlanFrameNodeData = {
  label: string;
  mode: 'landing' | 'edit' | 'inspect' | 'presentation' | 'workbench';
  isLanding?: boolean;
};

export type PlanSavedView = {
  id: string;
  label: string;
  viewport: { x: number; y: number; zoom: number };
  frameId?: string | null;
};

export type PlanScenePurpose =
  | 'overview'
  | 'problem'
  | 'evidence'
  | 'approach'
  | 'execution'
  | 'risk'
  | 'approval'
  | 'next-step';

export type PlanScene = {
  id: string;
  label: string;
  viewport: { x: number; y: number; zoom: number };
  frameId?: string | null;
  speakerNote?: string;
  purpose?: PlanScenePurpose;
};

export type PlanScenePathStep = {
  id: string;
  sceneId: string;
  label: string;
  order: number;
};

export type PlanScenePath = {
  id: string;
  label: string;
  sceneIds: string[];
  steps: PlanScenePathStep[];
  isDefault?: boolean;
};

export type PlanMissionFlowNode = Node<PlanMissionNodeData>;

/** Distinct ReactFlow node types for the unified-canvas task object model. The Task
 *  Ledger Artifact and task nodes are SEPARATE types from `agentCard`/`magenticBus`
 *  — tasks are never agent cards. (progressNode/proofNode/documentNode are reserved
 *  for real Progress Ledger results below the bus; not created until real data.) */
export const TASK_LEDGER_ARTIFACT_NODE_TYPE = 'taskLedgerArtifact';
export const TASK_NODE_TYPE = 'taskNode';
export function isTaskOverlayNodeType(type: string | undefined | null): boolean {
  return type === TASK_LEDGER_ARTIFACT_NODE_TYPE || type === TASK_NODE_TYPE;
}
export type PlanMissionEdgeMotion = 'idle' | 'active' | 'running';
export type PlanMissionNodeOverrideMap = Record<
  string,
  Partial<PlanMissionNodeData>
>;

/** Typed canvas edge families (unified project canvas wiring discipline). Only the
 *  V0-visible kinds are rendered; everything else is hidden by shouldRenderCanvasEdge. */
export type CanvasEdgeKind =
  | 'ledger_to_task'
  | 'task_sequence'
  | 'task_parallel_group'
  | 'task_dependency'
  // task_to_bus: the directional route from the selected/approved/running task into
  // the TOP of the Mag One bus ("this task will run through Mag One"). Contextual —
  // never shown for every task. (plan_spine/task_spine are legacy aliases.)
  | 'task_to_bus'
  | 'plan_spine'
  | 'task_spine'
  | 'task_routes_to_bus'
  | 'task_assigned_agent'
  | 'agent_bus_connection'
  | 'agent_tool_route'
  // Downstream result/proof flow (below the bus/agents) — only created when a real
  // run/result/proof artifact exists. No creation path yet (zone reserved).
  | 'run_trace'
  | 'task_result'
  | 'proof_result'
  | 'document_evidence';

/** Edge kinds rendered on the canvas in V0. The spine kinds (plan_spine/task_spine)
 *  and task_routes_to_bus are additionally gated on the source task being
 *  selected/active/running; task_assigned_agent is intentionally NOT here (proposed
 *  agents are inspector chips, not wires). run_trace/task_result/proof_result render
 *  only once a real artifact creates them (none yet — the zone is reserved). */
export const V0_VISIBLE_CANVAS_EDGE_KINDS: ReadonlySet<CanvasEdgeKind> = new Set([
  'ledger_to_task',
  'task_sequence',
  'task_parallel_group',
  'task_dependency',
  'task_to_bus',
  'plan_spine',
  'task_spine',
  'task_routes_to_bus',
  'agent_bus_connection',
]);

/** Route edge kinds that may only render when their source task is the active
 *  (selected/approved/running) task. */
const CONTEXTUAL_BUS_ROUTE_EDGE_KINDS: ReadonlySet<CanvasEdgeKind> = new Set([
  'task_to_bus',
  'plan_spine',
  'task_spine',
  'task_routes_to_bus',
]);

export type PlanMissionFlowEdgeData = {
  motion: PlanMissionEdgeMotion;
  /** Typed canvas edge family (wiring discipline). Untyped edges never render. */
  edgeKind?: CanvasEdgeKind;
  /** Marks a non-persisted task-overlay edge on the unified project canvas so the
   *  BuilderCanvas deck-persistence path drops it (never writes it to the deck). */
  __overlay?: boolean;
};

/**
 * Wiring discipline gate for task-overlay canvas edges. An edge renders only when
 * it carries a known V0-visible edge kind AND both endpoints exist. task_routes_to_bus
 * additionally requires the source task to be the selected/active task. Untyped or
 * unknown edges never render (no silent hairball).
 */
export function shouldRenderCanvasEdge(
  edge: PlanMissionFlowEdge,
  context: { nodeIds: ReadonlySet<string>; activeTaskId?: string | null },
): boolean {
  const kind = edge.data?.edgeKind;
  if (!kind) return false;
  if (!V0_VISIBLE_CANVAS_EDGE_KINDS.has(kind)) return false;
  if (!edge.source || !edge.target) return false;
  if (!context.nodeIds.has(edge.source) || !context.nodeIds.has(edge.target)) return false;
  if (CONTEXTUAL_BUS_ROUTE_EDGE_KINDS.has(kind)) {
    return Boolean(context.activeTaskId && edge.source === context.activeTaskId);
  }
  return true;
}

export type PlanMissionFlowEdge = Edge<PlanMissionFlowEdgeData>;

export type PlanMissionGraph = {
  nodes: PlanMissionFlowNode[];
  edges: PlanMissionFlowEdge[];
};

function makeNode(
  id: string,
  label: string,
  kind: PlanMissionNodeKind,
  x: number,
  y: number,
  description?: string,
  status: PlanMissionNodeStatus = 'seeded',
  updateKey?: string,
  outputKey?: string,
  assignedAgentId?: string,
  starterPrompt?: string,
  editable = true,
): PlanMissionFlowNode {
  return {
    id,
    type: 'mission',
    position: { x, y },
    data: {
      label,
      kind,
      description,
      status,
      updateKey,
      outputKey,
      assignedAgentId,
      starterPrompt,
      editable,
    },
    draggable: true,
    selectable: true,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  motion: PlanMissionEdgeMotion = 'idle',
  edgeKind?: CanvasEdgeKind,
): PlanMissionFlowEdge {
  return {
    id,
    source,
    target,
    type: 'turboFlow',
    data: {
      motion,
      ...(edgeKind ? { edgeKind } : {}),
    },
    className: 'edge-secondary',
    animated: false,
    style: {
      stroke: GRAPH_THEME.edge.neutral,
      strokeWidth: 1.45,
      opacity: 0.58,
    },
    markerEnd: 'agent-edge-circle',
  };
}

function normalizeStatusForNode(stepStatus: PlanStepStatus): PlanMissionNodeStatus {
  if (
    stepStatus === 'proposed' ||
    stepStatus === 'approved' ||
    stepStatus === 'running' ||
    stepStatus === 'blocked' ||
    stepStatus === 'done'
  ) {
    return stepStatus;
  }
  return 'proposed';
}

function inferNodeKind(step: StructuredAssistPlanStep): PlanMissionNodeKind {
  if (step.approvalRequired) return 'Approval';
  if (step.relatedFiles.length > 0 || step.relatedObjects.length > 0) return 'Task';
  if (step.expectedOutput || step.resultSummary) return 'Output';
  return 'Step';
}

function buildStepDescription(step: StructuredAssistPlanStep): string {
  const lines: string[] = [];
  if (step.expectedOutput) lines.push(`Expected: ${step.expectedOutput}`);
  if (step.relatedSurface) lines.push(`Surface: ${step.relatedSurface}`);
  if (step.relatedFiles.length > 0) {
    lines.push(`Files: ${step.relatedFiles.slice(0, 3).join(', ')}`);
  }
  if (step.validationCommand) lines.push(`Validate: ${step.validationCommand}`);
  if (step.blocker) lines.push(`Blocker: ${step.blocker}`);
  return lines.join(' ');
}

function toNodeId(step: StructuredAssistPlanStep, index: number): string {
  const stable = String(step.id || '').trim() || `step_${index + 1}`;
  const slug = stable
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `mission_${slug || `step_${index + 1}`}`;
}

export function buildPlanMissionGraph(
  structuredPlan: StructuredAssistPlanSurface,
  nodeOverrides?: PlanMissionNodeOverrideMap,
): PlanMissionGraph {
  const PLAN_X_TIGHTEN_ORIGIN = 56;
  const PLAN_X_TIGHTEN_RATIO = 0.9;
  // Only explicit, real structured steps render. No fallback/inferred nodes are
  // built from nextMove or any other free-text source; an empty plan stays empty.
  const planSteps: StructuredAssistPlanStep[] = Array.isArray(structuredPlan.steps)
    ? structuredPlan.steps
    : [];

  if (planSteps.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: PlanMissionFlowNode[] = [];

  const STEP_BASE_X = 296;
  const STEP_DELTA_X = 244;
  const STEP_BASE_Y = 136;
  planSteps.forEach((step, index) => {
    const nodeId = toNodeId(step, index);
    const node = makeNode(
      nodeId,
      step.title,
      inferNodeKind(step),
      STEP_BASE_X + index * STEP_DELTA_X,
      STEP_BASE_Y,
      buildStepDescription(step),
      normalizeStatusForNode(step.status),
      step.id || `step_${index + 1}`,
      `step_${index + 1}_output`,
      step.assignedAgentId || undefined,
      step.generatedPrompt || undefined,
      true,
    );
    node.data = {
      ...node.data,
      skillId: step.skillId || undefined,
      toolIds: step.toolIds,
      expectedOutput: step.expectedOutput,
      relatedFiles: step.relatedFiles,
      relatedObjects: step.relatedObjects,
      relatedSurface: step.relatedSurface || undefined,
      validationCommand: step.validationCommand || undefined,
      approvalRequired: step.approvalRequired,
      resultSummary: step.resultSummary,
      blocker: step.blocker,
    };
    nodes.push(node);
  });

  const edges: PlanMissionFlowEdge[] = [];
  for (let index = 0; index < planSteps.length - 1; index += 1) {
    const sourceStep = planSteps[index];
    const targetStep = planSteps[index + 1];
    edges.push(
      makeEdge(
        `edge_step_${index + 1}_to_${index + 2}`,
        toNodeId(sourceStep, index),
        toNodeId(targetStep, index + 1),
        sourceStep.status === 'running' ? 'running' : 'idle',
      ),
    );
  }

  const mergedNodes =
    nodeOverrides && Object.keys(nodeOverrides).length > 0
      ? nodes.map((node) => {
          const override = nodeOverrides[node.id];
          if (!override) return node;
          return {
            ...node,
            data: {
              ...node.data,
              ...override,
            },
          };
        })
      : nodes;

  const tightenedNodes = mergedNodes.map((node) => ({
    ...node,
    position: {
      ...node.position,
      x: Math.round(
        PLAN_X_TIGHTEN_ORIGIN +
          (node.position.x - PLAN_X_TIGHTEN_ORIGIN) * PLAN_X_TIGHTEN_RATIO,
      ),
    },
  }));

  return { nodes: tightenedNodes, edges };
}

/**
 * Build one honest viewer node from a real AutoGen / Magentic-One Task Ledger
 * artifact. This does NOT parse the Task Ledger prose into steps, does not strip
 * agent names, and does not rewrite team composition — it preserves the raw
 * artifact verbatim in the node payload. If no artifact is provided, the graph
 * is empty (no placeholder/fallback node is ever invented).
 */
export function buildTaskLedgerArtifactGraph(
  taskLedgerArtifact: Record<string, unknown> | null | undefined,
): PlanMissionGraph {
  if (
    !taskLedgerArtifact ||
    typeof taskLedgerArtifact !== 'object' ||
    Array.isArray(taskLedgerArtifact)
  ) {
    return { nodes: [], edges: [] };
  }
  const artifact = taskLedgerArtifact as Record<string, unknown>;
  const source = String(artifact.source || '').trim();
  const phase = String(artifact.phase || '').trim();
  // Verbatim artifact text fields for the inspector. Copied as-is (a missing field
  // stays an empty string -> the inspector renders "missing"); never rewritten.
  const verbatim = (key: string): string =>
    typeof artifact[key] === 'string' ? (artifact[key] as string) : '';
  let payloadJson = '';
  try {
    payloadJson = JSON.stringify(artifact, null, 2);
  } catch {
    payloadJson = '';
  }
  const node: PlanMissionFlowNode = {
    id: 'task_ledger_artifact',
    type: TASK_LEDGER_ARTIFACT_NODE_TYPE,
    position: { x: 296, y: 136 },
    data: {
      // User-facing plan/source node — NOT the internal "Task Ledger Artifact"
      // wording. The face shows only this short label; the real artifact fields
      // (facts/plan/full ledger, raw payload) stay in data for the inspector.
      label: 'Plan',
      kind: 'TaskLedger',
      status: 'seeded',
      source: source || undefined,
      provenance: phase || undefined,
      factsResponse: verbatim('factsResponse'),
      planResponse: verbatim('planResponse'),
      taskLedgerResponse: verbatim('taskLedgerResponse'),
      teamDescription: verbatim('teamDescription'),
      payloadJson: payloadJson || undefined,
      editable: false,
    },
    draggable: true,
    selectable: true,
  };

  const nodes: PlanMissionFlowNode[] = [node];
  const edges: PlanMissionFlowEdge[] = [];

  // Task nodes render ONLY from the explicit model-produced structured artifact
  // (taskLedgerArtifact.planFlowTaskObjects). Never from planResponse /
  // taskLedgerResponse / factsResponse prose, finalResponseText, autogenMessages,
  // or any parsed/bullet text. Missing/empty/invalid -> only the Task Ledger
  // Artifact node renders. No fallback nodes are ever invented.
  const rawTaskObjects = Array.isArray(artifact.planFlowTaskObjects)
    ? (artifact.planFlowTaskObjects as unknown[])
    : [];

  const KNOWN_STATUSES: PlanMissionNodeStatus[] = [
    'proposed',
    'approved',
    'seeded',
    'ready',
    'running',
    'blocked',
    'awaiting_review',
    'complete',
    'error',
    'review',
    'done',
  ];
  const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
  const asStringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const coerceStatus = (value: unknown): PlanMissionNodeStatus => {
    const candidate = asString(value).trim();
    return (KNOWN_STATUSES as string[]).includes(candidate)
      ? (candidate as PlanMissionNodeStatus)
      : 'proposed';
  };

  const TASK_BASE_X = 296;
  const TASK_DELTA_X = 260;
  const TASK_Y = 340;
  const taskEntries: Array<{
    nodeId: string;
    slug: string;
    dependsOn: string[];
    stepNumber: number;
  }> = [];
  rawTaskObjects.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const obj = raw as Record<string, unknown>;
    const title = asString(obj.title).trim();
    // A structured object with no title has nothing to render on the face — skip
    // it rather than invent a placeholder.
    if (!title) return;
    const stableId = asString(obj.id).trim() || `task_${index + 1}`;
    const slug =
      stableId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
      `task_${index + 1}`;
    const nodeId = `planflow_task_${slug}`;
    const stepNumber =
      typeof obj.stepNumber === 'number' && Number.isFinite(obj.stepNumber)
        ? obj.stepNumber
        : undefined;
    let rawTaskObject = '';
    try {
      rawTaskObject = JSON.stringify(obj, null, 2);
    } catch {
      rawTaskObject = '';
    }
    const taskNode: PlanMissionFlowNode = {
      id: nodeId,
      type: TASK_NODE_TYPE,
      position: { x: TASK_BASE_X + index * TASK_DELTA_X, y: TASK_Y },
      data: {
        // Node face shows the title only. Everything else is inspector-only data.
        label: title,
        kind: 'Task',
        status: coerceStatus(obj.status),
        detail: asString(obj.detail).trim() || undefined,
        stepNumber,
        dependsOn: asStringList(obj.dependsOn),
        approvalRequired: obj.approvalRequired === true,
        nextNeeded: asString(obj.nextNeeded).trim() || undefined,
        proofNeeded: asString(obj.proofNeeded).trim() || undefined,
        rawTaskObject: rawTaskObject || undefined,
        sourceArtifactRef: 'task_ledger_artifact',
        sourceArtifactId: 'task_ledger_artifact',
        assignedAgentIds: [],
        links: ['task_ledger_artifact'],
        editable: false,
      },
      draggable: true,
      selectable: true,
    };
    nodes.push(taskNode);
    taskEntries.push({
      nodeId,
      slug,
      dependsOn: asStringList(obj.dependsOn),
      stepNumber: typeof stepNumber === 'number' ? stepNumber : index + 1,
    });
  });

  // Wiring discipline: build a readable task work-graph using ONLY typed edges.
  // task_dependency comes from explicit dependsOn (never inferred from prose/title);
  // otherwise task_sequence comes from the explicit stepNumber order. The Task
  // Ledger Artifact connects (ledger_to_task) only to root tasks so its wires stay
  // local instead of fanning across the whole cluster. No task->bus wires here —
  // routing to the Mag One bus is contextual and added at the canvas layer.
  const taskNodeIdBySlug = new Map(taskEntries.map((entry) => [entry.slug, entry.nodeId] as const));
  const hasIncoming = new Set<string>();
  const anyDependsOn = taskEntries.some((entry) => entry.dependsOn.length > 0);
  if (anyDependsOn) {
    taskEntries.forEach((entry) => {
      entry.dependsOn.forEach((depRaw) => {
        const depSlug = depRaw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const depNodeId = taskNodeIdBySlug.get(depSlug);
        if (depNodeId && depNodeId !== entry.nodeId) {
          edges.push(
            makeEdge(
              `task_dep_${depNodeId}__${entry.nodeId}`,
              depNodeId,
              entry.nodeId,
              'idle',
              'task_dependency',
            ),
          );
          hasIncoming.add(entry.nodeId);
        }
      });
    });
  } else if (taskEntries.length > 1) {
    const ordered = [...taskEntries].sort((a, b) => a.stepNumber - b.stepNumber);
    for (let i = 1; i < ordered.length; i += 1) {
      edges.push(
        makeEdge(
          `task_seq_${ordered[i - 1].nodeId}__${ordered[i].nodeId}`,
          ordered[i - 1].nodeId,
          ordered[i].nodeId,
          'idle',
          'task_sequence',
        ),
      );
      hasIncoming.add(ordered[i].nodeId);
    }
  }
  taskEntries.forEach((entry) => {
    if (!hasIncoming.has(entry.nodeId)) {
      edges.push(
        makeEdge(
          `edge_ledger_to_${entry.nodeId}`,
          'task_ledger_artifact',
          entry.nodeId,
          'idle',
          'ledger_to_task',
        ),
      );
    }
  });

  // Record the produced task count on the plan/source node for its inspector.
  node.data.taskCount = nodes.length - 1;

  return { nodes, edges };
}

/**
 * Project a deliberate Harness Plan Draft (write_plan_draft) into the existing
 * PlanFlow-compatible node model: one Plan root node + compact draft/planned step
 * nodes, reusing the same node types and rendering as the Task Ledger projection.
 *
 * The PlanDraft is the SOLE structured source — fields are copied verbatim from the
 * structured artifact, never parsed from the markdown plan narrative, never from
 * TodoWrite, and never inferred. Dependency edges appear ONLY from explicit
 * step.dependencies; otherwise the root frames each step (ledger_to_task). No
 * sequence inference, no execution state, no run wires.
 */
export function buildPlanDraftGraph(
  planDraft: PlanDraft | null | undefined,
): PlanMissionGraph {
  if (!planDraft || typeof planDraft !== 'object' || Array.isArray(planDraft)) {
    return { nodes: [], edges: [] };
  }
  const steps = Array.isArray(planDraft.steps) ? planDraft.steps : [];
  const objective = String(planDraft.objective || '').trim();
  const summary = String(planDraft.summary || '').trim();
  if (!objective && steps.length === 0) return { nodes: [], edges: [] };

  const asList = (value: unknown): string[] | undefined => {
    const list = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    return list.length ? list : undefined;
  };
  let payloadJson = '';
  try {
    payloadJson = JSON.stringify(planDraft, null, 2);
  } catch {
    payloadJson = '';
  }

  const ROOT_ID = 'plan_draft_root';
  const rootNode: PlanMissionFlowNode = {
    id: ROOT_ID,
    type: TASK_LEDGER_ARTIFACT_NODE_TYPE,
    position: { x: 296, y: 136 },
    data: {
      label: objective || 'Plan',
      kind: 'TaskLedger',
      status: 'seeded',
      summary: summary || undefined,
      description: summary || undefined,
      detail: objective || undefined,
      planResponse: summary || undefined,
      taskCount: steps.length,
      assumptions: asList(planDraft.assumptions),
      openQuestions: asList(planDraft.openQuestions),
      constraints: asList(planDraft.constraints),
      acceptanceCriteria: asList(planDraft.acceptanceCriteria),
      source: planDraft.source || 'harness_native_plan',
      payloadJson: payloadJson || undefined,
      isPlanDraftRoot: true,
      editable: false,
    },
    draggable: true,
    selectable: true,
  };

  const nodes: PlanMissionFlowNode[] = [rootNode];
  const edges: PlanMissionFlowEdge[] = [];

  const STEP_BASE_X = 296;
  const STEP_DELTA_X = 260;
  const STEP_Y = 340;
  const idToNodeId = new Map<string, string>();
  const stepEntries: Array<{ nodeId: string; dependencies: string[] }> = [];

  steps.forEach((step, index) => {
    const stableId = String(step.id || '').trim() || `step_${index + 1}`;
    const slug =
      stableId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
      `step_${index + 1}`;
    const nodeId = `plan_step_${slug}`;
    idToNodeId.set(stableId.toLowerCase(), nodeId);
    const planState: 'draft' | 'planned' = step.state === 'planned' ? 'planned' : 'draft';
    const shortTitle = String(step.shortTitle || '').trim() || `Step ${index + 1}`;
    const shortSummary = String(step.shortSummary || '').trim();
    const stepNode: PlanMissionFlowNode = {
      id: nodeId,
      type: TASK_NODE_TYPE,
      position: { x: STEP_BASE_X + index * STEP_DELTA_X, y: STEP_Y },
      data: {
        // Face = shortTitle (+ a real shortSummary subtitle, plan-draft only).
        label: shortTitle,
        kind: 'Step',
        // Plan steps never carry execution status — a neutral non-running status
        // for shell styling; the real lifecycle is planState (draft|planned).
        status: 'proposed',
        planState,
        isPlanDraftStep: true,
        shortSummary: shortSummary || undefined,
        description: shortSummary || undefined,
        detail: String(step.detail || '').trim() || undefined,
        expectedOutcome: String(step.expectedOutcome || '').trim() || undefined,
        dependsOn: asList(step.dependencies),
        constraints: asList(step.constraints),
        acceptanceCriteria: asList(step.acceptanceCriteria),
        targetFlow: String(step.targetFlow || '').trim() || undefined,
        targetAgent: String(step.targetAgent || '').trim() || undefined,
        stepNumber: index + 1,
        sourceArtifactRef: ROOT_ID,
        sourceArtifactId: ROOT_ID,
        links: [ROOT_ID],
        editable: false,
      },
      draggable: true,
      selectable: true,
    };
    nodes.push(stepNode);
    stepEntries.push({
      nodeId,
      dependencies: Array.isArray(step.dependencies)
        ? step.dependencies.map((d) => String(d).toLowerCase().trim()).filter(Boolean)
        : [],
    });
  });

  // Dependency edges ONLY from explicit dependencies (never inferred/sequenced).
  const hasIncoming = new Set<string>();
  stepEntries.forEach((entry) => {
    entry.dependencies.forEach((dep) => {
      const depSlug = dep.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const depNodeId = idToNodeId.get(dep) || idToNodeId.get(depSlug);
      if (depNodeId && depNodeId !== entry.nodeId) {
        edges.push(
          makeEdge(`plan_dep_${depNodeId}__${entry.nodeId}`, depNodeId, entry.nodeId, 'idle', 'task_dependency'),
        );
        hasIncoming.add(entry.nodeId);
      }
    });
  });
  // The Plan root frames steps that have no explicit dependency (ledger_to_task).
  stepEntries.forEach((entry) => {
    if (!hasIncoming.has(entry.nodeId)) {
      edges.push(
        makeEdge(`plan_root_to_${entry.nodeId}`, ROOT_ID, entry.nodeId, 'idle', 'ledger_to_task'),
      );
    }
  });

  return { nodes, edges };
}
