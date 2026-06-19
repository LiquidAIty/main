import { describe, expect, it } from 'vitest';

import {
  buildGraphSeededSearchTasks,
  detectSearchConvergence,
  graphSearchSeedFromExtraction,
  type SearchAgentResultPacket,
} from './graphSeededSearchConvergence';

// Graph memory fixture (the accepted RDW/SpaceX record shape) — seeds come from GRAPH DATA,
// never raw user text.
const RDW_SPACEX_EXTRACTION = {
  entities: [
    { id: 'e_rdw', label: 'Redwire Corporation', type: 'company' },
    { id: 'e_rdw_ticker', label: 'RDW', type: 'ticker' },
    { id: 'e_spacex', label: 'SpaceX', type: 'company' },
  ],
  relations: [
    { from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies' },
    { from: 'e_t1', to: 'e_rdw', type: 'requires' },
    { from: 'e_t2', to: 'e_spacex', type: 'requires' },
  ],
  nextSearchSeedCandidates: ['live_market_data_for_RDW', 'private_market_sources_for_SpaceX'],
  sourceRefs: [{ ref: 'user_request_stream' }],
} as any;

const SEED = graphSearchSeedFromExtraction(RDW_SPACEX_EXTRACTION, { projectId: 'p', sourceRef: 'user_request_stream', freshness: 'P7D' });

// Three deterministic search-agent result packets with partial overlap.
const PACKET_A: SearchAgentResultPacket = {
  agentId: 'agent-rdw',
  searchTaskId: 't_entity_1',
  query: 'RDW Redwire Corporation current price live market data',
  sourceRefs: [{ ref: 'redwire-investor', url: 'https://www.redwirespace.com/investors', title: 'Redwire Investors', sourceType: 'web' }],
  entities: [
    { label: 'RDW', type: 'ticker', confidence: 0.9 },
    { label: 'Redwire Corporation', type: 'company', confidence: 0.95 },
  ],
  relations: [{ from: 'RDW', to: 'live_market_data', type: 'requires', confidence: 0.85 }],
  claims: [{ subject: 'RDW', predicate: 'last_close_source', object: 'marketdata_feed_a', sourceRef: 'redwire-investor', confidence: 0.6 }],
  uncertainty: ['live RDW price unknown until market-data lookup'],
};
const PACKET_B: SearchAgentResultPacket = {
  agentId: 'agent-spacex',
  searchTaskId: 't_entity_3',
  query: 'SpaceX private market valuation tender offer secondary market',
  sourceRefs: [{ ref: 'forge-secondary', url: 'https://forgeglobal.com/spacex', title: 'SpaceX secondary', sourceType: 'web' }],
  entities: [{ label: 'SpaceX', type: 'company', confidence: 0.95 }],
  relations: [{ from: 'SpaceX', to: 'secondary_market_sources', type: 'requires', confidence: 0.85 }],
  claims: [],
  uncertainty: ['SpaceX is private; no public stock price'],
};
const PACKET_C: SearchAgentResultPacket = {
  agentId: 'agent-infra',
  searchTaskId: 't_class_neighborhood',
  query: 'Redwire SpaceX suppliers space infrastructure public companies',
  // SHARED domain with packet A (overlap), plus a contradicting source for the same claim key.
  sourceRefs: [{ ref: 'redwire-investor', url: 'https://www.redwirespace.com/investors', title: 'Redwire Investors', sourceType: 'web' }],
  entities: [
    { label: 'Redwire Corporation', type: 'company', confidence: 0.9 },
    { label: 'SpaceX', type: 'company', confidence: 0.9 },
    { label: 'RDW', type: 'ticker', confidence: 0.8 },
    { label: 'space infrastructure suppliers', type: 'sector', confidence: 0.7 },
  ],
  relations: [{ from: 'Redwire Corporation', to: 'space infrastructure suppliers', type: 'supplies', confidence: 0.7 }],
  claims: [{ subject: 'RDW', predicate: 'last_close_source', object: 'investor_page_c', sourceRef: 'redwire-investor', confidence: 0.55 }],
  uncertainty: [],
};

describe('graph seed -> bounded deterministic search tasks (not user-intent classification)', () => {
  it('derives the seed from graph entities/relations/classes, not raw text', () => {
    expect(SEED.seedEntities).toEqual(['Redwire Corporation', 'RDW', 'SpaceX']);
    expect(SEED.seedRelations).toEqual(['identifies', 'requires']);
    expect(SEED.seedClasses).toEqual(['company', 'ticker']);
    expect(SEED.nextSearchSeedCandidates).toContain('live_market_data_for_RDW');
  });

  it('compiles bounded search tasks woven from graph entities/relations/classes', () => {
    const tasks = buildGraphSeededSearchTasks(SEED);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.length).toBeLessThanOrEqual(40);
    const allText = tasks.map((t) => t.query).join(' ').toLowerCase();
    expect(allText).toContain('redwire corporation'); // entity from graph
    expect(allText).toContain('requires'); // relation type from graph
    expect(allText).toContain('company'); // class from graph
    // every task is anchored to seed material (graph), never free user text
    expect(tasks.every((t) => (t.seedRefs.entities?.length || 0) + (t.seedRefs.relations?.length || 0) + (t.seedRefs.classes?.length || 0) > 0)).toBe(true);
    // the six task kinds are present
    for (const kind of ['entity', 'relation', 'class_neighborhood', 'contradiction', 'missing_source_ref', 'freshness']) {
      expect(tasks.some((t) => t.kind === kind)).toBe(true);
    }
  });

  it('introduces no draft-generator naming', () => {
    expect(JSON.stringify(buildGraphSeededSearchTasks(SEED)).toLowerCase()).not.toContain('draft');
  });
});

describe('convergence detection across RDW/SpaceX result packets (partial convergence)', () => {
  const report = detectSearchConvergence([PACKET_A, PACKET_B, PACKET_C], SEED);

  it('detects repeated entities across agents', () => {
    const lower = report.repeatedEntities.map((e) => e.toLowerCase());
    expect(lower).toContain('redwire corporation');
    expect(lower).toContain('spacex');
    expect(lower).toContain('rdw');
  });

  it('detects repeated relations across agents', () => {
    expect(report.repeatedRelations.map((r) => r.toLowerCase())).toContain('requires');
  });

  it('detects overlapping sourceRefs (shared domain)', () => {
    expect(report.overlappingSourceRefs).toContain('redwirespace.com');
  });

  it('reports stable class neighborhoods', () => {
    expect(report.stableClasses.map((c) => c.toLowerCase())).toContain('company');
  });

  it('scores partial convergence (> 0) but does not declare converged on thin support', () => {
    expect(report.convergenceScore).toBeGreaterThan(0);
    expect(report.converged).toBe(false);
    expect(report.stopReason).toBe('needs_more_sources');
  });

  it('preserves unresolved contradictions (different source for same claim key)', () => {
    expect(report.unresolvedContradictions.length).toBeGreaterThan(0);
    expect(report.unresolvedContradictions.join(' ').toLowerCase()).toContain('last_close_source');
  });

  it('produces next search seed candidates for the gaps', () => {
    expect(report.nextSearchSeedCandidates.length).toBeGreaterThan(0);
    // the singleton entity (only one packet) should be queued for corroboration
    expect(report.nextSearchSeedCandidates.join(' ').toLowerCase()).toContain('space infrastructure suppliers');
  });

  it('invents no RDW price and no SpaceX public stock price', () => {
    const blob = JSON.stringify(report).toLowerCase();
    expect(blob).not.toMatch(/\$\s?\d/); // no dollar amount asserted
    expect(blob).not.toMatch(/spacex[^.]{0,30}(stock price|share price|ticker)/);
  });
});

describe('novelty falls as later packets repeat known graph facts', () => {
  it('a repeating final packet has lower novelty than an all-new final packet', () => {
    const repeatingFinal: SearchAgentResultPacket = { ...PACKET_C, entities: PACKET_A.entities, relations: PACKET_A.relations, sourceRefs: PACKET_A.sourceRefs, claims: [] };
    const allNewFinal: SearchAgentResultPacket = {
      ...PACKET_C,
      entities: [{ label: 'NewCo', type: 'company' }, { label: 'OtherCo', type: 'company' }],
      relations: [{ type: 'partners' }],
      sourceRefs: [{ ref: 'n', url: 'https://newdomain.example/a' }],
      claims: [],
    };
    const novRepeat = detectSearchConvergence([PACKET_A, PACKET_B, repeatingFinal]).noveltyScore;
    const novNew = detectSearchConvergence([PACKET_A, PACKET_B, allNewFinal]).noveltyScore;
    expect(novRepeat).toBeLessThan(novNew);
  });
});
