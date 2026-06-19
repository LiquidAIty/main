import { describe, expect, it } from 'vitest';

import { MAX_TASK_GROUNDING_SCORE, scoreTaskGrounding } from './taskGroundingScore';

// Ungrounded fixture: the kind of output produced with NO graph memory — generic tasks, an
// empty graphPayload, no sourceRef, and no use of the prior accepted facts (says "RDW", never
// the graph's "Redwire Corporation", no "user_request_stream").
const UNGROUNDED = {
  taskObjects: [
    { id: 't1', title: 'Fetch live RDW market price', detail: 'Use a real-time market-data tool to retrieve the current RDW quote.', proofNeeded: 'current RDW quote with timestamp' },
    { id: 't2', title: 'Collect SpaceX private-market valuation data', detail: 'Query private-market sources for SpaceX valuation ranges and tender references.' },
    { id: 't3', title: 'Propose research agents and tools' },
  ],
  graphPayload: { entities: [], relations: [], sourceRef: '', uncertainty: ['No live RDW price available without external data source'] },
};

// Grounded fixture: output produced WITH the prior accepted RDW/SpaceX graph facts — names
// "Redwire Corporation", carries the "user_request_stream" sourceRef forward, treats SpaceX as
// private, makes a live-quote LOOKUP task (no invented price).
const GROUNDED = {
  taskObjects: [
    { id: 't1', title: 'Fetch live RDW market quote', detail: 'Use an approved market-data tool to retrieve the real-time price for RDW (Redwire Corporation).', proofNeeded: 'time-stamped RDW quote', sourceRef: 'user_request_stream' },
    { id: 't2', title: 'Research SpaceX private-market valuation', detail: 'Gather source-backed SpaceX private-market valuations from secondary-market / tender sources.' },
  ],
  graphPayload: {
    entities: [
      { id: 'e_rdw', label: 'Redwire Corporation', type: 'company' },
      { id: 'e_spacex', label: 'SpaceX', type: 'company' },
    ],
    relations: [{ from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies' }],
    assertions: [{ subject: 'e_spacex', predicate: 'has_public_stock_price', object: 'false' }],
    sourceRefs: [{ ref: 'user_request_stream', kind: 'user' }],
    uncertainty: ['Live RDW price unknown until lookup'],
  },
};

// Distinctive graph tokens that a naive (ungrounded) answer would NOT produce — the full
// entity label and the graph sourceRef. Bare tickers (RDW/SpaceX) are in the request itself,
// so they are not evidence of grounding.
const PROVIDED_GRAPH_FACTS = ['Redwire Corporation', 'user_request_stream'];

describe('task grounding score (deterministic, measurable loop proof)', () => {
  it('scores grounded output strictly higher than ungrounded output', () => {
    const ungrounded = scoreTaskGrounding({ ...UNGROUNDED, providedGraphFacts: PROVIDED_GRAPH_FACTS });
    const grounded = scoreTaskGrounding({ ...GROUNDED, providedGraphFacts: PROVIDED_GRAPH_FACTS });

    expect(grounded.total).toBeGreaterThan(ungrounded.total);
    expect(grounded.total).toBe(MAX_TASK_GROUNDING_SCORE);
    // The improvement is specifically: sourceRef preserved + prior graph facts used.
    expect(ungrounded.failed).toContain('missing_sourceref_or_graph_ref');
    expect(ungrounded.failed).toContain('did_not_use_provided_graph_facts');
    expect(grounded.failed).toHaveLength(0);
    expect(grounded.usedGraphFacts).toContain('redwire corporation');
    expect(grounded.usedGraphFacts).toContain('user_request_stream');
  });

  it('flags an invented current RDW price as a hallucination', () => {
    const score = scoreTaskGrounding({
      rawText: 'RDW is currently trading at $18.42 per share. SpaceX is private.',
      providedGraphFacts: PROVIDED_GRAPH_FACTS,
    });
    expect(score.hallucinationFlags).toContain('invented_current_price');
    expect(score.failed).toContain('invented_unknown_or_proof');
  });

  it('flags an invented SpaceX public stock price', () => {
    const score = scoreTaskGrounding({
      rawText: 'SpaceX stock price is up today; RDW Redwire quote pending. sourceRef: user_request_stream',
    });
    expect(score.hallucinationFlags).toContain('invented_spacex_public_price');
  });

  it('flags import/export trade drift', () => {
    const score = scoreTaskGrounding({
      rawText: 'Research RDW and SpaceX HS codes and customs tariff data via UN Comtrade. SpaceX is private.',
    });
    expect(score.hallucinationFlags).toContain('import_export_trade_drift');
    expect(score.failed).toContain('import_export_drift');
  });

  it('does not credit an empty sourceRef as a graph reference', () => {
    const score = scoreTaskGrounding({ graphPayload: { sourceRef: '', sourceRefs: [] } });
    expect(score.failed).toContain('missing_sourceref_or_graph_ref');
  });
});
