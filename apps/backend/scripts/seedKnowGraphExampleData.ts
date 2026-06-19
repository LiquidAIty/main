// Restore the EXISTING KnowGraph example dataset (semantic seed) for a project via the proven
// route logic (runKnowGraphSemanticSeed -> project-scoped Neo4j :SemanticRecord nodes). Used
// when the seed POST is CORS-blocked from a preview origin. NO new write path, NO fake nodes —
// the same records buildSemanticSeedRecords/the /api/knowgraph/semantic-seed route persists.
//   TG_PROJECT_ID=<id> npx tsx --env-file=apps/backend/.env apps/backend/scripts/seedKnowGraphExampleData.ts
import { runKnowGraphSemanticSeed } from '../src/routes/knowgraph.routes';

const PROJECT_ID = process.env.TG_PROJECT_ID || '20ac92da-01fd-4cf6-97cc-0672421e751a';

async function main() {
  console.log('[kg-seed] projectId =', PROJECT_ID);
  const result = await runKnowGraphSemanticSeed(PROJECT_ID);
  console.log('[kg-seed] httpStatus =', result.httpStatus);
  console.log('[kg-seed] body =', JSON.stringify(result.body, null, 2));
  process.exitCode = result.httpStatus === 200 && result.body?.ok ? 0 : 2;
}

main().catch((e) => {
  console.error('[kg-seed] FAILED blocker=', e?.message || e);
  process.exitCode = 2;
});
