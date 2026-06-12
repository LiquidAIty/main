import { describe, expect, it } from 'vitest';

import type { DeckRun, PlanFlowProjection } from '../../../types/agentgraph';
import { buildPlanFlowMissionGraph, projectRealMagenticPlans } from './planFlowProjection';

describe('PlanFlow projection adapter', () => {
  it('preserves markdown provenance and does not invent planner provenance', () => {
    const markdown: PlanFlowProjection = {
      packet_version: 1,
      source: 'planflow_markdown_projection',
      nodes: [
        {
          id: 'route',
          type: 'PlanRoute',
          title: 'Route',
          source: 'plan_md',
          sourcePath: 'PLAN.md',
          provenance: 'PLAN.md heading',
          status: 'running',
          links: [],
        },
      ],
      edges: [],
      warnings: [],
    };

    const graph = buildPlanFlowMissionGraph(markdown, null);

    expect(graph.nodes[0]?.data).toMatchObject({
      kind: 'PlanRoute',
      source: 'plan_md',
      sourcePath: 'PLAN.md',
      provenance: 'PLAN.md heading',
    });
    expect(graph.nodes.some((node) => node.data.source === 'magentic_one')).toBe(false);
  });

  it('uses magentic_one provenance only for a real runtime magentic trace plan', () => {
    const run = {
      id: 'run-1',
      steps: [
        {
          id: 'step-1',
          title: 'Magentic-One',
          magenticTrace: {
            plan: {
              summary: 'Real proposal',
              task_ledger: { task_plan: '1. Inspect evidence\n2. Run proof' },
            },
          },
        },
      ],
    } as DeckRun;

    const projection = projectRealMagenticPlans(run);

    expect(projection.nodes[0]).toMatchObject({
      type: 'MagenticOnePlan',
      source: 'magentic_one',
      title: 'Real proposal',
    });
    expect(projection.nodes.filter((node) => node.type === 'Task')).toHaveLength(2);
  });

  it('lays out markdown nodes as readable route, spec, and task lanes', () => {
    const markdown = {
      packet_version: 1,
      source: 'planflow_markdown_projection',
      nodes: [
        {
          id: 'route',
          type: 'PlanRoute',
          title: 'Route',
          source: 'plan_md',
          sourcePath: 'PLAN.md',
          provenance: 'PLAN.md',
          status: 'running',
          links: [],
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `spec-${index}`,
          type: 'Spec' as const,
          title: `Spec ${index}`,
          source: 'spec_md' as const,
          sourcePath: `specs/${index}.md`,
          provenance: `specs/${index}.md`,
          status: 'pending' as const,
          links: ['route'],
        })),
        {
          id: 'task',
          type: 'Task',
          title: 'Task',
          source: 'task_ledger',
          sourcePath: 'specs/tasks.md',
          provenance: 'Task ledger',
          status: 'pending',
          links: ['spec-0'],
        },
      ],
      edges: [],
      warnings: [],
    } satisfies PlanFlowProjection;

    const graph = buildPlanFlowMissionGraph(markdown, null);
    const route = graph.nodes.find((node) => node.id === 'route');
    const specs = graph.nodes.filter((node) => node.data.kind === 'Spec');
    const task = graph.nodes.find((node) => node.id === 'task');

    expect(new Set(specs.map((node) => node.position.x)).size).toBeGreaterThan(1);
    expect(Math.max(...specs.map((node) => node.position.y))).toBeLessThan(task!.position.y);
    expect(route!.position.y).toBeLessThan(Math.min(...specs.map((node) => node.position.y)));
  });
});
