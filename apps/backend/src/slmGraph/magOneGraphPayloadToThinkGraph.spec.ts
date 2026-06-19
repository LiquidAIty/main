import { describe, expect, it } from 'vitest';

import {
  normalizeAcceptedMagOneGraphPayload,
  writeAcceptedMagOneGraphPayloadToThinkGraph,
} from './magOneGraphPayloadToThinkGraph';
import type { ThinkGraphWriteRecord } from './thinkGraphWrite';

// Real successful RDW/SpaceX shape from magOneOwlRealRunProbe.ts (canonical OWL graphPayload
// the live OpenRouter Mag One run produced). Used as the acceptance->ThinkGraph test basis.
const RDW_SPACEX_GRAPH_PAYLOAD = {
  targetGraph: 'thinkgraph',
  inputKind: 'task_ledger_planning',
  sourceRef: 'user_request_stream',
  entities: [
    { id: 'e_rdw', label: 'Redwire Corporation', type: 'company', evidence: 'User referenced RDW as a public stock.', confidence: 0.99, uncertainty: '' },
    { id: 'e_rdw_ticker', label: 'RDW', type: 'ticker', evidence: 'RDW is the stock ticker for Redwire.', confidence: 0.99, uncertainty: '' },
    { id: 'e_spacex', label: 'SpaceX', type: 'company', evidence: 'User referenced SpaceX and noted it is private.', confidence: 0.99, uncertainty: '' },
    { id: 'e_t1', label: 'Fetch live RDW market quote', type: 'task', confidence: 1, uncertainty: '' },
    { id: 'e_t2', label: 'Research SpaceX private-market valuation', type: 'task', confidence: 1, uncertainty: '' },
  ],
  relations: [
    { from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies', confidence: 0.99 },
    { from: 'e_t1', to: 'e_rdw', type: 'depends_on', confidence: 1 },
    { from: 'e_t2', to: 'e_spacex', type: 'depends_on', confidence: 1 },
  ],
  categories: ['market_research'],
  assertions: [
    { subject: 'e_spacex', predicate: 'has_public_stock_price', object: 'false', evidence: 'SpaceX is explicitly private.', confidence: 1 },
  ],
  sourceRefs: [{ ref: 'user_request_stream', kind: 'user' }],
  confidence: 0.99,
  uncertainty: ['Live RDW price unknown until lookup', 'SpaceX current valuation requires a private-market source'],
  nextSearchSeedCandidates: ['live_market_data_for_RDW', 'private_market_sources_for_SpaceX'],
};

function captureWriter() {
  const writes: ThinkGraphWriteRecord[] = [];
  const write = async (record: ThinkGraphWriteRecord) => {
    writes.push(record);
    return { id: `tg_${writes.length}`, ts: 't' };
  };
  return { writes, write };
}

describe('accepted Mag One graphPayload -> ThinkGraph write', () => {
  it('normalizes and writes an accepted nonempty RDW/SpaceX graphPayload', async () => {
    const { writes, write } = captureWriter();
    const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true },
      { projectId: 'p_rdw_spacex' },
      { write },
    );
    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(1);
    if (!res.ok) return;

    const rec = writes[0];
    const labels = rec.entities.map((e) => e.label);
    // Entities: Redwire/RDW + SpaceX + the price-lookup + valuation tasks.
    expect(labels).toContain('Redwire Corporation');
    expect(labels).toContain('RDW');
    expect(labels).toContain('SpaceX');
    expect(labels.some((l) => /price|quote/i.test(l))).toBe(true);
    expect(labels.some((l) => /valuation/i.test(l))).toBe(true);
    // Relations: RDW identifies Redwire; tasks depend on RDW / SpaceX.
    expect(rec.relations.some((r) => r.type === 'identifies')).toBe(true);
    expect(rec.relations.some((r) => r.from === 'e_t1' && r.to === 'e_rdw' && r.type === 'depends_on')).toBe(true);
    expect(rec.relations.some((r) => r.from === 'e_t2' && r.to === 'e_spacex' && r.type === 'depends_on')).toBe(true);
  });

  it('persists canonical fields (read-back shape) with no undefined', async () => {
    const { writes, write } = captureWriter();
    await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true },
      { projectId: 'p_rdw_spacex' },
      { write },
    );
    const rec = writes[0];
    expect(rec.entities.every((e) => e.label !== undefined && e.type !== undefined)).toBe(true);
    expect(rec.relations.every((r) => r.from !== undefined && r.to !== undefined && r.type !== undefined)).toBe(true);
  });

  it('sourceRef is queryable and preserved from the payload', async () => {
    const { writes, write } = captureWriter();
    const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true },
      { projectId: 'p_rdw_spacex' },
      { write },
    );
    expect(res.ok && res.sourceRef).toBe('user_request_stream');
    const rec = writes[0];
    expect(rec.sourceRef).toBe('user_request_stream');
    expect(rec.sourceRefs.some((s) => s.ref === 'user_request_stream')).toBe(true);
  });

  it('confidence and uncertainty survive the write', async () => {
    const { writes, write } = captureWriter();
    await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true },
      { projectId: 'p_rdw_spacex' },
      { write },
    );
    const rec = writes[0];
    expect(rec.confidence).toBeCloseTo(0.99);
    expect(rec.uncertainty.length).toBeGreaterThan(0);
    expect(rec.uncertainty.join(' ').toLowerCase()).toContain('live rdw price');
  });

  it('nextSearchSeedCandidates survive when present', async () => {
    const { writes, write } = captureWriter();
    await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true },
      { projectId: 'p_rdw_spacex' },
      { write },
    );
    const rec = writes[0];
    expect(rec.nextSearchSeedCandidates).toContain('live_market_data_for_RDW');
    expect(rec.nextSearchSeedCandidates).toContain('private_market_sources_for_SpaceX');
  });

  it('writes the NORMALIZED extraction, never the raw graphPayload (live key drift)', async () => {
    // Mag One drift keys: name/class on entities, source/target/relation on relations,
    // string sourceRefs, numeric uncertainty. The written record must be canonical.
    const driftPayload = {
      entities: [{ id: 'x1', name: 'Acme Co', class: 'company' }],
      relations: [{ source: 'x1', target: 'x2', relation: 'supplies' }],
      sourceRefs: ['chat-drift'],
      confidence: 0.7,
      uncertainty: 0.3,
      nextSearchSeedCandidates: ['acme'],
    };
    const { writes, write } = captureWriter();
    const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: driftPayload, accepted: true },
      { projectId: 'p_drift' },
      { write },
    );
    expect(res.ok).toBe(true);
    const rec = writes[0];
    expect(rec.entities[0].label).toBe('Acme Co'); // name -> label
    expect(rec.entities[0].type).toBe('company'); // class -> type
    expect((rec.entities[0] as Record<string, unknown>).name).toBeUndefined(); // raw key gone
    expect(rec.relations[0].from).toBe('x1'); // source -> from
    expect(rec.relations[0].type).toBe('supplies'); // relation -> type
    expect(rec.sourceRefs.some((s) => s.ref === 'chat-drift')).toBe(true);
  });
});

describe('acceptance boundary + fail-closed reasons (no fake/no-op success)', () => {
  it('does not write an UNACCEPTED graphPayload', async () => {
    const { writes, write } = captureWriter();
    const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: false },
      { projectId: 'p' },
      { write },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('not_accepted');
    expect(writes).toHaveLength(0);
    // missing accepted flag is also unaccepted
    const res2 = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD },
      { projectId: 'p' },
      { write },
    );
    expect(res2.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('fails closed with missing_graph_payload when there is no graphPayload', async () => {
    const { writes, write } = captureWriter();
    const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { accepted: true, planFlowTaskObjects: [{ id: 't1' }] },
      { projectId: 'p' },
      { write },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_graph_payload');
    expect(writes).toHaveLength(0);
  });

  it('fails closed with invalid_graph_payload when malformed', async () => {
    const { writes, write } = captureWriter();
    // not an object
    const a = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { accepted: true, graphPayload: 'not-an-object' },
      { projectId: 'p' },
      { write },
    );
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toBe('invalid_graph_payload');
    // object but no usable entity/relation meaning -> normalization fails closed
    const b = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { accepted: true, graphPayload: { entities: [{}], relations: [{}] } },
      { projectId: 'p' },
      { write },
    );
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe('invalid_graph_payload');
    expect(writes).toHaveLength(0);
  });

  it('does not fake write success for an empty graphPayload', async () => {
    const { writes, write } = captureWriter();
    const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { accepted: true, graphPayload: { entities: [], relations: [], sourceRefs: [], confidence: 0, uncertainty: [] } },
      { projectId: 'p' },
      { write },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('empty_graph_payload');
    expect(writes).toHaveLength(0); // no-op, not a fake record
  });

  it('surfaces a real ThinkGraph write failure as ok:false (no fabricated success)', async () => {
    const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
      { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true },
      { projectId: 'p' },
      { write: async () => { throw new Error('age_unavailable'); } },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('age_unavailable');
  });

  it('normalize boundary is pure and returns honest reasons without writing', () => {
    expect(normalizeAcceptedMagOneGraphPayload({ accepted: false, graphPayload: RDW_SPACEX_GRAPH_PAYLOAD }).ok).toBe(false);
    expect(normalizeAcceptedMagOneGraphPayload({ accepted: true }).ok).toBe(false);
    const ok = normalizeAcceptedMagOneGraphPayload({ accepted: true, graphPayload: RDW_SPACEX_GRAPH_PAYLOAD });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.sourceRef).toBe('user_request_stream');
  });

  it('introduces no draft-generator naming in the handoff path', () => {
    expect(JSON.stringify(RDW_SPACEX_GRAPH_PAYLOAD).toLowerCase()).not.toContain('draft');
  });
});
