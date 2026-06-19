// Live KnowGraph static-source probe. Converts ONE static source chunk into a
// deterministic normalized KnowGraph extraction (NO model call), writes it to the real
// KnowGraph (Neo4j) store, reads it back, verifies canonical fields. Honest about DB
// availability.
//   npx tsx apps/backend/scripts/knowGraphStaticSourceProbe.ts
import { createHash } from 'crypto';
import {
  closeKnowGraphDriver,
  readKnowGraphSourceRecord,
  writeKnowGraphSourceRecord,
  type KnowGraphSourceRecord,
} from '../src/services/knowGraphSourceStore';

const PROJECT_ID = 'kg-static-source-test';
const SOURCE_REF = 'static-knowgraph-source-1';
const TITLE = 'Local graph intelligence note';
const TEXT =
  'LiquidAIty uses a local Gemma model as a graph extraction worker. The worker converts ' +
  'source chunks into OWL-shaped JSON with entities, relations, source references, confidence, ' +
  'and uncertainty. Validated records can be written into KnowGraph so future graph search can ' +
  'start from entity, relation, and class neighborhoods instead of raw keyword search.';

// Deterministic normalized extraction for the static chunk (the SPEC's expected meaning).
const RECORD: KnowGraphSourceRecord = {
  projectId: PROJECT_ID,
  sourceRef: SOURCE_REF,
  sourceType: 'static_source_chunk',
  title: TITLE,
  textHash: createHash('sha256').update(TEXT, 'utf8').digest('hex'),
  entities: [
    { id: 'e1', label: 'LiquidAIty', type: 'System', confidence: 0.9 },
    { id: 'e2', label: 'Local Gemma', type: 'Model', confidence: 0.95 },
    { id: 'e3', label: 'graph extraction worker', type: 'Worker', confidence: 0.9 },
    { id: 'e4', label: 'OWL-shaped JSON', type: 'DataFormat', confidence: 0.85 },
    { id: 'e5', label: 'KnowGraph', type: 'Graph', confidence: 0.9 },
    { id: 'e6', label: 'graph search', type: 'Process', confidence: 0.85 },
  ],
  relations: [
    { from: 'e1', to: 'e2', type: 'uses', confidence: 0.9 },
    { from: 'e2', to: 'e3', type: 'performs', confidence: 0.9 },
    { from: 'e3', to: 'e4', type: 'produces', confidence: 0.85 },
    { from: 'e3', to: 'e5', type: 'written_to', confidence: 0.85 },
    { from: 'e6', to: 'e5', type: 'starts_from', confidence: 0.8 },
  ],
  categories: ['local_model_worker', 'knowgraph_ingestion', 'graph_search'],
  assertions: [],
  sourceRefs: [{ ref: SOURCE_REF, kind: 'static_source' }],
  confidence: 0.85,
  uncertainty: ['0.15'],
  createdBy: 'staticKnowGraphProbe',
};

async function main() {
  console.log('[kg-static] store     = KnowGraph (Neo4j)');
  console.log('[kg-static] projectId =', PROJECT_ID);
  console.log('[kg-static] sourceRef =', SOURCE_REF);

  // 1) WRITE through the real KnowGraph write path.
  const writeRes = await writeKnowGraphSourceRecord(RECORD);
  console.log('[kg-static] WRITE     =', JSON.stringify(writeRes));
  if (!writeRes.ok) {
    console.log('[kg-static] RESULT    = DB_UNAVAILABLE (write failed) blocker=', writeRes.error);
    process.exitCode = 2;
    return;
  }

  // 2) READ back from real Neo4j.
  const readRes = await readKnowGraphSourceRecord({ projectId: PROJECT_ID, sourceRef: SOURCE_REF });
  if (!readRes.ok) {
    if (readRes.reason === 'knowgraph_query_failed') {
      console.log('[kg-static] RESULT    = DB_UNAVAILABLE (read failed) blocker=', readRes.error);
      process.exitCode = 2;
    } else {
      console.log('[kg-static] RESULT    = FAIL (written but not_found on read-back)');
      process.exitCode = 1;
    }
    return;
  }

  const r = readRes.record;
  console.log('[kg-static] readRecord =\n', JSON.stringify(r, null, 2));

  const entityByLabel = (label: string) => r.entities.find((e) => e.label === label);
  const hasRel = (from: string, to: string, type: string) =>
    r.relations.some((x) => x.from === from && x.to === to && x.type === type);
  const checks: Array<[string, boolean]> = [
    ['entity LiquidAIty type System', entityByLabel('LiquidAIty')?.type === 'System'],
    ['entity Local Gemma type Model', entityByLabel('Local Gemma')?.type === 'Model'],
    ['entity KnowGraph type Graph', entityByLabel('KnowGraph')?.type === 'Graph'],
    ['relation e1-uses->e2', hasRel('e1', 'e2', 'uses')],
    ['relation e3-written_to->e5', hasRel('e3', 'e5', 'written_to')],
    ['category local_model_worker', r.categories.includes('local_model_worker')],
    ['category knowgraph_ingestion', r.categories.includes('knowgraph_ingestion')],
    ['category graph_search', r.categories.includes('graph_search')],
    ['sourceRef preserved', r.sourceRef === SOURCE_REF],
    [
      'no undefined canonical fields',
      r.entities.every((e) => e.label !== undefined && e.type !== undefined) &&
        r.relations.every((x) => x.from !== undefined && x.to !== undefined && x.type !== undefined),
    ],
  ];
  for (const [name, pass] of checks) console.log(`[kg-static] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[kg-static] RESULT    =', allPass ? 'PASS (knowgraph static-source write+read proven)' : 'FAIL');
  process.exitCode = allPass ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('[kg-static] RESULT    = DB_UNAVAILABLE (exception) blocker=', e?.message || e);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeKnowGraphDriver().catch(() => {});
  });
