// Deterministic probe: RDW/SpaceX source packet fixture -> direct source-result JUDGMENT ->
// source-backed assertions written straight into KnowGraph (supported / contradicted /
// uncertain) -> read back. No candidate/promotion stage, no live Tavily, no scraping. Exits 0
// only when supported+contradicted+uncertain exist, sourceRefs are preserved, no forbidden
// truth-claim relationships and no candidate/draft/promotion labels appear, and no RDW price /
// SpaceX public ticker was invented.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/judgeSearchPacketAssertionsProbe.ts
import {
  judgeAndIngestSearchPacketsToKnowGraph,
  readBackSourceAssertions,
  type AssertionTarget,
} from '../src/slmGraph/searchResultJudgment';
import type { SearchAgentResultPacket } from '../src/slmGraph/graphSeededSearchConvergence';
import { closeNeo4j } from '../src/connectors/neo4j';

const PROJECT_ID = process.env.TG_PROJECT_ID || '20ac92da-01fd-4cf6-97cc-0672421e751a';
const RUN_ID = `judge-run-${Date.now()}`;
const GRAPH_SEED_REF = 'user_request_stream';

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

async function main() {
  console.log('[judge] projectId =', PROJECT_ID, ' runId =', RUN_ID);

  const ingest = await judgeAndIngestSearchPacketsToKnowGraph({ projectId: PROJECT_ID, runId: RUN_ID, graphSeedRef: GRAPH_SEED_REF, targets: TARGETS, packets: PACKETS });
  console.log('[judge] WRITE =', JSON.stringify(ingest));
  if (!ingest.ok) {
    console.log('[judge] RESULT = DB_BLOCKED (assertion write failed) blocker=', (ingest as any).reason);
    process.exitCode = 2;
    return;
  }

  const readBack = await readBackSourceAssertions({ projectId: PROJECT_ID, runId: RUN_ID });
  if (!readBack.ok) {
    console.log('[judge] RESULT = DB_BLOCKED (assertion read failed) blocker=', (readBack as any).reason);
    process.exitCode = 2;
    return;
  }
  console.log('[judge] READBACK =', JSON.stringify({ outcomes: readBack.outcomes, relTypes: readBack.relTypes, forbiddenRelTypesFound: readBack.forbiddenRelTypesFound, forbiddenLabelsFound: readBack.forbiddenLabelsFound, allHaveSourceRef: readBack.allHaveSourceRef }));
  for (const a of readBack.assertions) console.log(`  [${a.outcome}] ${a.subject} ${a.predicate} ${a.object}  <- ${a.sourceRef}`);

  const blob = JSON.stringify(readBack).toLowerCase();
  const checks: Array<[string, boolean]> = [
    ['supported assertion exists', readBack.outcomes.supported >= 1],
    ['contradicted assertion exists', readBack.outcomes.contradicted >= 1],
    ['uncertain assertion exists', readBack.outcomes.uncertain >= 1],
    ['every assertion has a sourceRef', readBack.allHaveSourceRef],
    ['provenance + contradiction relationships present', readBack.relTypes.includes('ASSERTED_BY_SOURCE') && readBack.relTypes.includes('CONTRADICTS')],
    ['NO forbidden truth-claim relationship', readBack.forbiddenRelTypesFound.length === 0],
    ['NO candidate/draft/promotion label', readBack.forbiddenLabelsFound.length === 0],
    ['no invented dollar price', !/\$\s?\d/.test(blob)],
    ['no invented SpaceX public ticker', !readBack.assertions.some((a) => a.subject.toLowerCase() === 'spacex' && /ticker/.test(a.predicate))],
  ];
  for (const [name, pass] of checks) console.log(`[judge] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[judge] RESULT =', allPass ? 'JUDGMENT_PROVEN (source results judged + asserted directly into KnowGraph; contradictions/uncertainty first-class)' : 'PARTIAL (see FAIL lines)');
  process.exitCode = allPass ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('[judge] RESULT = DB_BLOCKED (exception) blocker=', e?.message || e);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeNeo4j().catch(() => {});
  });
