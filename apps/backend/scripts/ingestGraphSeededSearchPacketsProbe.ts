// Live smoke: graph seed -> bounded search tasks -> SAFE Tavily runner -> SearchAgentResult
// packets -> KnowGraph EVIDENCE ingest (project-scoped, source-backed, no fact promotion) ->
// read-back proof -> convergence over packets. Honest: if the search tool is not configured it
// reports `search_tool_not_configured` and writes NOTHING. No scraping, no crawler, no claim
// promotion, no ThinkGraph write.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/ingestGraphSeededSearchPacketsProbe.ts
import {
  buildGraphSeededSearchTasks,
  detectSearchConvergence,
  graphSearchSeedFromExtraction,
} from '../src/slmGraph/graphSeededSearchConvergence';
import { MAX_SEARCH_QUERIES, isSafeSearchConfigured, runGraphSeededSearchTasks } from '../src/slmGraph/graphSeededSearchRunner';
import { ingestSearchAgentPacketsToKnowGraph, readBackSearchEvidence } from '../src/slmGraph/searchPacketToKnowGraph';
import { closeNeo4j } from '../src/connectors/neo4j';

const PROJECT_ID = process.env.TG_PROJECT_ID || '20ac92da-01fd-4cf6-97cc-0672421e751a';
const GRAPH_SEED_SOURCE_REF = 'user_request_stream';
const RUN_ID = `search-run-${Date.now()}`;

const SEED = graphSearchSeedFromExtraction(
  {
    entities: [
      { id: 'e_rdw', label: 'Redwire Corporation', type: 'company' },
      { id: 'e_rdw_ticker', label: 'RDW', type: 'ticker' },
      { id: 'e_spacex', label: 'SpaceX', type: 'company' },
    ],
    relations: [
      { from: 'e_t1', to: 'e_rdw', type: 'requires' },
      { from: 'e_t2', to: 'e_spacex', type: 'requires' },
    ],
    nextSearchSeedCandidates: ['live_market_data_for_RDW', 'private_market_sources_for_SpaceX'],
    sourceRefs: [{ ref: GRAPH_SEED_SOURCE_REF }],
  } as any,
  { projectId: PROJECT_ID, sourceRef: GRAPH_SEED_SOURCE_REF, freshness: 'P7D' },
);

async function main() {
  console.log('[ingest] projectId =', PROJECT_ID, ' runId =', RUN_ID);
  console.log('[ingest] search configured =', isSafeSearchConfigured());
  const tasks = buildGraphSeededSearchTasks(SEED);

  if (!isSafeSearchConfigured()) {
    console.log('[ingest] RESULT = search_tool_not_configured (no write performed)');
    process.exitCode = 0;
    return;
  }

  const batch = await runGraphSeededSearchTasks(tasks, { projectId: PROJECT_ID, turnId: RUN_ID });
  if (!batch.ok) {
    console.log('[ingest] RESULT = search_tool_not_configured (no write performed)');
    process.exitCode = 0;
    return;
  }
  console.log(`[ingest] ran ${batch.ran} task(s); ${batch.packets.length} packet(s); ${batch.errors.length} error(s)`);
  if (batch.packets.length === 0) {
    console.log('[ingest] RESULT = LIVE_BLOCKED (no packets from provider) blocker=', batch.errors.join('; '));
    process.exitCode = 0;
    return;
  }

  // Ingest packets as project-scoped EVIDENCE (not facts).
  const ingest = await ingestSearchAgentPacketsToKnowGraph({ projectId: PROJECT_ID, runId: RUN_ID, graphSeedSourceRef: GRAPH_SEED_SOURCE_REF, packets: batch.packets });
  console.log('[ingest] WRITE =', JSON.stringify({ ok: ingest.ok, ...(ingest.ok ? { nodeCount: ingest.nodeCount, relationshipCount: ingest.relationshipCount, sourceCount: ingest.sourceCount, entityCount: ingest.entityCount } : { reason: (ingest as any).reason }) }));
  if (!ingest.ok) {
    console.log('[ingest] RESULT = DB_BLOCKED (evidence write failed) blocker=', (ingest as any).reason);
    process.exitCode = 2;
    return;
  }

  // Read back the evidence to prove it persisted + no truth-claim relationship exists.
  const readBack = await readBackSearchEvidence({ projectId: PROJECT_ID, runId: RUN_ID });
  console.log('[ingest] READBACK =', readBack.ok ? JSON.stringify({ packetCount: readBack.packetCount, sourceCount: readBack.sourceCount, entityCount: readBack.entityCount, relTypes: readBack.relTypes, truthClaimRelTypesFound: readBack.truthClaimRelTypesFound }) : `fail (${(readBack as any).reason})`);
  if (!readBack.ok) {
    console.log('[ingest] RESULT = DB_BLOCKED (evidence read failed) blocker=', (readBack as any).reason);
    process.exitCode = 2;
    return;
  }
  for (const p of readBack.packets) console.log(`  [packet ${p.id}] query="${p.query}" sources=${p.sources.length} entities=[${p.entities.join(', ')}]`);

  const report = detectSearchConvergence(batch.packets, SEED);
  console.log('[ingest] convergence =', JSON.stringify({ convergenceScore: report.convergenceScore, converged: report.converged, overlappingSourceRefs: report.overlappingSourceRefs, stopReason: report.stopReason }));

  const checks: Array<[string, boolean]> = [
    ['evidence write ok', ingest.ok],
    ['read-back found packets', readBack.packetCount > 0],
    ['read-back found sources', readBack.sourceCount > 0],
    ['read-back found observed entities', readBack.entityCount > 0],
    ['provenance relationships present', readBack.relTypes.includes('RETURNED_SOURCE') && readBack.relTypes.includes('MENTIONS_ENTITY')],
    ['NO truth-claim relationship written', readBack.truthClaimRelTypesFound.length === 0],
    ['convergence report produced', typeof report.convergenceScore === 'number'],
  ];
  for (const [name, pass] of checks) console.log(`[ingest] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[ingest] RESULT =', allPass ? 'INGEST_PROVEN (source-backed evidence written + read back; no fact promotion)' : 'PARTIAL (see FAIL lines)');
  process.exitCode = allPass ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('[ingest] RESULT = DB_BLOCKED (exception) blocker=', e?.message || e);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeNeo4j().catch(() => {});
  });
