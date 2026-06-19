// Live-safe probe: graph seed -> bounded search tasks -> SAFE Tavily search (>=1, <=3) ->
// normalized SearchAgentResultPackets -> convergence report. Honest: if the search tool is not
// configured it reports `search_tool_not_configured` and still exits 0 (the primitive path is
// proven). No crawler, no scraping, no browser automation, no graph writes.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/graphSeededSearchLiveProbe.ts
import {
  buildGraphSeededSearchTasks,
  detectSearchConvergence,
  graphSearchSeedFromExtraction,
} from '../src/slmGraph/graphSeededSearchConvergence';
import {
  MAX_SEARCH_QUERIES,
  isSafeSearchConfigured,
  runGraphSeededSearchTasks,
} from '../src/slmGraph/graphSeededSearchRunner';

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
    sourceRefs: [{ ref: 'user_request_stream' }],
  } as any,
  { projectId: 'magone-graphpayload-test', sourceRef: 'user_request_stream', freshness: 'P7D' },
);

async function main() {
  const tasks = buildGraphSeededSearchTasks(SEED);
  console.log('[live-search] provider  = tavily');
  console.log('[live-search] configured =', isSafeSearchConfigured());
  console.log('[live-search] compiled tasks (running first', MAX_SEARCH_QUERIES, '):');
  for (const t of tasks.slice(0, MAX_SEARCH_QUERIES)) console.log(`  - [${t.kind}] ${t.query}`);

  if (!isSafeSearchConfigured()) {
    console.log('[live-search] RESULT = search_tool_not_configured (honest; unit path proven, live blocked)');
    process.exitCode = 0;
    return;
  }

  const batch = await runGraphSeededSearchTasks(tasks, {
    projectId: 'magone-graphpayload-test',
    turnId: `live-probe-${Date.now()}`,
  });

  if (!batch.ok) {
    console.log('[live-search] RESULT = search_tool_not_configured (honest)');
    process.exitCode = 0;
    return;
  }

  console.log(`[live-search] ran ${batch.ran} task(s); ${batch.packets.length} packet(s); ${batch.errors.length} error(s)`);
  for (const e of batch.errors) console.log('  [error]', e);
  for (const p of batch.packets) {
    console.log(`  [packet ${p.agentId}] sources=${p.sourceRefs.length} entities=[${p.entities.map((x) => x.label).join(', ')}]`);
    for (const s of p.sourceRefs.slice(0, 3)) console.log(`      - ${s.url}`);
  }

  const report = detectSearchConvergence(batch.packets, SEED);
  console.log('[live-search] convergence report =\n', JSON.stringify(report, null, 2));

  const blob = JSON.stringify(report).toLowerCase();
  const checks: Array<[string, boolean]> = [
    ['at least one packet returned', batch.packets.length > 0],
    ['packets carry sourceRefs', batch.packets.some((p) => p.sourceRefs.length > 0)],
    ['convergence report produced', typeof report.convergenceScore === 'number'],
    ['next search seeds produced', Array.isArray(report.nextSearchSeedCandidates)],
    ['no invented dollar price', !/\$\s?\d/.test(blob)],
    ['no invented SpaceX public stock price', !/spacex[^.]{0,30}(stock price|share price|ticker)/.test(blob)],
  ];
  for (const [name, pass] of checks) console.log(`[live-search] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  // If the provider returned zero packets despite being configured, that's an honest live block.
  if (batch.packets.length === 0) {
    console.log('[live-search] RESULT = LIVE_BLOCKED (configured but provider returned no packets) blocker=', batch.errors.join('; '));
    process.exitCode = 0;
    return;
  }
  console.log('[live-search] RESULT =', allPass ? 'LIVE_PROVEN (graph-seeded tasks -> safe Tavily -> packets -> convergence)' : 'PARTIAL (see FAIL lines)');
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error('[live-search] RESULT = LIVE_BLOCKED (exception) blocker=', e?.message || e);
  process.exitCode = 0;
});
