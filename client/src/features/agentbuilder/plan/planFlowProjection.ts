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
  if (node.type === 'PlanRoute') return { x: 40, y: 48 };
  if (node.type === 'Task') {
    return {
      x: 360 + (index % 4) * 300,
      y: 320 + Math.floor(index / 4) * 178,
    };
  }
  if (node.type === 'MagenticOnePlan') {
    return { x: 40 + (index % 3) * 300, y: 1120 + Math.floor(index / 3) * 178 };
  }
  if (node.type === 'RuntimeRun' || node.type === 'Proof') {
    return { x: 960 + (index % 3) * 300, y: 1120 + Math.floor(index / 3) * 178 };
  }
  if (node.type === 'ThinkGraphEvent') {
    return { x: 40 + (index % 4) * 300, y: 1320 + Math.floor(index / 4) * 178 };
  }
  return { x: 360 + (index % 4) * 300, y: 1120 + Math.floor(index / 4) * 178 };
}

function toMissionNode(node: PlanFlowNode, index: number): PlanMissionFlowNode {
  return {
    id: node.id,
    type: 'mission',
    position: planNodePosition(node, index),
    data: {
      label: node.title,
      kind: toMissionKind(node.type),
      status: toMissionStatus(node.status),
      description: `${node.provenance}\nSource: ${node.sourcePath}`,
      relatedFiles: node.sourcePath ? [node.sourcePath] : [],
      relatedObjects: node.links,
      source: node.source,
      sourcePath: node.sourcePath,
      provenance: node.provenance,
      links: node.links,
      editable: node.source === 'user',
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

function cleanPlanLines(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function projectRealMagenticPlans(run: DeckRun | null | undefined): PlanFlowProjection {
  const nodes: PlanFlowNode[] = [];
  const edges: PlanFlowProjection['edges'] = [];
  (run?.steps || []).forEach((step) => {
    const plan = step.magenticTrace?.plan;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return;
    const record = plan as Record<string, any>;
    const planId = `planflow:magentic:${run?.id || 'run'}:${step.id}`;
    const title =
      String(record?.summary || record?.title || record?.task_ledger?.task || '').trim() ||
      `Magentic-One proposal from ${step.title}`;
    nodes.push({
      id: planId,
      type: 'MagenticOnePlan',
      title,
      source: 'magentic_one',
      sourcePath: `deck-run:${run?.id || 'unknown'}/step:${step.id}`,
      provenance: `Real runtime magenticTrace.plan emitted by ${step.title}`,
      status: 'draft',
      links: [],
    });
    cleanPlanLines(record?.task_ledger?.task_plan).forEach((taskTitle, taskIndex) => {
      const taskId = `${planId}:task:${taskIndex + 1}`;
      nodes.push({
        id: taskId,
        type: 'Task',
        title: taskTitle,
        source: 'magentic_one',
        sourcePath: `deck-run:${run?.id || 'unknown'}/step:${step.id}`,
        provenance: `Real runtime magenticTrace.plan task ${taskIndex + 1}`,
        status: 'draft',
        links: [planId],
      });
      edges.push({
        id: `${planId}:edge:${taskIndex + 1}`,
        source: planId,
        target: taskId,
        type: 'defines_task',
      });
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

export function buildPlanFlowMissionGraph(
  markdownProjection: PlanFlowProjection | null | undefined,
  run: DeckRun | null | undefined,
): PlanMissionGraph {
  const magenticProjection = projectRealMagenticPlans(run);
  const nodes = [...(markdownProjection?.nodes || []), ...magenticProjection.nodes];
  const edges = [...(markdownProjection?.edges || []), ...magenticProjection.edges];
  const indexByType = new Map<PlanFlowNode['type'], number>();
  return {
    nodes: nodes.map((node) => {
      const index = indexByType.get(node.type) || 0;
      indexByType.set(node.type, index + 1);
      return toMissionNode(node, index);
    }),
    edges: edges.map(toMissionEdge),
  };
}
