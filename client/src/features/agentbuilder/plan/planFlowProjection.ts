import type { DeckRun, PlanFlowNode, PlanFlowProjection } from '../../../types/agentgraph';
import type {
  PlanMissionFlowEdge,
  PlanMissionFlowNode,
  PlanMissionGraph,
  PlanMissionNodeKind,
  PlanMissionNodeStatus,
} from '../../../components/assist/planMissionModel';

function toMissionKind(type: PlanFlowNode['type']): PlanMissionNodeKind {
  return type;
}

function toMissionStatus(status: PlanFlowNode['status']): PlanMissionNodeStatus {
  if (status === 'draft') return 'proposed';
  if (status === 'pending') return 'ready';
  if (status === 'failed') return 'error';
  return status;
}

function planNodePosition(node: PlanFlowNode, index: number): { x: number; y: number } {
  if (node.type === 'TaskLedger') return { x: 40, y: 48 };
  if (node.type === 'CurrentSpec') return { x: 40, y: 226 };
  if (node.type === 'ProgressLedger') return { x: 40, y: 404 };
  if (node.type === 'SelectedAction') return { x: 360, y: 404 };
  if (node.type === 'CodeConsoleRun') return { x: 680, y: 404 };
  if (node.type === 'TaskResult') {
    return { x: 360 + (index % 3) * 300, y: 600 + Math.floor(index / 3) * 178 };
  }
  if (node.type === 'NextSpecCandidate') return { x: 40, y: 600 };
  if (node.type === 'MagOneTraceEvent') {
    return { x: 40 + (index % 4) * 300, y: 800 + Math.floor(index / 4) * 160 };
  }
  return { x: 360 + (index % 4) * 300, y: 800 + Math.floor(index / 4) * 178 };
}

function toMissionNode(node: PlanFlowNode, index: number): PlanMissionFlowNode {
  const payloadJson =
    node.payload === undefined || node.payload === null
      ? undefined
      : JSON.stringify(node.payload, null, 2);
  const summary = node.summary?.trim() || '';
  return {
    id: node.id,
    type: 'mission',
    position: planNodePosition(node, index),
    data: {
      label: node.title,
      kind: toMissionKind(node.type),
      status: toMissionStatus(node.status),
      description: summary || node.provenance,
      relatedFiles: node.sourcePath ? [node.sourcePath] : [],
      relatedObjects: node.links,
      source: node.source,
      sourcePath: node.sourcePath,
      provenance: node.provenance,
      links: node.links,
      // Raw Mag One ledger/run/event payloads are not user-editable source of truth.
      editable: false,
      ...(summary ? { summary } : {}),
      ...(payloadJson ? { payloadJson } : {}),
    },
  };
}

function toMissionEdge(
  edge: PlanFlowProjection['edges'][number],
): PlanMissionFlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'turboFlow',
    data: { motion: 'idle' },
    animated: false,
    className: 'edge-secondary',
  };
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Canonical Task Ledger plan text is `task_ledger.plan`. Some legacy persisted
 * state / fixtures used `task_plan`; normalize that alias once here at the
 * projection boundary so the rest of the UI only reads `plan`. No fabrication:
 * if neither is present the result is empty and no plan content is invented.
 */
function readTaskLedgerPlan(taskLedger: Record<string, any>): string {
  return text(taskLedger.plan) || text(taskLedger.task_plan);
}

function cleanPlanLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Projects ReactFlow nodes from real Magentic-One sidecar payloads only.
 * Every node is derived from an actual returned field; nothing is invented and
 * PLAN.md is never a node source. Optional fields produce nodes only when the
 * real payload contains them.
 */
export function projectRealMagenticPlans(run: DeckRun | null | undefined): PlanFlowProjection {
  const nodes: PlanFlowNode[] = [];
  const edges: PlanFlowProjection['edges'] = [];

  (run?.steps || []).forEach((step) => {
    const plan = asRecord(step.magenticTrace?.plan);
    if (!plan) return;
    const sourcePath = `deck-run:${run?.id || 'unknown'}/step:${step.id}`;
    const provenance = `Real Magentic-One orchestration payload from ${step.title}`;
    const base = `planflow:magentic:${run?.id || 'run'}:${step.id}`;

    const taskLedger = asRecord(plan.task_ledger);
    const progressLedger = asRecord(plan.progress_ledger);

    let taskLedgerId: string | null = null;
    if (taskLedger) {
      taskLedgerId = `${base}:task_ledger`;
      const goal = text(taskLedger.user_goal);
      const planText = readTaskLedgerPlan(taskLedger);
      const summaryParts = [
        goal ? `Goal: ${goal}` : '',
        planText ? `Plan:\n${planText}` : 'Plan: (none returned)',
      ].filter(Boolean);
      nodes.push({
        id: taskLedgerId,
        type: 'TaskLedger',
        title: 'TaskLedger',
        source: 'magentic_one',
        sourcePath,
        provenance,
        status: 'running',
        links: [],
        summary: summaryParts.join('\n'),
        payload: taskLedger,
      });

      const currentSpec = text(taskLedger.current_spec);
      if (currentSpec) {
        const specId = `${base}:current_spec`;
        nodes.push({
          id: specId,
          type: 'CurrentSpec',
          title: 'Current SPEC',
          source: 'magentic_one',
          sourcePath,
          provenance,
          status: 'running',
          links: [taskLedgerId],
          summary: currentSpec,
          payload: { current_spec: currentSpec },
        });
        edges.push({ id: `${specId}:edge`, source: taskLedgerId, target: specId, type: 'contains' });
      }
    }

    let progressLedgerId: string | null = null;
    if (progressLedger) {
      progressLedgerId = `${base}:progress_ledger`;
      const summaryParts = [
        text(progressLedger.progress_summary) ? `Progress: ${text(progressLedger.progress_summary)}` : '',
        text(progressLedger.next_action) ? `Next action: ${text(progressLedger.next_action)}` : '',
        text(progressLedger.blocker) ? `Blocker: ${text(progressLedger.blocker)}` : '',
      ].filter(Boolean);
      nodes.push({
        id: progressLedgerId,
        type: 'ProgressLedger',
        title: 'ProgressLedger',
        source: 'magentic_one',
        sourcePath,
        provenance,
        status: progressLedger.is_stuck ? 'blocked' : progressLedger.is_complete ? 'complete' : 'running',
        links: taskLedgerId ? [taskLedgerId] : [],
        summary: summaryParts.join('\n') || 'Progress ledger returned with no progress fields.',
        payload: progressLedger,
      });
      if (taskLedgerId) {
        edges.push({
          id: `${progressLedgerId}:edge`,
          source: taskLedgerId,
          target: progressLedgerId,
          type: 'contains',
        });
      }

      // Selected action/tool node — only when Mag One actually selected one.
      const nextAction = text(progressLedger.next_action);
      const nextActor = text(progressLedger.next_actor);
      if (nextAction || nextActor) {
        const actionId = `${base}:selected_action`;
        nodes.push({
          id: actionId,
          type: 'SelectedAction',
          title: nextAction || nextActor,
          source: 'magentic_one',
          sourcePath,
          provenance: 'Mag One selected next action/actor',
          status: 'ready',
          links: [progressLedgerId],
          summary: [nextActor ? `Actor: ${nextActor}` : '', nextAction ? `Action: ${nextAction}` : '']
            .filter(Boolean)
            .join('\n'),
          payload: { next_actor: nextActor, next_action: nextAction, next_instruction: text(progressLedger.next_instruction) },
        });
        edges.push({ id: `${actionId}:edge`, source: progressLedgerId, target: actionId, type: 'defines_task' });
      }

      // TaskResult node — only when a real result exists.
      const taskResult = text(progressLedger.task_result);
      if (taskResult) {
        const resultId = `${base}:task_result`;
        nodes.push({
          id: resultId,
          type: 'TaskResult',
          title: 'TaskResult',
          source: 'magentic_one',
          sourcePath,
          provenance: 'Mag One TaskResult payload',
          status: progressLedger.is_complete ? 'complete' : 'running',
          links: [progressLedgerId],
          summary: [
            `Result: ${taskResult}`,
            text(progressLedger.blocker) ? `Blocker: ${text(progressLedger.blocker)}` : '',
            text(progressLedger.next_needed) ? `Next needed: ${text(progressLedger.next_needed)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          payload: {
            task_result: taskResult,
            blocker: text(progressLedger.blocker),
            next_needed: text(progressLedger.next_needed),
          },
        });
        edges.push({ id: `${resultId}:edge`, source: progressLedgerId, target: resultId, type: 'defines_task' });
      }

      // Next SPEC candidate — only when real progress payload includes one.
      const nextSpec = text(progressLedger.next_spec_candidate) || text(progressLedger.next_needed);
      if (nextSpec) {
        const nextId = `${base}:next_spec`;
        nodes.push({
          id: nextId,
          type: 'NextSpecCandidate',
          title: nextSpec.slice(0, 120),
          source: 'magentic_one',
          sourcePath,
          provenance: 'Mag One next SPEC candidate / next_needed',
          status: 'draft',
          links: progressLedgerId ? [progressLedgerId] : [],
          summary: nextSpec,
          payload: {
            next_spec_candidate: text(progressLedger.next_spec_candidate),
            next_needed: text(progressLedger.next_needed),
          },
        });
        edges.push({ id: `${nextId}:edge`, source: progressLedgerId, target: nextId, type: 'defines_task' });
      }
    }
  });

  return {
    packet_version: 1,
    source: 'planflow_markdown_projection',
    nodes,
    edges,
    warnings: [],
  };
}

/**
 * Builds the ReactFlow mission graph for the PlanFlow canvas. Nodes are derived
 * exclusively from real Magentic-One orchestration output. Before Mag One
 * returns anything the canvas is empty (`nodes = []`, `edges = []`). PLAN.md is
 * never projected onto the canvas.
 */
export function buildPlanFlowMissionGraph(
  run: DeckRun | null | undefined,
): PlanMissionGraph {
  const magenticProjection = projectRealMagenticPlans(run);
  const indexByType = new Map<PlanFlowNode['type'], number>();
  return {
    nodes: magenticProjection.nodes.map((node) => {
      const index = indexByType.get(node.type) || 0;
      indexByType.set(node.type, index + 1);
      return toMissionNode(node, index);
    }),
    edges: magenticProjection.edges.map(toMissionEdge),
  };
}

// Exported for focused unit coverage of legacy alias normalization.
export const __test = { readTaskLedgerPlan, cleanPlanLines };
