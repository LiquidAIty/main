import { describe, expect, it } from 'vitest';

import { projectMarkdownPlanningDocuments } from './planFlowProjection';

describe('PlanFlow markdown projection', () => {
  it('projects PLAN.md, specs, and task-ledger entries with honest provenance', () => {
    const projection = projectMarkdownPlanningDocuments(
      {
        sourcePath: 'PLAN.md',
        content: '# Current Route\n\nHuman-authored route.',
      },
      [
        {
          sourcePath: 'specs/runtime.md',
          content: '# Runtime Spec\n\n## Task Runs\n\n### T001 - Keep runtime real\n\nStatus: completed',
        },
      ],
    );

    expect(projection.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'PlanRoute',
          title: 'Current Route',
          source: 'plan_md',
          sourcePath: 'PLAN.md',
        }),
        expect.objectContaining({
          type: 'Spec',
          title: 'Runtime Spec',
          source: 'spec_md',
          sourcePath: 'specs/runtime.md',
        }),
        expect.objectContaining({
          type: 'Task',
          title: 'T001 - Keep runtime real',
          source: 'task_ledger',
          status: 'complete',
        }),
      ]),
    );
    expect(projection.nodes.some((node) => ['magentic_one', 'sol', 'model'].includes(node.source))).toBe(false);
    expect(projection.nodes.every((node) => Boolean(node.provenance))).toBe(true);
    expect(projection.edges).toHaveLength(2);
  });
});
