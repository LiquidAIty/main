import { describe, expect, it, vi } from 'vitest';

import {
  applyActiveGraphContextDelta,
  applyDiversity,
  buildActiveGraphContext,
  compileGraphQueryIntent,
  rankNeighborhood,
  readKnowGraphAnchorNeighborhood,
  renderActiveGraphContextForPrompt,
  type ActiveGraphContext,
  type ActiveGraphDeps,
  type NeighborhoodAssertion,
} from './activeGraphContext';

const PROJECT_ID = '20ac92da-01fd-4cf6-97cc-0672421e751a';
const ANCHORS = [{ label: 'Redwire Corporation', type: 'company' }, { label: 'SpaceX', type: 'company' }];

const NEIGHBORHOOD: NeighborhoodAssertion[] = [
  { id: 'a1', subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RDW', outcome: 'supported', sourceRef: 's1', sourceUrl: 'https://finance.yahoo.com/quote/RDW', sourceTitle: 'RDW Yahoo', confidence: 0.6, anchorLabel: 'Redwire Corporation', contradictsIds: [] },
  { id: 'a2', subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RWE', outcome: 'contradicted', sourceRef: 's2', sourceUrl: 'https://example.com/rwe', sourceTitle: 'RWE', confidence: 0.5, anchorLabel: 'Redwire Corporation', contradictsIds: ['a1'] },
  { id: 'a3', subject: 'SpaceX', predicate: 'has_current_valuation', object: 'unknown', outcome: 'uncertain', sourceRef: 's3', sourceUrl: 'https://forgeglobal.com/spacex', sourceTitle: 'SpaceX', confidence: 0.2, anchorLabel: 'SpaceX', contradictsIds: [] },
  // duplicate source ref (same s1) -> must dedupe to one evidence node
  { id: 'a4', subject: 'Redwire Corporation', predicate: 'is_a', object: 'PublicCompany', outcome: 'supported', sourceRef: 's1', sourceUrl: 'https://finance.yahoo.com/quote/RDW', sourceTitle: 'RDW Yahoo', confidence: 0.6, anchorLabel: 'Redwire Corporation', contradictsIds: [] },
];

function researchDeps(spyCode = vi.fn(async () => ({ ok: true, files: [{ path: 'apps/backend/x.ts', reason: 'task' }] }))): ActiveGraphDeps & { spyCode: any } {
  return {
    readNeighborhood: async () => ({ ok: true, assertions: NEIGHBORHOOD }),
    readThinkGraph: async () => ({ ok: true, facts: [{ label: 'Redwire Corporation' }] }),
    readCodeContext: spyCode,
    spyCode,
  } as any;
}

function fakeDriver() {
  const runs: Array<{ cypher: string; params: any }> = [];
  const session = { run: vi.fn(async (cypher: string, params: any) => { runs.push({ cypher, params }); return { records: [] }; }), close: vi.fn(async () => {}) };
  const driver = { session: vi.fn(() => session) } as any;
  return { driver, runs };
}

describe('compileGraphQueryIntent (from selected task, not raw text)', () => {
  it('builds a bounded intent and only includes code_context for code tasks', () => {
    const research = compileGraphQueryIntent({ projectId: PROJECT_ID, anchors: ANCHORS });
    expect(research.anchorLabels).toEqual(['Redwire Corporation', 'SpaceX']);
    expect(research.include).not.toContain('code_context');
    expect(research.maxNodes).toBeGreaterThan(0);
    const code = compileGraphQueryIntent({ projectId: PROJECT_ID, anchors: ANCHORS, isCodeTask: true });
    expect(code.include).toContain('code_context');
  });
});

describe('readKnowGraphAnchorNeighborhood (bounded, anchored, not a whole-project scan)', () => {
  it('issues an anchored + bounded query, excluding seen, with no broad project scan', async () => {
    const { driver, runs } = fakeDriver();
    await readKnowGraphAnchorNeighborhood(
      { projectId: PROJECT_ID, anchorLabels: ['Redwire Corporation'], maxHops: 1, maxNodes: 5, maxEvidence: 5, include: ['supported_assertions'], excludeSeenNodeIds: ['old1'] },
      { driver },
    );
    const cypher = runs[0].cypher;
    expect(cypher).toContain('e.label_lc IN $anchorLabels'); // anchored
    expect(cypher).toMatch(/LIMIT \d+/); // bounded (clamped integer interpolated)
    expect(cypher).toContain('NOT a.id IN $excludeIds'); // excludes seen
    expect(cypher).not.toMatch(/MATCH \(n \{ ?project_id/); // NOT a whole-project dump
    expect(runs[0].params.anchorLabels).toEqual(['redwire corporation']);
  });
});

describe('rank + diversity (deterministic, explainable)', () => {
  it('ranks contradictions/uncertainties/source-backed higher and returns reasons', () => {
    const ranked = rankNeighborhood(NEIGHBORHOOD, { anchorLabels: ['Redwire Corporation', 'SpaceX'] });
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
    expect(ranked.every((r) => typeof r.score === 'number')).toBe(true);
  });
  it('caps near-duplicate sources by domain', () => {
    const many: NeighborhoodAssertion[] = Array.from({ length: 6 }, (_, i) => ({ ...NEIGHBORHOOD[0], id: `d${i}`, object: `O${i}`, sourceUrl: 'https://samedomain.com/a' }));
    const out = applyDiversity(rankNeighborhood(many, { anchorLabels: ['Redwire Corporation'] }), { maxPerDomain: 2, max: 10 });
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe('buildActiveGraphContext (compact, task-scoped)', () => {
  it('includes supported facts, visible contradictions, uncertainties; dedupes sources; bounded', async () => {
    const deps = researchDeps();
    const ctx = await buildActiveGraphContext({ projectId: PROJECT_ID, taskId: 't1', anchors: ANCHORS }, deps, { maxNodes: 12 });
    expect(ctx.facts.some((f) => f.subject === 'Redwire Corporation' && f.object === 'RDW' && f.outcome === 'supported')).toBe(true);
    expect(ctx.contradictions.join(' ')).toContain('RWE');
    expect(ctx.unresolvedQuestions.join(' ').toLowerCase()).toContain('spacex');
    // s1 appears twice (a1 + a4) -> one evidence node
    expect(ctx.evidence.filter((e) => e.sourceRef === 's1')).toHaveLength(1);
    expect(ctx.facts.length).toBeLessThanOrEqual(12);
    expect(ctx.sourceStats.thinkGraph).toBe(1);
  });

  it('does NOT load CodeGraph for a pure research task (honest zero)', async () => {
    const deps = researchDeps();
    const ctx = await buildActiveGraphContext({ projectId: PROJECT_ID, anchors: ANCHORS }, deps);
    expect((deps as any).spyCode).not.toHaveBeenCalled();
    expect(ctx.codeContext).toEqual([]);
    expect(ctx.sourceStats.codeGraph).toBe(0);
  });

  it('loads CodeGraph for a selected code task', async () => {
    const deps = researchDeps();
    const ctx = await buildActiveGraphContext({ projectId: PROJECT_ID, anchors: ANCHORS, isCodeTask: true }, deps);
    expect((deps as any).spyCode).toHaveBeenCalledTimes(1);
    expect(ctx.codeContext?.length).toBe(1);
    expect(ctx.sourceStats.codeGraph).toBe(1);
  });
});

describe('applyActiveGraphContextDelta (rolling working cache)', () => {
  it('adds only NEW material to delta and keeps prior context stable', async () => {
    const first = await buildActiveGraphContext({ projectId: PROJECT_ID, taskId: 't1', anchors: ANCHORS }, researchDeps());
    const priorFactCount = first.facts.length;
    const updated = applyActiveGraphContextDelta(first, {
      facts: [
        // a brand-new uncertainty
        { subject: 'SpaceX', predicate: 'has_recent_tender', object: 'unknown', outcome: 'uncertain', sourceRef: 's9' },
        // a re-send of an existing fact (must NOT appear in delta)
        { subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RDW', outcome: 'supported', sourceRef: 's1' },
      ],
    });
    expect(updated.delta.addedFacts.length).toBe(1); // only the new one
    expect(updated.facts.length).toBe(priorFactCount + 1);
    expect(updated.unresolvedQuestions.join(' ')).toContain('has_recent_tender');
    // contradictions + earlier uncertainties survive
    expect(updated.contradictions.join(' ')).toContain('RWE');
  });

  it('drops cold supported facts from the prompt context (preserved in canonical graph)', () => {
    const prev: ActiveGraphContext = {
      projectId: PROJECT_ID, taskId: 't1', anchors: [{ id: 'e', label: 'A', reason: 'x' }],
      facts: Array.from({ length: 6 }, (_, i) => ({ subject: 'A', predicate: 'p', object: `O${i}`, outcome: 'supported' as const, sourceRef: `s${i}` })),
      relations: [], evidence: [], unresolvedQuestions: [], contradictions: [], codeContext: [],
      stableSummary: '', delta: { addedAnchors: [], addedFacts: [], addedEvidenceRefs: [], addedQuestions: [], removedAsCold: [] },
      sourceStats: { thinkGraph: 0, knowGraph: 6, codeGraph: 0 },
    };
    const updated = applyActiveGraphContextDelta(prev, { facts: [{ subject: 'A', predicate: 'p', object: 'NEW', outcome: 'uncertain', sourceRef: 'sNew' }] }, { budget: 4 });
    expect(updated.delta.removedAsCold.length).toBeGreaterThan(0);
    expect(updated.facts.length).toBeLessThan(7); // some cold supported facts dropped from prompt
    // the new uncertainty survives (added to facts, not dropped as cold)
    expect(updated.facts.some((f) => f.object === 'NEW')).toBe(true);
    expect(updated.delta.removedAsCold.every((k) => !k.includes('|new|'))).toBe(true);
  });
});

describe('prompt render is additive and preserves the OWL contract', () => {
  it('renders stable + delta + assertions + contradictions and keeps the graphPayload contract', async () => {
    const ctx = await buildActiveGraphContext({ projectId: PROJECT_ID, taskId: 't1', anchors: ANCHORS }, researchDeps());
    const text = renderActiveGraphContextForPrompt(ctx);
    expect(text).toContain('activeGraphContext');
    expect(text).toContain('stable:');
    expect(text).toContain('delta:');
    expect(text.toLowerCase()).toContain('rdw');
    expect(text).toMatch(/OWL graphPayload output contract intact/i);
    // additive, does NOT replace the task-ledger / graphPayload contract
    expect(text).not.toContain('planFlowTaskObjects');
    // no banned subsystem words
    expect(text.toLowerCase()).not.toMatch(/candidate|promotion|draft|vector|embedding|pareto|\blhs\b/);
  });
});
