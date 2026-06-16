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

function list(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean);
  }
  return text(value) ? [text(value)] : [];
}

/**
 * Legacy plan-text alias reader. The canonical structured field is
 * `task_ledger.plan_steps`; some legacy persisted state used a flat `plan`
 * string (or the older `task_plan` alias). This reads only those flat aliases —
 * structured plan steps are formatted by {@link formatPlanSteps}. No fabrication.
 */
function readTaskLedgerPlan(taskLedger: Record<string, any>): string {
  return text(taskLedger.plan) || text(taskLedger.task_plan);
}

/**
 * Renders the real structured `plan_steps` (task + assigned agent + status).
 * Falls back to the legacy flat plan string only when no structured steps exist.
 */
function formatPlanSteps(taskLedger: Record<string, any>): string {
  const steps = Array.isArray(taskLedger.plan_steps) ? taskLedger.plan_steps : [];
  if (steps.length > 0) {
    return steps
      .map((step: any, index: number) => {
        const task = text(step?.task);
        if (!task) return '';
        const agent = text(step?.assigned_agent);
        const status = text(step?.status);
        return `${index + 1}. ${task}${agent ? ` — ${agent}` : ''}${status ? ` [${status}]` : ''}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return readTaskLedgerPlan(taskLedger);
}

function formatConnectedAgents(taskLedger: Record<string, any>): string {
  const agents = Array.isArray(taskLedger.connected_agents) ? taskLedger.connected_agents : [];
  return agents
    .map((agent: any) => {
      const name = text(agent?.name) || text(agent?.id);
      if (!name) return '';
      const role = text(agent?.role);
      const tools = list(agent?.tools);
      const status = text(agent?.status);
      return `- ${name}${role ? ` (${role})` : ''} tools: ${tools.length ? tools.join(', ') : 'none'}${status ? ` [${status}]` : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join('\n');
}

/**
 * Builds the human-readable Task Ledger summary from the real contract fields:
 * goal, the four fact buckets, connected agents (with tools), and plan steps
 * (with assigned agent + status). Only fields the real payload contains appear.
 */
function buildTaskLedgerSummary(taskLedger: Record<string, any>): string {
  const goal = text(taskLedger.user_goal);
  const knownFacts = list(taskLedger.known_facts);
  const unknowns = list(taskLedger.unknowns_to_lookup);
  const factsToDerive = list(taskLedger.facts_to_derive);
  const assumptions = list(taskLedger.assumptions_or_guesses);
  const connectedAgents = formatConnectedAgents(taskLedger);
  const planSteps = formatPlanSteps(taskLedger);

  const parts = [
    goal ? `Goal: ${goal}` : '',
    knownFacts.length ? `Facts:\n${bulletList(knownFacts)}` : '',
    unknowns.length ? `Unknowns:\n${bulletList(unknowns)}` : '',
    factsToDerive.length ? `Facts to derive:\n${bulletList(factsToDerive)}` : '',
    assumptions.length ? `Assumptions / guesses:\n${bulletList(assumptions)}` : '',
    connectedAgents ? `Connected agents:\n${connectedAgents}` : '',
    planSteps ? `Plan steps:\n${planSteps}` : 'Plan steps: (none returned)',
  ].filter(Boolean);
  return parts.join('\n');
}

/**
 * Maps the structured ProgressLedger `progress_state` to a PlanFlow node status.
 */
function progressNodeStatus(progressLedger: Record<string, any>): string {
  const state = text(progressLedger.progress_state);
  if (state === 'completed') return 'complete';
  if (state === 'blocked' || state === 'stalled') return 'blocked';
  return 'running';
}

/**
 * Projects ReactFlow nodes from real Magentic-One sidecar payloads only.
 * Reads the structured TaskLedger / ProgressLedger contracts; nothing is
 * invented and PLAN.md is never a node source. This is the rich Progress-canvas
 * projection — the deterministic Plan canvas is {@link buildPlanFlowMissionGraph}.
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
      nodes.push({
        id: taskLedgerId,
        type: 'TaskLedger',
        title: 'TaskLedger',
        source: 'magentic_one',
        sourcePath,
        provenance,
        status: 'running',
        links: [],
        summary: buildTaskLedgerSummary(taskLedger),
        payload: taskLedger,
      });
    }

    let progressLedgerId: string | null = null;
    if (progressLedger) {
      progressLedgerId = `${base}:progress_ledger`;
      const summaryParts = [
        text(progressLedger.current_step) ? `Step: ${text(progressLedger.current_step)}` : '',
        text(progressLedger.progress_state) ? `State: ${text(progressLedger.progress_state)}` : '',
        text(progressLedger.selected_agent) ? `Selected agent: ${text(progressLedger.selected_agent)}` : '',
        text(progressLedger.instruction) ? `Instruction: ${text(progressLedger.instruction)}` : '',
        text(progressLedger.blocker) ? `Blocker: ${text(progressLedger.blocker)}` : '',
      ].filter(Boolean);
      nodes.push({
        id: progressLedgerId,
        type: 'ProgressLedger',
        title: 'ProgressLedger',
        source: 'magentic_one',
        sourcePath,
        provenance,
        status: progressNodeStatus(progressLedger),
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

      // Selected next agent + instruction — only when Mag One actually chose one.
      const selectedAgent = text(progressLedger.selected_agent);
      const instruction = text(progressLedger.instruction);
      if (selectedAgent || instruction) {
        const actionId = `${base}:selected_action`;
        nodes.push({
          id: actionId,
          type: 'SelectedAction',
          title: selectedAgent || instruction.slice(0, 80),
          source: 'magentic_one',
          sourcePath,
          provenance: 'Mag One selected next agent / instruction',
          status: 'ready',
          links: [progressLedgerId],
          summary: [
            selectedAgent ? `Agent: ${selectedAgent}` : '',
            instruction ? `Instruction: ${instruction}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          payload: { selected_agent: selectedAgent, instruction },
        });
        edges.push({ id: `${actionId}:edge`, source: progressLedgerId, target: actionId, type: 'defines_task' });
      }

      // Agent result — only when a real result exists.
      const agentResult = text(progressLedger.agent_result);
      if (agentResult) {
        const resultId = `${base}:agent_result`;
        nodes.push({
          id: resultId,
          type: 'TaskResult',
          title: 'TaskResult',
          source: 'magentic_one',
          sourcePath,
          provenance: 'Mag One agent result payload',
          status: progressNodeStatus(progressLedger) === 'complete' ? 'complete' : 'running',
          links: [progressLedgerId],
          summary: [
            `Result: ${agentResult}`,
            text(progressLedger.blocker) ? `Blocker: ${text(progressLedger.blocker)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          payload: { agent_result: agentResult, blocker: text(progressLedger.blocker) },
        });
        edges.push({ id: `${resultId}:edge`, source: progressLedgerId, target: resultId, type: 'defines_task' });
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

  const taskLedgerSummary = taskLedger
    ? buildTaskLedgerSummary(taskLedger)
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

// Exported for focused unit coverage.
export const __test = { readTaskLedgerPlan, formatPlanSteps, buildTaskLedgerSummary, readLatestRunnablePlan };
