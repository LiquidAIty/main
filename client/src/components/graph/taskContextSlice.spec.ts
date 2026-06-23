import { describe, expect, it } from 'vitest';

import {
  collectRepresentedRawRefs,
  validateTaskContextSlice,
  type TaskContextSlice,
} from './taskContextSlice';
import type { CodeGraphScope } from '../codegraph/codeGraphScope';

function makeSlice(over: Partial<TaskContextSlice> = {}): TaskContextSlice {
  return {
    taskId: 't1',
    projectId: '20ac92da-01fd-4cf6-97cc-0672421e751a',
    purpose: 'demo',
    selectedBy: 'task-ledger',
    thinkGraphRefs: [{ graphKind: 'thinkgraph', rawId: 'tg:task-1' }],
    knowGraphRefs: [],
    selectionReason: 'explicit task selection',
    ...over,
  };
}

describe('TaskContextSlice — explicit, reversible, no merge/inference', () => {
  it('validates a slice with explicit refs and empty KnowGraph refs', () => {
    expect(validateTaskContextSlice(makeSlice())).toEqual({ ok: true, errors: [] });
  });

  it('every ref preserves graph kind + raw id (reversible)', () => {
    const slice = makeSlice({
      thinkGraphRefs: [{ graphKind: 'thinkgraph', rawId: 'tg:task-1' }],
      knowGraphRefs: [{ graphKind: 'knowgraph', rawId: 'kg:rdw' }],
    });
    const refs = collectRepresentedRawRefs(slice);
    expect(refs).toContainEqual({ graphKind: 'thinkgraph', rawId: 'tg:task-1' });
    expect(refs).toContainEqual({ graphKind: 'knowgraph', rawId: 'kg:rdw' });
  });

  it('rejects cross-store mixing (a knowgraph ref in the thinkgraph bucket)', () => {
    const bad = makeSlice({
      thinkGraphRefs: [{ graphKind: 'knowgraph', rawId: 'kg:x' } as any],
    });
    expect(validateTaskContextSlice(bad).ok).toBe(false);
  });

  it('requires explicit identity + rationale', () => {
    expect(validateTaskContextSlice(makeSlice({ taskId: '' })).ok).toBe(false);
    expect(validateTaskContextSlice(makeSlice({ selectionReason: '' })).ok).toBe(false);
  });

  it('empty KnowGraph refs is valid (knowledge only when explicitly selected)', () => {
    const slice = makeSlice({ knowGraphRefs: [] });
    expect(validateTaskContextSlice(slice).ok).toBe(true);
    expect(collectRepresentedRawRefs(slice).some((r) => r.graphKind === 'knowgraph')).toBe(
      false,
    );
  });
});

describe('Static trading task-slice fixture — no automatic graph merge', () => {
  // FIXTURE ONLY. No trading code, no bot, no provider — this proves the selection rule.
  const strategyScope: CodeGraphScope = {
    repositoryId: 'C-Projects-main',
    rootPath: 'C:/Projects/main',
    folderPath: 'services/strategy',
    moduleIds: ['mod:sma_ema_rsi_crossover'],
    testIds: ['test:sma_ema_rsi_crossover_spec'],
    includeTests: true,
    representedRawNodeIds: ['cg:101', 'cg:102', 'cg:103'],
    representedRawEdgeIds: ['cg:e1'],
  };

  const tradingSlice: TaskContextSlice = {
    taskId: 'task-adapt-trading-style',
    projectId: '20ac92da-01fd-4cf6-97cc-0672421e751a',
    purpose: 'Adapt a user-selected trading style into a tested Python paper strategy',
    selectedBy: 'task-ledger',
    codeGraphScope: strategyScope,
    thinkGraphRefs: [
      { graphKind: 'thinkgraph', rawId: 'tg:task-adapt' },
      { graphKind: 'thinkgraph', rawId: 'tg:approval-1' },
      { graphKind: 'thinkgraph', rawId: 'tg:constraint-risk' },
    ],
    // KnowGraph intentionally empty — even though the task is about a ticker (RDW),
    // no evidence/EDGAR slice is auto-attached. Knowledge is opt-in only.
    knowGraphRefs: [],
    selectionReason:
      'Coder needs the strategy module, its tests, and the approved task/constraints only',
  };

  it('is a valid, explicitly-scoped slice', () => {
    expect(validateTaskContextSlice(tradingSlice)).toEqual({ ok: true, errors: [] });
  });

  it('does NOT auto-attach KnowGraph just because the task mentions a ticker', () => {
    expect(tradingSlice.knowGraphRefs).toEqual([]);
    const refs = collectRepresentedRawRefs(tradingSlice);
    expect(refs.some((r) => r.graphKind === 'knowgraph')).toBe(false);
  });

  it('selects only the explicit code slice (not the whole repo)', () => {
    const refs = collectRepresentedRawRefs(tradingSlice);
    const codeRefs = refs.filter((r) => r.graphKind === 'codegraph');
    expect(codeRefs.map((r) => r.rawId)).toEqual(['cg:101', 'cg:102', 'cg:103']);
  });

  it('preserves every graph kind + raw id across the slice', () => {
    const refs = collectRepresentedRawRefs(tradingSlice);
    expect(refs.filter((r) => r.graphKind === 'thinkgraph')).toHaveLength(3);
    expect(refs.filter((r) => r.graphKind === 'codegraph')).toHaveLength(3);
    for (const r of refs) expect(r.rawId).toBeTruthy();
  });
});
