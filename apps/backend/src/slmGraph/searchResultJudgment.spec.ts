import { describe, expect, it, vi } from 'vitest';

import {
  FORBIDDEN_REL_TYPES,
  judgeAndIngestSearchPacketsToKnowGraph,
  judgeSearchPackets,
  type AssertionTarget,
} from './searchResultJudgment';
import type { SearchAgentResultPacket } from './graphSeededSearchConvergence';

const PROJECT_ID = '20ac92da-01fd-4cf6-97cc-0672421e751a';
const RUN_ID = 'judge-run-test';
const GRAPH_SEED_REF = 'user_request_stream';

// Deterministic RDW/SpaceX source packets (titles are the source text Tavily already returns).
const PACKETS: SearchAgentResultPacket[] = [
  { agentId: 'a1', searchTaskId: 't_rdw', query: 'Redwire RDW ticker',
    sourceRefs: [{ ref: 's1', url: 'https://finance.yahoo.com/quote/RDW', title: 'Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol', sourceType: 'web' }],
    entities: [{ label: 'Redwire Corporation' }], relations: [], claims: [], uncertainty: [] },
  { agentId: 'a2', searchTaskId: 't_rdw_conflict', query: 'Redwire ticker',
    sourceRefs: [{ ref: 's2', url: 'https://example.com/redwire-rwe', title: 'Redwire Space trades under ticker symbol RWE on the exchange', sourceType: 'web' }],
    entities: [{ label: 'Redwire Corporation' }], relations: [], claims: [], uncertainty: [] },
  { agentId: 'a3', searchTaskId: 't_spacex', query: 'SpaceX valuation',
    sourceRefs: [{ ref: 's3', url: 'https://forgeglobal.com/spacex', title: 'SpaceX private company valuation news on the secondary market', sourceType: 'web' }],
    entities: [{ label: 'SpaceX' }], relations: [], claims: [], uncertainty: [] },
];

const TARGETS: AssertionTarget[] = [
  { subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', expectedObject: 'RDW', predicateEvidenceTokens: ['ticker', 'symbol', 'nyse', 'nasdaq', 'quote', 'stock'], objectKind: 'ticker' },
  { subject: 'SpaceX', predicate: 'has_current_valuation', unknownObject: true, predicateEvidenceTokens: ['valuation', 'valued', 'worth', 'market cap', 'tender', 'secondary', 'funding'] },
];

const BASE = { projectId: PROJECT_ID, runId: RUN_ID, graphSeedRef: GRAPH_SEED_REF, targets: TARGETS, packets: PACKETS };

function fakeDriver() {
  const runs: Array<{ cypher: string; params: any }> = [];
  const session = { run: vi.fn(async (cypher: string, params: any) => { runs.push({ cypher, params }); return { records: [] }; }), close: vi.fn(async () => {}) };
  const driver = { session: vi.fn(() => session) } as any;
  return { driver, session, runs };
}

describe('judgeSearchPackets (direct title/snippet judgment, no candidate stage)', () => {
  const assertions = judgeSearchPackets(BASE);

  it('produces a SUPPORTED assertion only when the source text supports it', () => {
    const supported = assertions.find((a) => a.subject === 'Redwire Corporation' && a.object === 'RDW');
    expect(supported?.outcome).toBe('supported');
    expect(supported?.sourceRef).toBeTruthy();
    expect(supported?.sourceUrl).toContain('yahoo');
  });

  it('produces UNCERTAINTY for a value-seeking target with no figure in the snippet (never invents)', () => {
    const sx = assertions.find((a) => a.subject === 'SpaceX');
    expect(sx?.outcome).toBe('uncertain');
    expect(sx?.object).toBe('unknown');
    expect((sx?.uncertainty || []).join(' ').toLowerCase()).toContain('did not contain a dated');
    expect(sx?.sourceRef).toBeTruthy();
  });

  it('stores a CONTRADICTING source assertion (not overwrite) and links the contradiction', () => {
    const conflict = assertions.find((a) => a.subject === 'Redwire Corporation' && a.object === 'RWE');
    const supported = assertions.find((a) => a.subject === 'Redwire Corporation' && a.object === 'RDW');
    expect(conflict?.outcome).toBe('contradicted');
    expect(supported?.outcome).toBe('supported'); // both stored, neither overwritten
    expect(conflict?.contradictsIds || []).toContain(supported?.id);
  });

  it('every assertion preserves a sourceRef and is project-scoped', () => {
    expect(assertions.every((a) => !!a.sourceRef)).toBe(true);
    expect(assertions.every((a) => a.projectId === PROJECT_ID)).toBe(true);
  });

  it('invents no RDW price and no SpaceX public ticker', () => {
    const blob = JSON.stringify(assertions).toLowerCase();
    expect(blob).not.toMatch(/\$\s?\d/);
    // no ticker-style assertion for SpaceX
    expect(assertions.some((a) => a.subject === 'SpaceX' && /ticker/.test(a.predicate))).toBe(false);
  });

  it('uses NO candidate/draft/promotion language in the output', () => {
    expect(JSON.stringify(assertions).toLowerCase()).not.toMatch(/candidate|draft|promotion|approval|review|queue/);
  });
});

describe('judgeAndIngestSearchPacketsToKnowGraph (direct KnowGraph write)', () => {
  it('writes assertions + safe relationships and returns outcome counts', async () => {
    const { driver, runs } = fakeDriver();
    const res = await judgeAndIngestSearchPacketsToKnowGraph(BASE, { driver });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outcomes.supported).toBeGreaterThanOrEqual(1);
    expect(res.outcomes.contradicted).toBeGreaterThanOrEqual(1);
    expect(res.outcomes.uncertain).toBeGreaterThanOrEqual(1);
    expect(res.contradictionLinks).toBeGreaterThanOrEqual(1);
    const cypherBlob = runs.map((r) => r.cypher).join('\n');
    expect(cypherBlob).toContain(':SourceBackedAssertion');
    expect(cypherBlob).toContain(':ASSERTED_BY_SOURCE');
    expect(cypherBlob).toContain(':CONTRADICTS');
    for (const banned of FORBIDDEN_REL_TYPES) expect(cypherBlob).not.toContain(`:${banned}`);
    expect(cypherBlob.toLowerCase()).not.toMatch(/candidate|promotion|approval|review queue/);
  });

  it('fails closed WITHOUT touching the DB on missing projectId', async () => {
    const { driver } = fakeDriver();
    const res = await judgeAndIngestSearchPacketsToKnowGraph({ ...BASE, projectId: '' }, { driver });
    expect(res.ok).toBe(false);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('fails closed WITHOUT touching the DB when there are no targets', async () => {
    const { driver } = fakeDriver();
    const res = await judgeAndIngestSearchPacketsToKnowGraph({ ...BASE, targets: [] }, { driver });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('targets_required');
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('introduces no draft-generator naming', () => {
    expect(JSON.stringify(judgeSearchPackets(BASE)).toLowerCase()).not.toContain('draft');
  });
});
