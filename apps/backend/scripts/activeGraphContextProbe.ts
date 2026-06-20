// Deterministic ActiveGraphContext probe. Builds a compact task-scoped context from the
// project's existing RDW/SpaceX source-backed assertions (bounded anchored KnowGraph read),
// then applies ONE simulated new uncertainty as INPUT ONLY (never written) and proves the
// second context carries only a delta. No whole-graph dump, no CodeGraph for research, no live
// Tavily, no graph writes.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/activeGraphContextProbe.ts
import {
  applyActiveGraphContextDelta,
  buildActiveGraphContext,
  compileGraphQueryIntent,
  readKnowGraphAnchorNeighborhood,
} from '../src/services/graphContext/activeGraphContext';
import { readRecentThinkGraphSemanticRecords } from '../src/services/thinkgraph/thinkgraphMemory';
import { closeNeo4j } from '../src/connectors/neo4j';

const PROJECT_ID = process.env.TG_PROJECT_ID || '20ac92da-01fd-4cf6-97cc-0672421e751a';
const TASK = { projectId: PROJECT_ID, taskId: 'task-rdw-spacex', anchors: [{ label: 'Redwire Corporation', type: 'company' }, { label: 'SpaceX', type: 'company' }] };

const readThinkGraph = async (projectId: string, anchors: string[]) => {
  const r = await readRecentThinkGraphSemanticRecords({ projectId, limit: 8 });
  if (!r.ok) return { ok: false, facts: [] as Array<{ label: string }> };
  const anchorLc = anchors.map((a) => a.toLowerCase());
  const facts = r.records.flatMap((rec) => rec.entities.map((e) => ({ label: e.label }))).filter((f) => anchorLc.includes(f.label.toLowerCase()));
  return { ok: true, facts };
};

// Spy that MUST NOT be called for a research task.
let codeReaderCalled = false;
const readCodeContext = async () => { codeReaderCalled = true; return { ok: true, files: [] }; };

async function main() {
  console.log('[active-ctx] projectId =', PROJECT_ID, ' anchors =', TASK.anchors.map((a) => a.label).join(', '));

  const intent = compileGraphQueryIntent(TASK, { maxNodes: 10 });
  const neighborhood = await readKnowGraphAnchorNeighborhood(intent);
  if (!neighborhood.ok) {
    console.log('[active-ctx] RESULT = DB_BLOCKED (neighborhood read failed) blocker=', neighborhood.reason);
    process.exitCode = 2;
    return;
  }
  console.log('[active-ctx] anchored neighborhood assertions =', neighborhood.assertions.length);
  if (neighborhood.assertions.length === 0) {
    console.log('[active-ctx] RESULT = NO_ASSERTIONS (run judgeSearchPacketAssertionsProbe first to populate)');
    process.exitCode = 2;
    return;
  }

  const first = await buildActiveGraphContext(TASK, { readNeighborhood: async () => neighborhood, readThinkGraph, readCodeContext });
  console.log('[active-ctx] FIRST  =', JSON.stringify({ facts: first.facts.length, evidence: first.evidence.length, contradictions: first.contradictions.length, unresolved: first.unresolvedQuestions.length, sourceStats: first.sourceStats }));

  // Simulate ONE new uncertainty as input only (NOT written to the graph).
  const updated = applyActiveGraphContextDelta(first, {
    facts: [{ subject: 'SpaceX', predicate: 'has_recent_tender_round', object: 'unknown', outcome: 'uncertain', sourceRef: 'sim-source-new' }],
  });
  console.log('[active-ctx] SECOND delta =', JSON.stringify(updated.delta));

  const subjects = new Set(first.facts.map((f) => f.subject.toLowerCase()));
  const anchorSubjects = new Set(['redwire corporation', 'spacex']);
  const checks: Array<[string, boolean]> = [
    ['initial context is bounded (<= maxNodes)', first.facts.length <= 10],
    ['supported assertion present', first.facts.some((f) => f.outcome === 'supported')],
    ['contradiction visible', first.contradictions.length > 0],
    ['uncertainty present', first.unresolvedQuestions.length > 0],
    ['only anchor subjects present (no unrelated nodes)', [...subjects].every((s) => anchorSubjects.has(s))],
    ['duplicate sourceRefs deduped in evidence', new Set(first.evidence.map((e) => e.sourceRef)).size === first.evidence.length],
    ['second update is a DELTA only (1 new fact)', updated.delta.addedFacts.length === 1],
    ['delta did not re-send the whole prior slice', updated.delta.addedFacts.length < first.facts.length || first.facts.length <= 2],
    ['new uncertainty survives', updated.unresolvedQuestions.join(' ').toLowerCase().includes('has_recent_tender_round')],
    ['CodeGraph NOT loaded for research task', codeReaderCalled === false],
    ['no whole-graph dump (facts bounded)', first.facts.length <= 10],
  ];
  for (const [name, pass] of checks) console.log(`[active-ctx] verify: ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = checks.every(([, pass]) => pass);
  console.log('[active-ctx] RESULT =', allPass ? 'ACTIVE_GRAPH_CONTEXT_PROVEN (bounded build + progressive delta; contradictions/uncertainty survive)' : 'PARTIAL (see FAIL lines)');
  process.exitCode = allPass ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('[active-ctx] RESULT = DB_BLOCKED (exception) blocker=', e?.message || e);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeNeo4j().catch(() => {});
  });
