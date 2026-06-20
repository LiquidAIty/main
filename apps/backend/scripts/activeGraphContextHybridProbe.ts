// Hybrid ActiveGraphContext live smoke (bounded local Neo4j only; NO Tavily, NO web, NO writes
// of source assertions / ThinkGraph). Reports capability, ensures the full-text index, then
// builds a hybrid (exact + full-text + one-hop) ActiveGraphContext from the project's existing
// RDW/SpaceX source-backed assertions, applies one simulated delta (input only), and proves the
// bounds. Vector mode runs only through a real configured embedding path; otherwise it reports
// the exact blocker.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/activeGraphContextHybridProbe.ts
import { getNeo4jDriver, closeNeo4j } from '../src/connectors/neo4j';
import { readRecentThinkGraphSemanticRecords } from '../src/services/thinkgraph/thinkgraphMemory';
import { applyActiveGraphContextDelta } from '../src/services/graphContext/activeGraphContext';
import { buildActiveGraphContextHybrid, ensureKnowGraphFullTextIndexes, isEmbeddingConfigured } from '../src/services/graphContext/activeGraphContextHybrid';

const PROJECT_ID = process.env.TG_PROJECT_ID || '20ac92da-01fd-4cf6-97cc-0672421e751a';
const TASK = { projectId: PROJECT_ID, taskId: 'task-rdw-spacex', anchors: [{ label: 'Redwire Corporation', type: 'company' }, { label: 'SpaceX', type: 'company' }] };

const readThinkGraph = async (projectId: string, anchors: string[]) => {
  const r = await readRecentThinkGraphSemanticRecords({ projectId, limit: 8 });
  if (!r.ok) return { ok: false, facts: [] as Array<{ label: string }> };
  const al = anchors.map((a) => a.toLowerCase());
  return { ok: true, facts: r.records.flatMap((rec) => rec.entities.map((e) => ({ label: e.label }))).filter((f) => al.includes(f.label.toLowerCase())) };
};
let codeReaderCalled = false;
const readCodeContext = async () => { codeReaderCalled = true; return { ok: true, files: [] }; };

async function reportCapability() {
  const s = getNeo4jDriver().session();
  try {
    const v = await s.run('CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition');
    for (const r of v.records) console.log('[cap] component', r.get('name'), JSON.stringify(r.get('versions')), r.get('edition'));
    console.log('[cap] embeddingConfigured =', isEmbeddingConfigured());
  } finally { await s.close(); }
}

async function main() {
  console.log('[hybrid] projectId =', PROJECT_ID);
  await reportCapability();

  const idx = await ensureKnowGraphFullTextIndexes();
  console.log('[hybrid] fulltext index ensure =', JSON.stringify(idx));
  if (!idx.ok) { console.log('[hybrid] RESULT = LIVE_NEO4J_BLOCKED (index) blocker=', idx.reason); process.exitCode = 2; return; }
  // wait for the full-text index to come online before querying it
  try { const s = getNeo4jDriver().session(); await s.run('CALL db.awaitIndexes(30000)'); await s.close(); } catch { /* best effort */ }

  const { context, retrieval } = await buildActiveGraphContextHybrid(TASK, { readThinkGraph, readCodeContext }, { maxNodes: 12 });
  console.log('[hybrid] retrieval =', JSON.stringify(retrieval));
  console.log('[hybrid] context =', JSON.stringify({ facts: context.facts.length, evidence: context.evidence.length, contradictions: context.contradictions.length, unresolved: context.unresolvedQuestions.length, sourceStats: context.sourceStats }));

  const updated = applyActiveGraphContextDelta(context, { facts: [{ subject: 'SpaceX', predicate: 'has_recent_tender_round', object: 'unknown', outcome: 'uncertain', sourceRef: 'sim-new' }] });
  console.log('[hybrid] second delta =', JSON.stringify(updated.delta));

  const subjects = new Set(context.facts.map((f) => f.subject.toLowerCase()));
  const anchorSubjects = new Set(['redwire corporation', 'spacex']);
  const checks: Array<[string, boolean]> = [
    ['exact anchored retrieval works', retrieval.exactCount > 0],
    ['full-text retrieval finds relevant records', retrieval.fulltextCount > 0],
    ['merged context is bounded (<= maxNodes)', context.facts.length <= 12],
    ['sources deduped in evidence', new Set(context.evidence.map((e) => e.sourceRef)).size === context.evidence.length],
    ['only anchor subjects present (unrelated excluded)', [...subjects].every((s) => anchorSubjects.has(s))],
    ['one-hop expansion is bounded', retrieval.expansionCount <= 12],
    ['second update is delta-only', updated.delta.addedFacts.length === 1],
    ['vector mode honest (ran OR exact blocker)', retrieval.vectorMode === 'ran' || (retrieval.vectorMode === 'unavailable' && !!retrieval.vectorBlocker)],
    ['no whole-graph dump (bounded merged count)', retrieval.mergedCount <= 24],
    ['CodeGraph NOT loaded for research task', codeReaderCalled === false],
    ['retrieval reasons present on evidence', context.evidence.some((e) => /fulltext_exact_match|direct_task_anchor|one_hop/.test(e.reason))],
  ];
  for (const [name, pass] of checks) console.log(`[hybrid] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  const verdict = retrieval.vectorMode === 'ran' ? 'HYBRID_FULLTEXT_VECTOR_PROVEN' : 'FULLTEXT_PROVEN_VECTOR_NOT_CONFIGURED';
  console.log('[hybrid] RESULT =', allPass ? `${verdict} (vectorBlocker=${retrieval.vectorBlocker || 'none'})` : 'PARTIAL (see FAIL lines)');
  process.exitCode = allPass ? 0 : 1;
}

main()
  .catch((e) => { console.error('[hybrid] RESULT = LIVE_NEO4J_BLOCKED (exception) blocker=', e?.message || e); process.exitCode = 2; })
  .finally(async () => { await closeNeo4j().catch(() => {}); });
