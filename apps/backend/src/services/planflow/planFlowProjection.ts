// @graph entity: PlanFlowMarkdownProjection
// @graph role: authoritative-markdown-to-planflow
// @graph relates_to: PlanFlow, PLAN.md, Specs
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type PlanFlowNodeType =
  | 'PlanRoute'
  | 'Spec'
  | 'Task'
  | 'Decision'
  | 'Assumption'
  | 'MissionSpecDraft'
  | 'MagenticOnePlan'
  | 'RuntimeRun'
  | 'Proof'
  | 'SkillReference'
  | 'CodeEvidenceReference'
  | 'ThinkGraphEvent';

export type PlanFlowSource =
  | 'plan_md'
  | 'spec_md'
  | 'task_ledger'
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

function statusFromText(value: string): PlanFlowStatus {
  const normalized = value.toLowerCase();
  if (/\b(blocked|blocking)\b/.test(normalized)) return 'blocked';
  if (/\b(failed|failure|error)\b/.test(normalized)) return 'failed';
  if (/\b(completed|complete|done|succeeded)\b/.test(normalized)) return 'complete';
  if (/\b(running|active|in progress|in-progress)\b/.test(normalized)) return 'running';
  if (/\b(approved|accepted)\b/.test(normalized)) return 'approved';
  if (/\b(pending|ready|queued)\b/.test(normalized)) return 'pending';
  return 'draft';
}

function documentStatus(content: string, fallback: PlanFlowStatus): PlanFlowStatus {
  const explicit = content.match(/^status:\s*(.+)$/im)?.[1]?.trim();
  return explicit ? statusFromText(explicit) : fallback;
}

function extractTaskNodes(document: MarkdownPlanningDocument, specId: string): PlanFlowNode[] {
  const lines = document.content.split(/\r?\n/);
  const tasks: PlanFlowNode[] = [];
  let inTaskSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const section = line.match(/^##\s+(.+)$/);
    if (section) {
      inTaskSection = /^(task ledger|task runs|tasks)$/i.test(section[1].trim());
      continue;
    }
    if (!inTaskSection) continue;

    const headingTask = line.match(/^###\s+(.+)$/);
    const checklistTask = line.match(/^\s*[-*]\s+\[(?: |x|X)\]\s+(.+)$/);
    const title = headingTask?.[1]?.trim() || checklistTask?.[1]?.trim();
    if (!title) continue;

    const context = lines.slice(index, Math.min(lines.length, index + 6)).join('\n');
    const id = `planflow:task:${slug(document.sourcePath)}:${slug(title)}`;
    tasks.push({
      id,
      type: 'Task',
      title,
      source: 'task_ledger',
      sourcePath: document.sourcePath,
      provenance: `${document.sourcePath} task section: ${title}`,
      status: statusFromText(context),
      links: [specId],
    });
  }

  return tasks;
}

export function projectMarkdownPlanningDocuments(
  plan: MarkdownPlanningDocument,
  specs: MarkdownPlanningDocument[],
): PlanFlowProjection {
  const planTitle = firstHeading(plan.content, 'PLAN.md');
  const planRouteId = `planflow:route:${slug(plan.sourcePath)}`;
  const nodes: PlanFlowNode[] = [
    {
      id: planRouteId,
      type: 'PlanRoute',
      title: planTitle,
      source: 'plan_md',
      sourcePath: plan.sourcePath,
      provenance: `${plan.sourcePath} first-level heading`,
      status: 'running',
      links: [],
    },
  ];
  const edges: PlanFlowEdge[] = [];

  specs
    .slice()
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
    .forEach((spec) => {
      const title = firstHeading(spec.content, path.basename(spec.sourcePath, '.md'));
      const specId = `planflow:spec:${slug(spec.sourcePath)}`;
      nodes.push({
        id: specId,
        type: 'Spec',
        title,
        source: 'spec_md',
        sourcePath: spec.sourcePath,
        provenance: `${spec.sourcePath} first-level heading`,
        status: documentStatus(spec.content, 'draft'),
        links: [planRouteId],
      });
      edges.push({
        id: `planflow:edge:${slug(planRouteId)}:${slug(specId)}`,
        source: planRouteId,
        target: specId,
        type: 'contains',
      });

      extractTaskNodes(spec, specId).forEach((task) => {
        nodes.push(task);
        edges.push({
          id: `planflow:edge:${slug(specId)}:${slug(task.id)}`,
          source: specId,
          target: task.id,
          type: 'defines_task',
        });
      });
    });

  const taskCount = nodes.filter((node) => node.type === 'Task').length;
  return {
    packet_version: 1,
    source: 'planflow_markdown_projection',
    nodes,
    edges,
    warnings:
      taskCount === 0
        ? ['planflow_task_extraction_pending: no parseable Task Ledger, Task Runs, or Tasks entries found']
        : [],
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
      await fs.access(path.join(candidate, 'specs'));
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
  const planPath = path.join(repoRoot, 'PLAN.md');
  const specsPath = path.join(repoRoot, 'specs');
  const [planContent, specNames] = await Promise.all([
    fs.readFile(planPath, 'utf8'),
    fs.readdir(specsPath),
  ]);
  const markdownSpecNames = specNames.filter((name) => name.toLowerCase().endsWith('.md'));
  const specContents = await Promise.all(
    markdownSpecNames.map(async (name) => ({
      sourcePath: `specs/${name}`,
      content: await fs.readFile(path.join(specsPath, name), 'utf8'),
    })),
  );
  return projectMarkdownPlanningDocuments(
    { sourcePath: 'PLAN.md', content: planContent },
    specContents,
  );
}
