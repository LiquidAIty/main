import { describe, expect, it } from 'vitest';

import { projectMarkdownPlanningDocuments } from './planFlowProjection';

describe('PlanFlow markdown projection', () => {
  it('projects only the living PLAN.md with honest provenance', () => {
    const projection = projectMarkdownPlanningDocuments({
      sourcePath: 'PLAN.md',
      content: '# Current Route\n\nHuman-authored route.',
    });

    expect(projection.nodes).toEqual([
      expect.objectContaining({
        type: 'PlanRoute',
        title: 'Current Route',
        source: 'plan_md',
        sourcePath: 'PLAN.md',
      }),
    ]);
    expect(projection.nodes.every((node) => Boolean(node.provenance))).toBe(true);
    expect(projection.edges).toEqual([]);
    expect(projection.warnings).toEqual([]);
  });
});
