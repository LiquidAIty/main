// @graph entity: PlanFlowMarkdownProjection
// @graph role: living-plan-to-planflow
// @graph relates_to: PlanFlow, PLAN.md, CoderPacket
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type PlanFlowNodeType =
  | 'PlanRoute'
  | 'Task'
  | 'Decision'
  | 'Assumption'
  | 'MagenticOnePlan'
  | 'RuntimeRun'
  | 'Proof'
  | 'SkillReference'
  | 'CodeEvidenceReference'
  | 'ThinkGraphEvent';

export type PlanFlowSource =
  | 'plan_md'
  | 'user'
  | 'magentic_one'
  | 'sol'
  | 'model'
  | 'thinkgraph'
  | 'skillgraph'
  | 'codegraph';

export type PlanFlowStatus =
  | 'draft'
  | 'approved'
  | 'running'
  | 'complete'
  | 'failed'
  | 'blocked'
  | 'pending';

export type PlanFlowNode = {
  id: string;
  type: PlanFlowNodeType;
  title: string;
  source: PlanFlowSource;
  sourcePath: string;
  provenance: string;
  status: PlanFlowStatus;
  links: string[];
};

export type PlanFlowEdge = {
  id: string;
  source: string;
  target: string;
  type: 'contains' | 'defines_task';
};

export type PlanFlowProjection = {
  packet_version: 1;
  source: 'planflow_markdown_projection';
  nodes: PlanFlowNode[];
  edges: PlanFlowEdge[];
  warnings: string[];
};

export type MarkdownPlanningDocument = {
  sourcePath: string;
  content: string;
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'untitled';
}

function firstHeading(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

export function projectMarkdownPlanningDocuments(
  plan: MarkdownPlanningDocument,
): PlanFlowProjection {
  const planRouteId = `planflow:route:${slug(plan.sourcePath)}`;
  return {
    packet_version: 1,
    source: 'planflow_markdown_projection',
    nodes: [
      {
        id: planRouteId,
        type: 'PlanRoute',
        title: firstHeading(plan.content, 'PLAN.md'),
        source: 'plan_md',
        sourcePath: plan.sourcePath,
        provenance: `${plan.sourcePath} first-level heading`,
        status: 'running',
        links: [],
      },
    ],
    edges: [],
    warnings: [],
  };
}

async function resolvePlanningRoot(startPath: string): Promise<string> {
  const candidates = [
    path.resolve(startPath),
    path.resolve(startPath, '..'),
    path.resolve(startPath, '..', '..'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, 'PLAN.md'));
      return candidate;
    } catch {
      // Keep walking toward the repository root.
    }
  }
  throw new Error('planflow_planning_root_not_found');
}

export async function buildMarkdownPlanFlowProjection(
  startPath = process.cwd(),
): Promise<PlanFlowProjection> {
  const repoRoot = await resolvePlanningRoot(startPath);
  const planContent = await fs.readFile(path.join(repoRoot, 'PLAN.md'), 'utf8');
  return projectMarkdownPlanningDocuments({ sourcePath: 'PLAN.md', content: planContent });
}
