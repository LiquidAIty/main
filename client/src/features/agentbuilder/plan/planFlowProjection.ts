import type { DeckRun, PlanFlowNode, PlanFlowProjection } from '../../../types/agentgraph';
import type {
  PlanMissionFlowEdge,
  PlanMissionFlowNode,
  PlanMissionGraph,
  PlanMissionNodeStatus,
} from '../../../components/assist/planMissionModel';

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readTaskLedgerArtifact(plan: Record<string, any> | null): Record<string, any> | null {
  return plan ? asRecord(plan.taskLedgerArtifact) : null;
}

type LatestTaskLedgerArtifact = {
  artifact: Record<string, any>;
  runId: string;
  stepId: string;
  status: 'complete' | 'failed' | 'running';
  missionStatus: PlanMissionNodeStatus;
};

function statusFromStep(step: any): 'complete' | 'failed' | 'running' {
  return step?.status === 'error' ? 'failed' : step?.status === 'running' ? 'running' : 'complete';
}

function missionStatusFromRun(run: DeckRun | null | undefined): PlanMissionNodeStatus {
  return run?.status === 'error' ? 'error' : run?.status === 'running' ? 'running' : 'complete';
}

function readLatestTaskLedgerArtifact(run: DeckRun | null | undefined): LatestTaskLedgerArtifact | null {
  const steps = run?.steps || [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i] as any;
    const artifact = readTaskLedgerArtifact(asRecord(step.magenticTrace?.plan));
    if (artifact) {
      return {
        artifact,
        runId: run?.id || 'run',
        stepId: step.id || `step-${i + 1}`,
        status: statusFromStep(step),
        missionStatus: missionStatusFromRun(run),
      };
    }
  }
  return null;
}

type ExtractedPlanStep = {
  index: number;
  title: string;
  detail: string;
  sourceField: 'planResponse' | 'taskLedgerResponse';
};

const MAX_STEP_TITLE_WORDS = 8;
const MAX_STEP_DETAIL_CHARS = 160;
const MAX_STEPS = 24;

function cleanPlanLine(line: string): string {
  return line
    .replace(/[`*_]+/g, '')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMetadataLine(line: string): boolean {
  return /^(task ledger|given facts|verified facts|facts response|plan response|full ledger|model-call|raw internal text|source:|phase:|team description)/i.test(line.trim());
}

function shortTitle(value: string): string {
  const cleaned = cleanPlanLine(value)
    .replace(/^(step|phase)\s*\d*\s*[:.)-]?\s*/i, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, MAX_STEP_TITLE_WORDS);
  return words.join(' ') || 'Review generated plan';
}

function shortDetail(value: string, title: string): string {
  const cleaned = cleanPlanLine(value);
  if (!cleaned || cleaned === title) return '';
  return cleaned.length > MAX_STEP_DETAIL_CHARS
    ? `${cleaned.slice(0, MAX_STEP_DETAIL_CHARS - 1).trim()}…`
    : cleaned;
}

function sourceText(artifact: Record<string, any>): { value: string; field: 'planResponse' | 'taskLedgerResponse' } | null {
  const plan = text(artifact.planResponse);
  if (plan) return { value: plan, field: 'planResponse' };
  const ledger = text(artifact.taskLedgerResponse);
  if (ledger) return { value: ledger, field: 'taskLedgerResponse' };
  return null;
}

function extractPlanSteps(artifact: Record<string, any>): ExtractedPlanStep[] {
  const source = sourceText(artifact);
  if (!source) return [];

  const rawLines = source.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isMetadataLine(line));

  const steps: ExtractedPlanStep[] = [];
  for (let i = 0; i < rawLines.length && steps.length < MAX_STEPS; i += 1) {
    const line = rawLines[i];
    const stepMatch = line.match(/^(?:#{1,6}\s*)?(?:step|phase)\s*(\d+|[ivxlcdm]+)?\s*[:.)-]?\s*(.+)?$/i);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const candidate = stepMatch?.[2] || numberedMatch?.[1] || bulletMatch?.[1] || '';
    if (!candidate) continue;

    const title = shortTitle(candidate);
    const nextLine = rawLines[i + 1] || '';
    const nextIsStep = /^(?:#{1,6}\s*)?(?:step|phase)\s*(\d+|[ivxlcdm]+)?\s*[:.)-]?\s+|^\d+[.)]\s+|^[-*•]\s+/i.test(nextLine);
    const detail = !nextIsStep && nextLine && !isMetadataLine(nextLine)
      ? shortDetail(nextLine, title)
      : shortDetail(candidate, title);

    steps.push({
      index: steps.length + 1,
      title,
      detail,
      sourceField: source.field,
    });
  }

  if (steps.length === 0 && source.value.trim()) {
    return [{
      index: 1,
      title: 'Review generated plan',
      detail: 'Plan text available in artifact; step extraction needs review.',
      sourceField: source.field,
    }];
  }

  return steps;
}

function stepPayload(step: ExtractedPlanStep, latest: LatestTaskLedgerArtifact): Record<string, unknown> {
  return {
    stepIndex: step.index,
    title: step.title,
    detail: step.detail,
    sourceField: `taskLedgerArtifact.${step.sourceField}`,
    runId: latest.runId,
    stepId: latest.stepId,
  };
}

export function projectRealMagenticPlans(run: DeckRun | null | undefined): PlanFlowProjection {
  const nodes: PlanFlowNode[] = [];
  const edges: PlanFlowProjection['edges'] = [];

  (run?.steps || []).forEach((runStep: any) => {
    const artifact = readTaskLedgerArtifact(asRecord(runStep.magenticTrace?.plan));
    if (!artifact) return;

    const latest: LatestTaskLedgerArtifact = {
      artifact,
      runId: run?.id || 'run',
      stepId: runStep.id || 'step',
      status: statusFromStep(runStep),
      missionStatus: missionStatusFromRun(run),
    };

    const steps = extractPlanSteps(artifact);
    const base = `planflow:autogen:${latest.runId}:${latest.stepId}`;

    steps.forEach((step, idx) => {
      const id = `${base}:step:${step.index}`;
      nodes.push({
        id,
        type: 'Task',
        title: `Step ${step.index}: ${step.title}`,
        source: 'magentic_one',
        sourcePath: `deck-run:${latest.runId}/step:${latest.stepId}`,
        provenance: `taskLedgerArtifact.${step.sourceField}`,
        status: latest.status,
        links: [],
        summary: step.detail,
        payload: stepPayload(step, latest),
      });

      if (idx > 0) {
        edges.push({
          id: `${base}:edge:${idx}`,
          source: `${base}:step:${idx}`,
          target: id,
          type: 'defines_task',
        });
      }
    });
  });

  return {
    packet_version: 1,
    source: 'planflow_task_ledger_steps',
    nodes,
    edges,
    warnings: [],
  };
}

export function buildPlanFlowMissionGraph(run: DeckRun | null | undefined): PlanMissionGraph {
  const latest = readLatestTaskLedgerArtifact(run);
  if (!latest) return { nodes: [], edges: [] };

  const steps = extractPlanSteps(latest.artifact);

  const nodes: PlanMissionFlowNode[] = steps.map((step, idx) => ({
    id: `plan-canvas:step:${step.index}`,
    type: 'mission',
    // Wrapped 3-column row layout with generous spacing so 260px-wide cards do
    // not touch (≈60px horizontal, ≈70px vertical gap) and stay scannable.
    position: { x: 80 + (idx % 3) * 320, y: 60 + Math.floor(idx / 3) * 210 },
    data: {
      label: `Step ${step.index}: ${step.title}`,
      kind: 'Step',
      status: latest.missionStatus,
      description: step.detail,
      updateKey: `plan-canvas:step:${step.index}`,
      source: 'magentic_one',
      sourcePath: `deck-run:${latest.runId}/step:${latest.stepId}`,
      provenance: `taskLedgerArtifact.${step.sourceField}`,
      editable: true,
      summary: step.detail,
    },
    draggable: true,
    selectable: true,
  }));

  const edges: PlanMissionFlowEdge[] = steps.slice(1).map((step, idx) => ({
    id: `plan-canvas:edge:${idx + 1}`,
    source: `plan-canvas:step:${idx + 1}`,
    target: `plan-canvas:step:${step.index}`,
    type: 'turboFlow',
    data: { motion: latest.missionStatus === 'running' ? 'running' : 'idle' },
    className: 'edge-secondary',
    animated: false,
  }));

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// PlanFlow Go gate (approval gate only — never executes)
// ---------------------------------------------------------------------------

export type PlanFlowGoGateStatus = 'no_selection' | 'ready';

export type PlanFlowGoGateState = {
  status: PlanFlowGoGateStatus;
  selectedNodeId: string | null;
  selectedTitle: string;
  message: string;
  /** The gate stages an approval only; it never runs anything. Always false. */
  executed: false;
  /** The gate never completes a task; it stops before the Progress Ledger. */
  taskComplete: false;
};

type GoGateSelectedNode = {
  id?: string | null;
  nodeId?: string | null;
  label?: string | null;
  title?: string | null;
} | null | undefined;

const GO_GATE_NOT_WIRED_MESSAGE =
  'Run Task unavailable: approved task-node execution is not wired yet.';

/**
 * Pure helper for the PlanFlow Go gate. Given the currently selected Step node
 * (or none), it returns the approval-gate state to display in the inspector.
 *
 * It NEVER touches autogenMessages, finalResponseText, chat text, the coder,
 * tools, the terminal, or the Progress Ledger. Clicking Go only stages the
 * selected step at the approval gate; `executed` and `taskComplete` are always
 * false so the outer planning loop cannot cross into the inner execution loop.
 */
export function buildPlanFlowGoGateState(selectedNode: GoGateSelectedNode): PlanFlowGoGateState {
  const id = text(selectedNode?.id ?? selectedNode?.nodeId);
  if (!id) {
    return {
      status: 'no_selection',
      selectedNodeId: null,
      selectedTitle: '',
      message: 'Select a step first.',
      executed: false,
      taskComplete: false,
    };
  }
  return {
    status: 'ready',
    selectedNodeId: id,
    selectedTitle: text(selectedNode?.label ?? selectedNode?.title),
    message: GO_GATE_NOT_WIRED_MESSAGE,
    executed: false,
    taskComplete: false,
  };
}

// ---------------------------------------------------------------------------
// PlanFlow Step card view (readable canvas card content only)
// ---------------------------------------------------------------------------

export type PlanStepCardView = {
  /** Short step title, clamped for the small canvas card. */
  title: string;
  /** One short detail line, clamped. Empty when there is no useful detail. */
  detail: string;
  /** Status word (e.g. complete / running) when present. */
  status: string;
};

const CARD_TITLE_MAX = 70;
const CARD_DETAIL_MAX = 120;

// Internal runtime / orchestration language that must never appear on the small
// user-facing canvas card. Stripped from display text only — the raw artifact,
// data, logs, and inspector provenance are untouched.
const INTERNAL_DISPLAY_PATTERNS: RegExp[] = [
  /\bsource\s*:/gi,
  /\bmagentic[-_\s]?one\b/gi,
  /\bautogen\b/gi,
  /\btask\s*ledger\b/gi,
  /\bprogress\s*ledger\b/gi,
  /\blocal\s*coder\b/gi,
  // CamelCase agent roles: PlanAgent, ThinkGraphAgent, KnowGraphAgent, CodeGraphAgent…
  /\b[A-Za-z]*Agent\b/g,
  /\bSol\b/g,
];

function sanitizeCardText(value: unknown): string {
  let out = text(value);
  for (const pattern of INTERNAL_DISPLAY_PATTERNS) {
    out = out.replace(pattern, ' ');
  }
  out = out
    .replace(/\(\s+/g, '(')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/([,.;:])\1+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:–-]+/, '')
    // Drop a dangling orchestration lead-in left after removing an agent name
    // (e.g. "Have  outline …" -> "outline …", "Ask  map …" -> "map …").
    .replace(/^(have|ask|tell|let|get)\s+/i, '')
    .trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
}

function clampCardText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

/**
 * Compute the ONLY fields a PlanFlow Step card should show on the small canvas:
 * a short human title, one short human detail line, and a status word. Source /
 * provenance / raw artifact text and internal runtime names (Magentic-One,
 * AutoGen, PlanAgent, ThinkGraphAgent, Task Ledger, …) are stripped — they
 * belong in hidden data / the inspector, never on the crowded canvas card.
 */
export function buildPlanStepCardView(
  nodeData: { label?: unknown; summary?: unknown; description?: unknown; status?: unknown } | null | undefined,
): PlanStepCardView {
  return {
    title: clampCardText(sanitizeCardText(nodeData?.label), CARD_TITLE_MAX) || 'Plan Node',
    detail: clampCardText(sanitizeCardText(nodeData?.summary ?? nodeData?.description), CARD_DETAIL_MAX),
    status: text(nodeData?.status),
  };
}

export const __test = {
  readTaskLedgerArtifact,
  readLatestTaskLedgerArtifact,
  extractPlanSteps,
};
