import { describe, expect, it, vi } from 'vitest';

import { applyActiveGraphContextDelta, type NeighborhoodAssertion } from './activeGraphContext';
import {
  buildActiveGraphContextHybrid,
  buildFullTextQuery,
  isEmbeddingConfigured,
  retrieveHybridKnowGraphContext,
} from './activeGraphContextHybrid';

const PROJECT_ID = '20ac92da-01fd-4cf6-97cc-0672421e751a';
const TASK = { projectId: PROJECT_ID, taskId: 't1', anchors: [{ label: 'Redwire Corporation', type: 'company' }, { label: 'SpaceX', type: 'company' }] };

const EXACT: NeighborhoodAssertion[] = [
  { id: 'a1', subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RDW', outcome: 'supported', sourceRef: 's1', sourceUrl: 'https://finance.yahoo.com/quote/RDW', sourceTitle: 'RDW Yahoo', anchorLabel: 'Redwire Corporation', contradictsIds: [] },
  { id: 'a2', subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RWE', outcome: 'contradicted', sourceRef: 's2', sourceUrl: 'https://example.com/rwe', sourceTitle: 'RWE', anchorLabel: 'Redwire Corporation', contradictsIds: ['a1'] },
  { id: 'a3', subject: 'SpaceX', predicate: 'has_current_valuation', object: 'unknown', outcome: 'uncertain', sourceRef: 's3', sourceUrl: 'https://forgeglobal.com/spacex', sourceTitle: 'SpaceX', anchorLabel: 'SpaceX', contradictsIds: [] },
];
const FT: NeighborhoodAssertion[] = [
  { id: 'ft1', subject: 'Redwire Corporation', predicate: 'is_a', object: 'space infrastructure company', outcome: 'supported', sourceRef: 's5', sourceUrl: 'https://seekingalpha.com/symbol/RDW', sourceTitle: 'Redwire space infrastructure', anchorLabel: 'Redwire Corporation', contradictsIds: [], retrievalReasons: ['fulltext_exact_match'] },
];
const VEC: NeighborhoodAssertion[] = [
  { id: 'v1', subject: 'SpaceX', predicate: 'related_to', object: 'launch market', outcome: 'supported', sourceRef: 's6', sourceUrl: 'https://example.com/launch', sourceTitle: 'Launch market', anchorLabel: 'SpaceX', contradictsIds: [], retrievalReasons: ['semantic_similarity'] },
];

function fakeDriver() {
  const runs: Array<{ cypher: string; params: any }> = [];
  const session = { run: vi.fn(async (cypher: string, params: any) => { runs.push({ cypher, params }); return { records: [] }; }), close: vi.fn(async () => {}) };
  return { driver: { session: vi.fn(() => session) } as any, runs };
}

describe('full-text query + embedding capability', () => {
  it('builds a Lucene-safe OR query and escapes operators', () => {
    const q = buildFullTextQuery(['Redwire Corporation', 'RDW'], ['ticker:symbol']);
    expect(q).toContain('"Redwire Corporation"');
    expect(q).toContain(' OR ');
    expect(q).not.toContain(':'); // operator escaped
  });
  it('reports embedding unavailable without a configured model', () => {
    expect(isEmbeddingConfigured({} as any)).toBe(false);
    expect(isEmbeddingConfigured({ EMBEDDING_MODEL: 'm', OPENROUTER_API_KEY: 'k' } as any)).toBe(true);
  });
});

describe('default hybrid Neo4j queries are bounded + project-scoped (no whole-graph scan)', () => {
  it('full-text + one-hop cyphers are project-scoped, capped, and one-hop only', async () => {
    const { driver, runs } = fakeDriver();
    await retrieveHybridKnowGraphContext(
      { projectId: PROJECT_ID, anchorLabels: ['Redwire Corporation'], maxHops: 1, maxNodes: 8, maxEvidence: 6, include: ['supported_assertions'] },
      { driver, env: {} as any, ensureIndexes: false, readExact: async () => ({ ok: true, assertions: [EXACT[0]] }) },
    );
    const blob = runs.map((r) => r.cypher).join('\n');
    expect(blob).toContain("db.index.fulltext.queryNodes('kg_assertion_fulltext'");
    expect(blob).toContain('node.project_id = $projectId'); // fulltext project-scoped
    expect(blob).toMatch(/LIMIT \d+/); // capped
    expect(blob).toContain(':`CONTRADICTS`'); // one-hop expansion rel
    expect(blob).toContain('a.id IN $ids'); // expansion seeded from selected ids only
    expect(blob).not.toMatch(/MATCH \(n \{ ?project_id/); // NOT a whole-project dump
  });
});

describe('hybrid merge + vector modes', () => {
  it('merges exact + full-text + (mocked) vector with retrieval reasons', async () => {
    const { neighborhood, diagnostics } = await retrieveHybridKnowGraphContext(
      { projectId: PROJECT_ID, anchorLabels: ['Redwire Corporation', 'SpaceX'], maxHops: 1, maxNodes: 12, maxEvidence: 8, include: ['supported_assertions'] },
      {
        env: {} as any,
        readExact: async () => ({ ok: true, assertions: EXACT }),
        fullTextSearch: async () => FT,
        embed: async () => [0.1, 0.2, 0.3],
        vectorSearch: async () => VEC,
        oneHopExpand: async () => [],
      },
    );
    expect(diagnostics.vectorMode).toBe('ran');
    expect(diagnostics.exactCount).toBe(3);
    expect(diagnostics.fulltextCount).toBe(1);
    expect(diagnostics.vectorCount).toBe(1);
    const ids = neighborhood.ok ? neighborhood.assertions.map((a) => a.id) : [];
    expect(ids).toEqual(expect.arrayContaining(['a1', 'ft1', 'v1']));
    const ft = neighborhood.ok ? neighborhood.assertions.find((a) => a.id === 'ft1') : undefined;
    expect(ft?.retrievalReasons).toContain('fulltext_exact_match');
    const vec = neighborhood.ok ? neighborhood.assertions.find((a) => a.id === 'v1') : undefined;
    expect(vec?.retrievalReasons).toContain('semantic_similarity');
  });

  it('reports an HONEST vector-unavailable blocker when no embedding is configured', async () => {
    const { diagnostics } = await retrieveHybridKnowGraphContext(
      { projectId: PROJECT_ID, anchorLabels: ['SpaceX'], maxHops: 1, maxNodes: 8, maxEvidence: 6, include: ['supported_assertions'] },
      { env: {} as any, readExact: async () => ({ ok: true, assertions: [EXACT[2]] }), fullTextSearch: async () => [], oneHopExpand: async () => [] },
    );
    expect(diagnostics.vectorMode).toBe('unavailable');
    expect(diagnostics.vectorCount).toBe(0);
    expect(diagnostics.vectorBlocker).toContain('embedding_not_configured');
  });

  it('dedupes a record returned by both exact and full-text into one node', async () => {
    const dup: NeighborhoodAssertion = { ...EXACT[0], retrievalReasons: ['fulltext_exact_match'] };
    const { neighborhood } = await retrieveHybridKnowGraphContext(
      { projectId: PROJECT_ID, anchorLabels: ['Redwire Corporation'], maxHops: 1, maxNodes: 8, maxEvidence: 6, include: ['supported_assertions'] },
      { env: {} as any, readExact: async () => ({ ok: true, assertions: [EXACT[0]] }), fullTextSearch: async () => [dup], oneHopExpand: async () => [] },
    );
    const a1s = neighborhood.ok ? neighborhood.assertions.filter((a) => a.id === 'a1') : [];
    expect(a1s).toHaveLength(1);
    expect(a1s[0].retrievalReasons).toEqual(expect.arrayContaining(['direct_task_anchor', 'fulltext_exact_match']));
  });

  it('one-hop expansion is seeded only from the top retrieved ids (bounded)', async () => {
    const spyExpand = vi.fn(async () => []);
    await retrieveHybridKnowGraphContext(
      { projectId: PROJECT_ID, anchorLabels: ['Redwire Corporation', 'SpaceX'], maxHops: 1, maxNodes: 8, maxEvidence: 6, include: ['supported_assertions'] },
      { env: {} as any, readExact: async () => ({ ok: true, assertions: EXACT }), fullTextSearch: async () => FT, oneHopExpand: spyExpand },
    );
    expect(spyExpand).toHaveBeenCalledTimes(1);
    const arg = spyExpand.mock.calls[0][0] as any;
    expect(arg.assertionIds.length).toBeLessThanOrEqual(5);
    expect(arg.projectId).toBe(PROJECT_ID);
  });
});

describe('buildActiveGraphContextHybrid (extends ActiveGraphContext)', () => {
  function deps(spyCode = vi.fn(async () => ({ ok: true, files: [] }))) {
    return {
      env: {} as any,
      readExact: async () => ({ ok: true, assertions: EXACT }),
      fullTextSearch: async () => FT,
      oneHopExpand: async () => [],
      readThinkGraph: async () => ({ ok: true, facts: [{ label: 'Redwire Corporation' }] }),
      readCodeContext: spyCode,
      spyCode,
    } as any;
  }

  it('produces a bounded context merging exact + full-text; CodeGraph stays off for research; ThinkGraph present', async () => {
    const d = deps();
    const { context, retrieval } = await buildActiveGraphContextHybrid(TASK, d, { maxNodes: 12 });
    expect(context.facts.length).toBeLessThanOrEqual(12);
    expect(context.facts.some((f) => f.object === 'RDW')).toBe(true); // exact
    expect(context.facts.some((f) => /infrastructure/.test(f.object))).toBe(true); // full-text
    expect(context.contradictions.join(' ')).toContain('RWE');
    expect(context.unresolvedQuestions.join(' ').toLowerCase()).toContain('spacex');
    expect((d as any).spyCode).not.toHaveBeenCalled(); // research task -> no CodeGraph
    expect(context.sourceStats.codeGraph).toBe(0);
    expect(context.sourceStats.thinkGraph).toBe(1);
    expect(retrieval.vectorMode).toBe('unavailable');
    expect(retrieval.vectorBlocker).toContain('embedding_not_configured');
    // a full-text item carries its retrieval reason into the evidence reason
    expect(context.evidence.some((e) => /fulltext_exact_match/.test(e.reason))).toBe(true);
  });

  it('a new full-text result appears only in the delta on the next update; stable not resent', async () => {
    const { context } = await buildActiveGraphContextHybrid(TASK, deps(), { maxNodes: 12 });
    const priorFacts = context.facts.length;
    const updated = applyActiveGraphContextDelta(context, { facts: [{ subject: 'Redwire Corporation', predicate: 'partners_with', object: 'NASA', outcome: 'supported', sourceRef: 'sNew' }] });
    expect(updated.delta.addedFacts.length).toBe(1);
    expect(updated.facts.length).toBe(priorFacts + 1);
  });
});
