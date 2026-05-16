import type { Edge, Node } from '@xyflow/react';

import type {
  PlanStepStatus,
  StructuredAssistPlanStep,
  StructuredAssistPlanSurface,
} from '../builder/assistPlanSurface';
import { GRAPH_THEME } from '../graph/graphVisualTokens';

export type PlanMissionNodeKind =
  | 'Goal'
  | 'Step'
  | 'Task'
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
  editable?: boolean;
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
export type PlanMissionEdgeMotion = 'idle' | 'active' | 'running';
export type PlanMissionNodeOverrideMap = Record<
  string,
  Partial<PlanMissionNodeData>
>;

export type PlanMissionFlowEdgeData = {
  motion: PlanMissionEdgeMotion;
};

export type PlanMissionFlowEdge = Edge<PlanMissionFlowEdgeData>;

export type PlanMissionGraph = {
  nodes: PlanMissionFlowNode[];
  edges: PlanMissionFlowEdge[];
};

function cleanList(input: string[] | null | undefined): string[] {
  return (Array.isArray(input) ? input : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

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
): PlanMissionFlowEdge {
  return {
    id,
    source,
    target,
    type: 'turboFlow',
    data: {
      motion,
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

function pickFirst(
  items: string[] | null | undefined,
  fallback: string,
): string {
  const first = cleanList(items)[0];
  return first || fallback;
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
  const goalText =
    String(structuredPlan.goal || '').trim() ||
    'Define the implementation intent before any execution.';
  const modeText = String(structuredPlan.planMode || 'draft')
    .trim()
    .toLowerCase();
  const baseSteps: StructuredAssistPlanStep[] =
    Array.isArray(structuredPlan.steps) && structuredPlan.steps.length > 0
      ? structuredPlan.steps
      : cleanList(structuredPlan.nextMove).map((title, index) => ({
          id: `fallback_step_${index + 1}`,
          title,
          status: 'proposed' as const,
          assignedAgentId: null,
          skillId: null,
          toolIds: [],
          generatedPrompt: '',
          expectedOutput: '',
          relatedFiles: [],
          relatedObjects: [],
          relatedSurface: null,
          validationCommand: null,
          approvalRequired: true,
          resultSummary: '',
          blocker: '',
        }));
  const planSteps =
    baseSteps.length > 0
      ? baseSteps
      : [
          {
            id: 'fallback_step_1',
            title: pickFirst(
              structuredPlan.nextMove,
              'Define the first safe implementation step.',
            ),
            status: 'proposed' as const,
            assignedAgentId: null,
            skillId: null,
            toolIds: [],
            generatedPrompt: '',
            expectedOutput: '',
            relatedFiles: [],
            relatedObjects: [],
            relatedSurface: null,
            validationCommand: null,
            approvalRequired: true,
            resultSummary: '',
            blocker: '',
          },
        ];

  const nodes: PlanMissionFlowNode[] = [];

  nodes.push(
    makeNode(
      'mission_goal',
      'Active Plan Goal',
      'Goal',
      40,
      136,
      goalText,
      modeText === 'archived' ? 'done' : 'approved',
      'plan_goal',
      'plan_goal_summary',
      undefined,
      'Treat this plan as the editable intent contract before any execution.',
      false,
    ),
  );

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

  const noteSource = pickFirst(structuredPlan.sources, '');
  const modeLabel =
    modeText === 'active_run'
      ? 'Active run plan'
      : modeText === 'template'
        ? 'Template plan'
        : modeText === 'archived'
          ? 'Archived plan'
          : modeText === 'meta'
            ? 'Meta plan'
            : 'Draft plan';
  const noteText = noteSource || `${modeLabel}: edit steps and approve before execution.`;
  nodes.push(
    makeNode(
      'mission_note',
      'Plan Note',
      'Note',
      STEP_BASE_X + Math.max(1, planSteps.length - 1) * STEP_DELTA_X,
      STEP_BASE_Y + 156,
      noteText,
      'proposed',
      'plan_note',
      'plan_note_text',
      undefined,
      undefined,
      false,
    ),
  );

  const edges: PlanMissionFlowEdge[] = [];
  const firstStepNodeId = planSteps.length > 0 ? toNodeId(planSteps[0], 0) : null;
  if (firstStepNodeId) {
    edges.push(
      makeEdge(
        'edge_goal_to_step_1',
        'mission_goal',
        firstStepNodeId,
        modeText === 'active_run' ? 'active' : 'idle',
      ),
    );
  }
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
  if (planSteps.length > 0) {
    edges.push(
      makeEdge(
        'edge_last_step_to_note',
        toNodeId(planSteps[planSteps.length - 1], planSteps.length - 1),
        'mission_note',
        'idle',
      ),
    );
  } else {
    edges.push(makeEdge('edge_goal_to_note', 'mission_goal', 'mission_note', 'idle'));
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
