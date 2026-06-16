import type { DeckRun, PlanFlowNode, PlanFlowProjection } from '../../../types/agentgraph';
import type {
  PlanMissionFlowEdge,
  PlanMissionFlowNode,
  PlanMissionGraph,
} from '../../../components/assist/planMissionModel';

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

/** Stable node ids for the deterministic two-stage Plan canvas. */
export const PLAN_CANVAS_TASK_LEDGER_NODE_ID = 'plan-canvas:task_ledger_planning';
export const PLAN_CANVAS_RUN_TASK_NODE_ID = 'plan-canvas:run_task';

/**
 * Finds the latest real Magentic-One Task Ledger / proposed task in the run.
 * Only a returned `task_ledger` (or `proposed_action`) counts as runnable —
 * progress ledgers and results never make the Plan canvas runnable.
 */
function readLatestRunnablePlan(
  run: DeckRun | null | undefined,
): { plan: Record<string, any>; sourcePath: string; provenance: string } | null {
  const steps = run?.steps || [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    const plan = asRecord(step.magenticTrace?.plan);
    if (!plan) continue;
    if (asRecord(plan.task_ledger) || plan.proposed_action) {
      return {
        plan,
        sourcePath: `deck-run:${run?.id || 'unknown'}/step:${step.id}`,
        provenance: `Real Magentic-One Task Ledger from ${step.title}`,
      };
    }
  }
  return null;
}

/**
 * Builds the deterministic two-stage Plan canvas mission graph:
 *
 *   [Task Ledger Planning]
 *            ↓
 *        [Run Task]
 *
 * The structure is always present — the canvas never starts blank. The Task
 * Ledger Planning node fills with the real Magentic-One Task Ledger only when
 * Python returns one; until then it shows an honest waiting state and Run Task
 * stays disabled. No plan content is ever invented in TypeScript and no
 * progress/result/agent-runtime lanes are projected onto the Plan canvas.
 */
export function buildPlanFlowMissionGraph(
  run: DeckRun | null | undefined,
): PlanMissionGraph {
  const latest = readLatestRunnablePlan(run);
  const taskLedger = latest ? asRecord(latest.plan.task_ledger) : null;
  const runnable = Boolean(latest && (taskLedger || latest.plan.proposed_action));

  const goal = taskLedger ? text(taskLedger.user_goal) : '';
  const planText = taskLedger ? readTaskLedgerPlan(taskLedger) : '';
  const taskLedgerSummary = runnable
    ? [
        goal ? `Goal: ${goal}` : '',
        planText ? `Plan:\n${planText}` : 'Plan: (none returned)',
      ]
        .filter(Boolean)
        .join('\n')
    : 'Preparing the Task Ledger from Magentic-One…';

  const taskLedgerPayloadJson = taskLedger
    ? JSON.stringify(taskLedger, null, 2)
    : undefined;

  const taskLedgerNode: PlanMissionFlowNode = {
    id: PLAN_CANVAS_TASK_LEDGER_NODE_ID,
    type: 'mission',
    position: { x: 120, y: 80 },
    data: {
      label: 'Task Ledger Planning',
      kind: 'TaskLedger',
      status: runnable ? 'running' : 'proposed',
      source: 'magentic_one',
      sourcePath: latest?.sourcePath,
      provenance: latest?.provenance || 'Awaiting Magentic-One Task Ledger',
      editable: false,
      summary: taskLedgerSummary,
      description: taskLedgerSummary,
      ...(taskLedgerPayloadJson ? { payloadJson: taskLedgerPayloadJson } : {}),
    },
    draggable: true,
    selectable: true,
  };

  const runTaskDescription = runnable
    ? 'Approved Task Ledger is runnable. Click Run Task to dispatch execution.'
    : 'Run Task is disabled until Magentic-One returns a runnable Task Ledger.';
  const runTaskNode: PlanMissionFlowNode = {
    id: PLAN_CANVAS_RUN_TASK_NODE_ID,
    type: 'mission',
    position: { x: 120, y: 320 },
    data: {
      label: 'Run Task',
      kind: 'RunTask',
      status: runnable ? 'ready' : 'proposed',
      source: 'magentic_one',
      provenance: 'Human approval action — dispatches the displayed Task Ledger',
      editable: false,
      isRunTaskNode: true,
      runnable,
      summary: runTaskDescription,
      description: runTaskDescription,
    },
    draggable: true,
    selectable: true,
  };

  const edge: PlanMissionFlowEdge = {
    id: `${PLAN_CANVAS_TASK_LEDGER_NODE_ID}->${PLAN_CANVAS_RUN_TASK_NODE_ID}`,
    source: PLAN_CANVAS_TASK_LEDGER_NODE_ID,
    target: PLAN_CANVAS_RUN_TASK_NODE_ID,
    type: 'turboFlow',
    data: { motion: 'idle' },
    animated: false,
    className: 'edge-secondary',
  };

  return { nodes: [taskLedgerNode, runTaskNode], edges: [edge] };
}

// Exported for focused unit coverage of legacy alias normalization.
export const __test = { readTaskLedgerPlan, cleanPlanLines, readLatestRunnablePlan };
