// Live ThinkGraph roundtrip probe (NO model call). Writes ONE deterministic normalized
// graph extraction through the real ThinkGraph write path, reads it back from real
// `thinkgraph_liq`, and verifies canonical fields survived storage. Honest about DB
// availability — does not fake success.
//   npx tsx apps/backend/scripts/thinkGraphExtractionRoundTripProbe.ts
import { writeSlmExtractionToThinkGraph } from '../src/slmGraph/thinkGraphWrite';
import type { SlmGraphExtraction } from '../src/slmGraph/slmGraphWorker';
import { readThinkGraphSemanticRecord } from '../src/services/thinkgraph/thinkgraphMemory';

const PROJECT_ID = 'slm-roundtrip-test';
const SOURCE_REF = `thinkgraph-live-roundtrip-${Date.now()}`;

const EXTRACTION: SlmGraphExtraction = {
  entities: [{ id: 'e1', label: 'Local Gemma', type: 'Model', confidence: 0.95, uncertainty: 0.05 }],
  relations: [{ from: 'e1', to: 'owl-extraction', type: 'performs', confidence: 0.9, uncertainty: 0.1 }],
  categories: ['local_model_worker'],
  assertions: [],
  sourceRefs: [],
  confidence: 0.85,
  uncertainty: ['0.15'],
  nextSearchSeedCandidates: [],
};

async function main() {
  console.log('[roundtrip] graph       = thinkgraph_liq');
  console.log('[roundtrip] projectId   =', PROJECT_ID);
  console.log('[roundtrip] sourceRef   =', SOURCE_REF);
  console.log('[roundtrip] createdBy   = slmGraphWorker');

  // 1) WRITE through the real ThinkGraph write path.
  const writeRes = await writeSlmExtractionToThinkGraph(
    { ok: true, result: EXTRACTION },
    { projectId: PROJECT_ID, sourceRef: SOURCE_REF },
  );
  console.log('[roundtrip] WRITE       =', JSON.stringify(writeRes));
  if (!writeRes.ok) {
    console.log('[roundtrip] RESULT      = DB_UNAVAILABLE (write failed) blocker=', writeRes.error);
    process.exitCode = 2;
    return;
  }

  // 2) READ back from real thinkgraph_liq.
  const readRes = await readThinkGraphSemanticRecord({ projectId: PROJECT_ID, sourceRef: SOURCE_REF });
  console.log('[roundtrip] READ        =', readRes.ok ? 'ok' : `not ok (${readRes.reason})`);
  if (!readRes.ok) {
    if (readRes.reason === 'age_query_failed') {
      console.log('[roundtrip] RESULT      = DB_UNAVAILABLE (read query failed) blocker=', readRes.error);
      process.exitCode = 2;
      return;
    }
    console.log('[roundtrip] RESULT      = FAIL (written but not_found on read-back)');
    process.exitCode = 1;
    return;
  }

  const r = readRes.record;
  console.log('[roundtrip] readRecord  =\n', JSON.stringify(r, null, 2));

  // 3) VERIFY canonical fields survived storage (no undefined canonical field).
  const checks: Array<[string, boolean]> = [
    ['entity.label == Local Gemma', r.entities[0]?.label === 'Local Gemma'],
    ['entity.type == Model', r.entities[0]?.type === 'Model'],
    ['relation.from == e1', r.relations[0]?.from === 'e1'],
    ['relation.to == owl-extraction', r.relations[0]?.to === 'owl-extraction'],
    ['relation.type == performs', r.relations[0]?.type === 'performs'],
    ['categories includes local_model_worker', r.categories.includes('local_model_worker')],
    ['sourceRef matches', r.sourceRef === SOURCE_REF],
    [
      'no undefined canonical fields',
      r.entities[0]?.label !== undefined &&
        r.entities[0]?.type !== undefined &&
        r.relations[0]?.from !== undefined &&
        r.relations[0]?.to !== undefined &&
        r.relations[0]?.type !== undefined,
    ],
  ];
  for (const [name, pass] of checks) console.log(`[roundtrip] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[roundtrip] RESULT      =', allPass ? 'PASS (roundtrip proven)' : 'FAIL (field mismatch)');
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error('[roundtrip] RESULT      = DB_UNAVAILABLE (exception) blocker=', e?.message || e);
  process.exitCode = 2;
});
