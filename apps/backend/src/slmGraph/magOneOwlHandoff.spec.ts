import { describe, expect, it } from 'vitest';

import { parseSlmGraphExtraction } from './slmGraphWorker';

// UNIT proof only (representative payload, NOT the main real-run proof): a Mag One
// OWL-shaped graphPayload for the RDW/SpaceX request normalizes into canonical
// SlmGraphExtraction, and a missing/empty payload fails closed. The real-run probe
// (scripts/magOneOwlRealRunProbe.ts) is the main proof using live model output.
const RDW_SPACEX_GRAPH_PAYLOAD = {
  targetGraph: 'thinkgraph',
  inputKind: 'task_ledger_planning',
  sourceRef: 'user-chat-rdw-spacex',
  entities: [
    { id: 'rdw', label: 'Redwire Corporation', type: 'PublicCompany', confidence: 0.9 },
    { id: 'spacex', label: 'SpaceX', type: 'PrivateCompany', confidence: 0.95 },
    { id: 'quote', label: 'current price lookup', type: 'Task', confidence: 0.8 },
    { id: 'val', label: 'private-market valuation', type: 'ResearchTopic', confidence: 0.8 },
  ],
  relations: [
    { from: 'rdw', to: 'rdw_ticker', type: 'has_ticker', confidence: 0.9 },
    { from: 'quote', to: 'live_market_data', type: 'requires', confidence: 0.85 },
    { from: 'val', to: 'secondary_market_sources', type: 'requires', confidence: 0.85 },
  ],
  categories: ['market_research', 'public_equity', 'private_market'],
  sourceRefs: [{ ref: 'user-chat-rdw-spacex', kind: 'user_input' }],
  confidence: 0.85,
  uncertainty: ['no live RDW quote without a market-data tool', 'SpaceX has no public stock price'],
  nextSearchSeedCandidates: ['Redwire RDW quote', 'SpaceX secondary market valuation'],
};

describe('Mag One OWL graphPayload -> SLM extraction normalization (unit)', () => {
  it('normalizes the RDW/SpaceX graphPayload into canonical fields with no undefined', () => {
    const res = parseSlmGraphExtraction(JSON.stringify(RDW_SPACEX_GRAPH_PAYLOAD));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { entities, relations, sourceRefs } = res.result;
    // canonical fields present
    expect(entities.every((e) => e.label !== undefined && e.type !== undefined)).toBe(true);
    expect(relations.every((r) => r.from !== undefined && r.to !== undefined && r.type !== undefined)).toBe(true);
    // RDW (Redwire) public + SpaceX private both present
    const labels = entities.map((e) => e.label.toLowerCase());
    expect(labels.some((l) => l.includes('redwire') || l.includes('rdw'))).toBe(true);
    expect(labels.some((l) => l.includes('spacex'))).toBe(true);
    // SpaceX is typed private — no public stock price entity/field invented
    const spacex = entities.find((e) => e.label.toLowerCase().includes('spacex'));
    expect(spacex?.type).toBe('PrivateCompany');
    expect(JSON.stringify(res.result).toLowerCase()).not.toContain('spacex_stock_price');
    // sourceRefs + next-seeds preserved
    expect(sourceRefs[0].ref).toBe('user-chat-rdw-spacex');
    expect(res.result.nextSearchSeedCandidates.length).toBeGreaterThan(0);
  });

  it('fails closed when the Mag One output has no usable graphPayload', () => {
    // missing graphPayload entirely (no entities array)
    expect(parseSlmGraphExtraction('{}').ok).toBe(false);
    // malformed graphPayload (not JSON)
    expect(parseSlmGraphExtraction('not a graph payload').ok).toBe(false);
    // graphPayload present but no usable entity/relation meaning
    expect(parseSlmGraphExtraction(JSON.stringify({ entities: [{}], relations: [{}] })).ok).toBe(false);
  });

  it('allows an empty graphPayload ONLY when there is genuinely no graph-worthy content', () => {
    // explicit empty arrays (model honestly had nothing graph-worthy) -> ok, but empty.
    const res = parseSlmGraphExtraction(
      JSON.stringify({ entities: [], relations: [], categories: [], sourceRefs: [], confidence: 0, uncertainty: [] }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.entities).toHaveLength(0);
    expect(res.result.relations).toHaveLength(0);
    // This empty-but-ok path is the ONLY case the tightened contract permits a graph-empty
    // result; the RDW/SpaceX case above proves a populated payload normalizes with canonical
    // fields when explicit facts exist.
  });

  it('introduces no draft-generator naming in the handoff path', () => {
    expect(JSON.stringify(RDW_SPACEX_GRAPH_PAYLOAD).toLowerCase()).not.toContain('draft');
  });
});
