import type { DeckRun, PlanFlowNode, PlanFlowProjection } from '../../../types/agentgraph';
import type {
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

type RealAutoGenMessage = { source: string; type: string; content: string };

/** Extracts real AutoGen messages a run returned, verbatim. Never authored. */
function readAutoGenMessages(plan: Record<string, any> | null): RealAutoGenMessage[] {
  if (!plan) return [];
  const raw = Array.isArray(plan.autogenMessages) ? plan.autogenMessages : [];
  return raw
    .map((m: any) => ({ source: text(m?.source), type: text(m?.type), content: text(m?.content) }))
    .filter((m: RealAutoGenMessage) => Boolean(m.content));
}

/** Reads the real Task Ledger artifact a run returned, if AutoGen produced one. */
function readTaskLedgerArtifact(plan: Record<string, any> | null): Record<string, any> | null {
  return plan ? asRecord(plan.taskLedgerArtifact) : null;
}

/** Finds the latest run step that actually returned a real Task Ledger artifact. */
function readLatestTaskLedgerArtifact(
  run: DeckRun | null | undefined,
): { artifact: Record<string, any>; sourcePath: string; provenance: string } | null {
  const steps = run?.steps || [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    const artifact = readTaskLedgerArtifact(asRecord(step.magenticTrace?.plan));
    if (artifact) {
      return {
        artifact,
        sourcePath: `deck-run:${run?.id || 'unknown'}/step:${step.id}`,
        provenance: `Real AutoGen 0.7.5 Magentic-One Task Ledger from ${step.title}`,
      };
    }
  }
  return null;
}

/**
 * Renders the real Task Ledger artifact verbatim (facts, plan, full ledger text)
 * with source metadata derived only from what AutoGen actually returned. Nothing
 * is split into invented sections/steps and no agent names/counts are fabricated.
 */
function buildArtifactSummary(artifact: Record<string, any>): string {
  const proof = Array.isArray(artifact.modelCallProof) ? artifact.modelCallProof : [];
  const facts = text(artifact.factsResponse);
  const plan = text(artifact.planResponse);
  const full = text(artifact.taskLedgerResponse);
  const lines = [
    `Source: ${text(artifact.source) || 'autogen_0_7_5_magentic_one'}`,
    `Phase: ${text(artifact.phase) || 'task_ledger'}`,
    `Facts model call: ${facts ? 'completed' : 'unavailable'}`,
    `Plan model call: ${plan ? 'completed' : 'unavailable'}`,
    `Full Task Ledger: ${full ? 'completed' : 'unavailable'}`,
    `Real model calls captured: ${proof.length}`,
    '',
    full || [facts, plan].filter(Boolean).join('\n\n'),
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}

/**
 * Progress-canvas / inspection projection. Emits the real Task Ledger artifact
 * node and one node per real AutoGen message, all verbatim. No Progress Ledger
 * is projected (out of scope) and nothing is synthesized.
 */
export function projectRealMagenticPlans(run: DeckRun | null | undefined): PlanFlowProjection {
  const nodes: PlanFlowNode[] = [];
  const edges: PlanFlowProjection['edges'] = [];

  (run?.steps || []).forEach((step) => {
    const plan = asRecord(step.magenticTrace?.plan);
    const artifact = readTaskLedgerArtifact(plan);
    const messages = readAutoGenMessages(plan);
    if (!artifact && messages.length === 0) return;
    const sourcePath = `deck-run:${run?.id || 'unknown'}/step:${step.id}`;
    const provenance = `Real AutoGen 0.7.5 Magentic-One Task Ledger from ${step.title}`;
    const base = `planflow:autogen:${run?.id || 'run'}:${step.id}`;

    let artifactId: string | null = null;
    if (artifact) {
      artifactId = `${base}:task_ledger`;
      nodes.push({
        id: artifactId,
        type: 'TaskLedger',
        title: 'Task Ledger (AutoGen)',
        source: 'magentic_one',
        sourcePath,
        provenance,
        status: 'running',
        links: [],
        summary: buildArtifactSummary(artifact),
        payload: artifact,
      });
    }

    messages.forEach((message, index) => {
      const id = `${base}:msg:${index}`;
      nodes.push({
        id,
        type: 'AutoGenMessage',
        title: message.source || message.type || 'AutoGen message',
        source: 'magentic_one',
        sourcePath,
        provenance,
        status: 'running',
        links: artifactId ? [artifactId] : [],
        summary: message.content,
        payload: message,
      });
      if (artifactId) {
        edges.push({ id: `${id}:edge`, source: artifactId, target: id, type: 'contains' });
      }
    });
  });

  return {
    packet_version: 1,
    source: 'planflow_markdown_projection',
    nodes,
    edges,
    warnings: [],
  };
}

/** Stable node id for the single real Task Ledger artifact viewer. */
export const PLAN_CANVAS_TASK_LEDGER_NODE_ID = 'plan-canvas:task_ledger_artifact';
/**
 * Retained id constant only. Run Task / Progress Ledger are OUT OF SCOPE in the
 * Task-Ledger-only flow: no Run Task gate node is emitted onto the Plan canvas.
 */
export const PLAN_CANVAS_RUN_TASK_NODE_ID = 'plan-canvas:run_task';

/**
 * Builds the Plan canvas from the real AutoGen Task Ledger artifact ONLY.
 *
 * - If AutoGen returned a real Task Ledger artifact, render exactly one viewer
 *   node containing the verbatim facts/plan/full ledger text plus source
 *   metadata.
 * - Otherwise return an empty graph. No "Task Ledger Planning" placeholder, no
 *   "Preparing…" text, no Run Task gate node, no synthesized steps. (Progress
 *   Ledger / Run Task are out of scope and never rendered here.)
 */
export function buildPlanFlowMissionGraph(
  run: DeckRun | null | undefined,
): PlanMissionGraph {
  const latest = readLatestTaskLedgerArtifact(run);
  if (!latest) {
    return { nodes: [], edges: [] };
  }

  const summary = buildArtifactSummary(latest.artifact);
  const artifactNode: PlanMissionFlowNode = {
    id: PLAN_CANVAS_TASK_LEDGER_NODE_ID,
    type: 'mission',
    position: { x: 120, y: 80 },
    data: {
      label: 'Task Ledger (AutoGen 0.7.5)',
      kind: 'TaskLedger',
      status: 'running',
      source: 'magentic_one',
      sourcePath: latest.sourcePath,
      provenance: latest.provenance,
      editable: false,
      summary,
      description: summary,
      payloadJson: JSON.stringify(latest.artifact, null, 2),
    },
    draggable: true,
    selectable: true,
  };

  return { nodes: [artifactNode], edges: [] };
}

// Exported for focused unit coverage.
export const __test = { readAutoGenMessages, readTaskLedgerArtifact, readLatestTaskLedgerArtifact, buildArtifactSummary };
