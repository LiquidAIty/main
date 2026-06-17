import type { Node, Edge } from '@xyflow/react';

type TaskLedgerArtifact = {
  planResponse?: string;
  taskLedgerResponse?: string;
  factsResponse?: string;
  teamDescription?: string;
  modelCallProof?: unknown;
};

type PlanRunLike = {
  id?: string;
  taskLedgerArtifact?: TaskLedgerArtifact;
  result?: {
    taskLedgerArtifact?: TaskLedgerArtifact;
    finalResponseText?: string;
    autogenMessages?: unknown[];
  };
};

export type PlanFlowMissionGraph = {
  nodes: Node[];
  edges: Edge[];
};

/**
 * Honest PlanFlow projection.
 *
 * No sanitizer.
 * No regex cleanup.
 * No agent-name stripping.
 * No Source stripping.
 * No prompt-injection filter.
 * No poison filter.
 * No deterministic text rewrite.
 *
 * This renders the real Task Ledger plan text as-is.
 */
export function buildPlanFlowMissionGraph(run?: PlanRunLike | null): PlanFlowMissionGraph {
  const artifact =
    run?.taskLedgerArtifact ??
    run?.result?.taskLedgerArtifact ??
    null;

  const planText = artifact?.planResponse ?? '';

  if (!planText.trim()) {
    return { nodes: [], edges: [] };
  }

  const lines = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const nodes: Node[] = lines.map((line, index) => ({
    id: `plan-canvas:step:${index + 1}`,
    type: 'planStep',
    position: {
      x: 80 + (index % 3) * 340,
      y: 80 + Math.floor(index / 3) * 220,
    },
    data: {
      kind: 'Step',
      stepNumber: index + 1,
      label: `Step ${index + 1}: ${line}`,
      title: line,
      detail: '',
      source: 'taskLedgerArtifact.planResponse',
      taskLedgerArtifact: artifact,
      runId: run?.id,
    },
  }));

  const edges: Edge[] = nodes.slice(1).map((node, index) => ({
    id: `plan-canvas:edge:${index + 1}`,
    source: nodes[index].id,
    target: node.id,
    type: 'smoothstep',
  }));

  return { nodes, edges };
}

export function projectRealMagenticPlans(runs: PlanRunLike[] = []): PlanFlowMissionGraph {
  const latestRunWithLedger = [...runs]
    .reverse()
    .find((run) => run?.taskLedgerArtifact?.planResponse || run?.result?.taskLedgerArtifact?.planResponse);

  return buildPlanFlowMissionGraph(latestRunWithLedger ?? null);
}
