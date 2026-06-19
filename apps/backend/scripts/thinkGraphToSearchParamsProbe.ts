// Deterministic probe: read a real ThinkGraph :SlmGraphRecord and convert it into
// deterministic graph-to-search params. NO model call, NO search call, NO crawler.
// Writes one deterministic record via the existing write path (since the prior
// roundtrip sourceRef is timestamped/unknown), reads it back, converts, verifies.
//   npx tsx apps/backend/scripts/thinkGraphToSearchParamsProbe.ts
import { writeSlmExtractionToThinkGraph } from '../src/slmGraph/thinkGraphWrite';
import { readThinkGraphSemanticRecord } from '../src/services/thinkgraph/thinkgraphMemory';
import { storedThinkGraphRecordToSearchParams } from '../src/slmGraph/thinkGraphRecordToSearch';
import type { SlmGraphExtraction } from '../src/slmGraph/slmGraphWorker';

const PROJECT_ID = 'slm-roundtrip-test';
const SOURCE_REF = `thinkgraph-search-params-${Date.now()}`;

const EXTRACTION: SlmGraphExtraction = {
  entities: [
    { id: 'e1', label: 'Local Gemma', type: 'Model', confidence: 0.95 },
    { id: 'e2', label: 'OWL extraction', type: 'Task', confidence: 0.9 },
  ],
  relations: [{ from: 'e1', to: 'e2', type: 'performs', confidence: 0.9 }],
  categories: ['local_model_worker'],
  assertions: [],
  sourceRefs: [],
  confidence: 0.85,
  uncertainty: ['0.15'],
  nextSearchSeedCandidates: [],
};

async function main() {
  console.log('[search-params] projectId =', PROJECT_ID);
  console.log('[search-params] sourceRef =', SOURCE_REF);

  // 1) Write a deterministic record via the existing ThinkGraph write path.
  const writeRes = await writeSlmExtractionToThinkGraph(
    { ok: true, result: EXTRACTION },
    { projectId: PROJECT_ID, sourceRef: SOURCE_REF },
  );
  if (!writeRes.ok) {
    console.log('[search-params] RESULT = DB_UNAVAILABLE (write failed) blocker=', writeRes.error);
    process.exitCode = 2;
    return;
  }

  // 2) Read it back from real thinkgraph_liq.
  const readRes = await readThinkGraphSemanticRecord({ projectId: PROJECT_ID, sourceRef: SOURCE_REF });
  if (!readRes.ok) {
    if (readRes.reason === 'age_query_failed') {
      console.log('[search-params] RESULT = DB_UNAVAILABLE (read failed) blocker=', readRes.error);
      process.exitCode = 2;
    } else {
      console.log('[search-params] RESULT = FAIL (written but not_found)');
      process.exitCode = 1;
    }
    return;
  }

  console.log('[search-params] entitiesUsed  =', JSON.stringify(readRes.record.entities.map((e) => `${e.label}:${e.type}`)));
  console.log('[search-params] relationsUsed =', JSON.stringify(readRes.record.relations.map((r) => `${r.from}-${r.type}->${r.to}`)));

  // 3) Convert the stored record into deterministic search params (no LLM, no search).
  const out = storedThinkGraphRecordToSearchParams(readRes.record);
  console.log('[search-params] searchParams  =\n', JSON.stringify(out, null, 2));

  // 4) Verify expected query/seeds.
  const sp = out.searchParams;
  const checks: Array<[string, boolean]> = [
    ['ok', out.ok],
    ['seedEntities includes Local Gemma', sp.seedEntities.includes('Local Gemma')],
    ['seedEntities includes OWL extraction', sp.seedEntities.includes('OWL extraction')],
    ['seedRelations includes performs', sp.seedRelations.includes('performs')],
    ['query contains "Local Gemma"', sp.query.includes('Local Gemma')],
    ['query contains "OWL extraction"', sp.query.includes('OWL extraction')],
    ['query contains "performs"', sp.query.includes('performs')],
    ['query contains category local_model_worker', sp.query.includes('local_model_worker')],
    ['sourceRef preserved', out.sourceRef === SOURCE_REF],
    ['depth >= 1', sp.depth >= 1],
    ['maxSources > 0', sp.maxSources > 0],
    ['stopCondition set', Boolean(sp.stopCondition)],
  ];
  for (const [name, pass] of checks) console.log(`[search-params] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[search-params] RESULT =', allPass ? 'PASS (thinkgraph->search-params proven)' : 'FAIL');
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error('[search-params] RESULT = DB_UNAVAILABLE (exception) blocker=', e?.message || e);
  process.exitCode = 2;
});
