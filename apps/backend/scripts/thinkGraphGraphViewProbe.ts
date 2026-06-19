// Live smoke for the ThinkGraph tab read path. Reads the accepted RDW/SpaceX :SlmGraphRecord
// already in thinkgraph_liq (project magone-graphpayload-test, written by the prior proven
// write path — NO new write here) through the exact reader + projection the new
// /api/thinkgraph/graph-view route uses, and verifies it projects to real canvas nodes/edges.
// Honest about DB availability. No model call, no writes.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/thinkGraphGraphViewProbe.ts
import { readRecentThinkGraphSemanticRecords } from '../src/services/thinkgraph/thinkgraphMemory';
import { buildThinkGraphGraphViewResponse } from '../src/slmGraph/thinkGraphRecordToGraphView';

const PROJECT_ID = process.env.TG_PROJECT_ID || 'magone-graphpayload-test';

async function main() {
  console.log('[tg-view] graph     = thinkgraph_liq');
  console.log('[tg-view] projectId =', PROJECT_ID);
  console.log('[tg-view] reader    = readRecentThinkGraphSemanticRecords (route read path)');

  const result = await readRecentThinkGraphSemanticRecords({ projectId: PROJECT_ID, limit: 25 });
  const response = buildThinkGraphGraphViewResponse(PROJECT_ID, result);
  console.log('[tg-view] response  =\n', JSON.stringify({ ok: response.ok, source: response.source, counts: response.counts, reason: response.reason, blocker: response.blocker }, null, 2));

  if (!response.ok) {
    console.log('[tg-view] RESULT    = DB_UNAVAILABLE blocker=', response.blocker);
    process.exitCode = 2;
    return;
  }
  if (response.counts.records === 0) {
    // Honest: route works, but no accepted records exist for this project yet.
    console.log('[tg-view] RESULT    = OK_BUT_NO_RECORDS (honest empty:', response.reason, ')');
    process.exitCode = 0;
    return;
  }

  console.log('[tg-view] nodes =\n', JSON.stringify(response.nodes, null, 2));
  console.log('[tg-view] edges =\n', JSON.stringify(response.edges, null, 2));

  const labels = response.nodes.map((n) => n.label);
  const checks: Array<[string, boolean]> = [
    ['source is thinkgraph-db (not host-provided)', response.source === 'thinkgraph-db'],
    ['nonempty nodes from accepted record', response.nodes.length > 0],
    ['nonempty edges from accepted record', response.edges.length > 0],
    ['Redwire/RDW node present', labels.some((l) => /redwire|rdw/i.test(l))],
    ['SpaceX node present', labels.some((l) => /spacex/i.test(l))],
    ['nodes carry sourceRef (traceable to graph memory)', response.nodes.every((n) => !!n.sourceRef)],
    ['no undefined canonical node fields', response.nodes.every((n) => n.id && n.label)],
    ['no undefined canonical edge fields', response.edges.every((e) => e.id && e.source && e.target && e.label)],
  ];
  for (const [name, pass] of checks) console.log(`[tg-view] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[tg-view] RESULT    =', allPass ? 'PASS (accepted ThinkGraph records project to real graph-view nodes/edges)' : 'FAIL');
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error('[tg-view] RESULT    = DB_UNAVAILABLE (exception) blocker=', e?.message || e);
  process.exitCode = 2;
});
