// Live smoke: an ACCEPTED real RDW/SpaceX Mag One graphPayload (the proven shape from
// magOneOwlRealRunProbe.ts) -> acceptance/normalization adapter -> real ThinkGraph write
// -> read back from real `thinkgraph_liq` -> verify canonical fields survived. NO model call
// (no live Mag One, no Docker Gemma, no RDW price fetch, no SpaceX research). Honest about DB
// availability — never fakes success.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/magOneGraphPayloadThinkGraphProbe.ts
import { writeAcceptedMagOneGraphPayloadToThinkGraph } from '../src/slmGraph/magOneGraphPayloadToThinkGraph';
import { readThinkGraphSemanticRecord } from '../src/services/thinkgraph/thinkgraphMemory';

const PROJECT_ID = 'magone-graphpayload-test';
const SOURCE_REF = `magone-rdw-spacex-${Date.now()}`;

// Real successful RDW/SpaceX OWL graphPayload shape (canonical, from the live probe run).
const RDW_SPACEX_GRAPH_PAYLOAD = {
  targetGraph: 'thinkgraph',
  inputKind: 'task_ledger_planning',
  sourceRef: 'user_request_stream',
  entities: [
    { id: 'e_rdw', label: 'Redwire Corporation', type: 'company', evidence: 'User referenced RDW as a public stock.', confidence: 0.99 },
    { id: 'e_rdw_ticker', label: 'RDW', type: 'ticker', evidence: 'RDW is the stock ticker for Redwire.', confidence: 0.99 },
    { id: 'e_spacex', label: 'SpaceX', type: 'company', evidence: 'User referenced SpaceX and noted it is private.', confidence: 0.99 },
    { id: 'e_t1', label: 'Fetch live RDW market quote', type: 'task', confidence: 1 },
    { id: 'e_t2', label: 'Research SpaceX private-market valuation', type: 'task', confidence: 1 },
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

async function main() {
  console.log('[magone-tg] graph     = thinkgraph_liq');
  console.log('[magone-tg] projectId =', PROJECT_ID);
  console.log('[magone-tg] sourceRef =', SOURCE_REF);
  console.log('[magone-tg] input     = ACCEPTED real RDW/SpaceX graphPayload (no model call)');

  // 1) ACCEPT + NORMALIZE + WRITE through the real ThinkGraph path.
  const writeRes = await writeAcceptedMagOneGraphPayloadToThinkGraph(
    { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true, sourceRef: SOURCE_REF },
    { projectId: PROJECT_ID },
  );
  console.log('[magone-tg] WRITE     =', JSON.stringify({ ok: writeRes.ok, ...(writeRes.ok ? { id: writeRes.id } : { error: writeRes.error }) }));
  if (!writeRes.ok) {
    // Acceptance/normalization logic errors would be a code bug; after acceptance, a write
    // failure means the DB is unavailable. Report the exact blocker either way.
    console.log('[magone-tg] RESULT    = DB_UNAVAILABLE (write failed) blocker=', writeRes.error);
    process.exitCode = 2;
    return;
  }

  // 2) READ back from real thinkgraph_liq.
  const readRes = await readThinkGraphSemanticRecord({ projectId: PROJECT_ID, sourceRef: SOURCE_REF });
  console.log('[magone-tg] READ      =', readRes.ok ? 'ok' : `not ok (${readRes.reason})`);
  if (!readRes.ok) {
    if (readRes.reason === 'age_query_failed') {
      console.log('[magone-tg] RESULT    = DB_UNAVAILABLE (read query failed) blocker=', readRes.error);
      process.exitCode = 2;
    } else {
      console.log('[magone-tg] RESULT    = FAIL (written but not_found on read-back)');
      process.exitCode = 1;
    }
    return;
  }

  const r = readRes.record;
  console.log('[magone-tg] readRecord =\n', JSON.stringify(r, null, 2));

  const labels = r.entities.map((e) => e.label);
  const hasRel = (from: string, to: string, type: string) =>
    r.relations.some((x) => x.from === from && x.to === to && x.type === type);
  const checks: Array<[string, boolean]> = [
    ['entity Redwire Corporation present', labels.includes('Redwire Corporation')],
    ['entity RDW present', labels.includes('RDW')],
    ['entity SpaceX present', labels.includes('SpaceX')],
    ['task entities present (price lookup + valuation)', labels.some((l) => /price|quote/i.test(l)) && labels.some((l) => /valuation/i.test(l))],
    ['relation RDW identifies Redwire', hasRel('e_rdw_ticker', 'e_rdw', 'identifies')],
    ['relation price-lookup depends_on RDW', hasRel('e_t1', 'e_rdw', 'depends_on')],
    ['relation valuation depends_on SpaceX', hasRel('e_t2', 'e_spacex', 'depends_on')],
    ['sourceRef queryable + matches', r.sourceRef === SOURCE_REF],
    ['sourceRefs[].ref preserved', r.sourceRefs.some((s) => !!s.ref)],
    ['confidence survived', typeof r.confidence === 'number' && r.confidence > 0],
    ['uncertainty notes live RDW price unknown', r.uncertainty.join(' ').toLowerCase().includes('live rdw price')],
    ['nextSearchSeedCandidates survived', r.nextSearchSeedCandidates.includes('live_market_data_for_RDW')],
    [
      'no undefined canonical fields',
      r.entities.every((e) => e.label !== undefined && e.type !== undefined) &&
        r.relations.every((x) => x.from !== undefined && x.to !== undefined && x.type !== undefined),
    ],
  ];
  for (const [name, pass] of checks) console.log(`[magone-tg] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[magone-tg] RESULT    =', allPass ? 'PASS (accepted graphPayload -> ThinkGraph write+read proven)' : 'FAIL (field mismatch)');
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error('[magone-tg] RESULT    = DB_UNAVAILABLE (exception) blocker=', e?.message || e);
  process.exitCode = 2;
});
