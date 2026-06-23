import { describe, expect, it } from 'vitest';

import {
  resolveThinkGraphRole,
  unmappedThinkGraphTypes,
  THINKGRAPH_TYPE_ROLE,
} from './thinkGraphRoles';

// Live observed ThinkGraph vocabulary for the active project (node `type`).
const LIVE_THINKGRAPH_TYPES = ['task', 'company', 'ticker'];

describe('ThinkGraph project-reasoning role contract (structured type only)', () => {
  it('maps a real reasoning record (task) to a project role', () => {
    expect(resolveThinkGraphRole('task')).toBe('Task');
  });

  it('leaves entity references (company/ticker) explicitly unmapped', () => {
    expect(resolveThinkGraphRole('company')).toBeNull();
    expect(resolveThinkGraphRole('ticker')).toBeNull();
    expect(unmappedThinkGraphTypes(LIVE_THINKGRAPH_TYPES)).toEqual([
      'company',
      'ticker',
    ]);
  });

  it('maps the declared reasoning vocabulary without fabricating roles', () => {
    expect(resolveThinkGraphRole('hypothesis')).toBe('Hypothesis');
    expect(resolveThinkGraphRole('decision')).toBe('Decision');
    expect(resolveThinkGraphRole('approval')).toBe('Approval');
    expect(resolveThinkGraphRole('constraint')).toBe('Constraint');
    expect(resolveThinkGraphRole('outcome')).toBe('Outcome');
    expect(resolveThinkGraphRole('agent_run')).toBe('OperationalRun');
  });

  it('returns null for an unknown type (explicitly unmapped)', () => {
    expect(resolveThinkGraphRole('something_unknown')).toBeNull();
  });

  it('keeps ThinkGraph distinct — no KnowGraph storage classes leak in', () => {
    for (const k of ['Source', 'SearchPacket', 'ObservedEntity']) {
      expect(k in THINKGRAPH_TYPE_ROLE).toBe(false);
    }
  });
});
