// One-off: write ONE deterministic accepted RDW/SpaceX graphPayload into a real project via
// the PROVEN write path (writeAcceptedMagOneGraphPayloadToThinkGraph -> ThinkGraph) so the
// Agent Builder ThinkGraph tab renders real nodes for it. User-authorized record for visual
// verification. No model call, no new write path.
//   TG_PROJECT_ID=<id> npx tsx --env-file=apps/backend/.env apps/backend/scripts/writeAcceptedRecordForViewing.ts
import { writeAcceptedMagOneGraphPayloadToThinkGraph } from '../src/slmGraph/magOneGraphPayloadToThinkGraph';

const PROJECT_ID = process.env.TG_PROJECT_ID || '20ac92da-01fd-4cf6-97cc-0672421e751a';
const SOURCE_REF = process.env.TG_SOURCE_REF || `magone-rdw-spacex-view-${Date.now()}`;

const RDW_SPACEX_GRAPH_PAYLOAD = {
  targetGraph: 'thinkgraph',
  inputKind: 'task_ledger_planning',
  sourceRef: SOURCE_REF,
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
  assertions: [{ subject: 'e_spacex', predicate: 'has_public_stock_price', object: 'false', evidence: 'SpaceX is explicitly private.', confidence: 1 }],
  sourceRefs: [{ ref: SOURCE_REF, kind: 'user' }],
  confidence: 0.99,
  uncertainty: ['Live RDW price unknown until lookup', 'SpaceX current valuation requires a private-market source'],
  nextSearchSeedCandidates: ['live_market_data_for_RDW', 'private_market_sources_for_SpaceX'],
};

async function main() {
  console.log('[write-view] projectId =', PROJECT_ID);
  console.log('[write-view] sourceRef =', SOURCE_REF);
  const res = await writeAcceptedMagOneGraphPayloadToThinkGraph(
    { graphPayload: RDW_SPACEX_GRAPH_PAYLOAD, accepted: true, sourceRef: SOURCE_REF },
    { projectId: PROJECT_ID },
  );
  console.log('[write-view] RESULT =', JSON.stringify(res, null, 2));
  process.exitCode = res.ok ? 0 : 2;
}

main().catch((e) => {
  console.error('[write-view] FAILED blocker=', e?.message || e);
  process.exitCode = 2;
});
