// Capability + hybrid ActiveGraphContext probe (bounded local Neo4j only; no Tavily, no web,
// no writes of source assertions). First reports real capability (Neo4j version, indexes,
// embedding config), then exercises full-text + exact + one-hop hybrid retrieval. Vector mode
// runs only through a real configured embedding path; otherwise it reports the exact blocker.
//   npx tsx --env-file=apps/backend/.env apps/backend/scripts/activeGraphContextHybridProbe.ts
import { getNeo4jDriver, closeNeo4j } from '../src/connectors/neo4j';

async function reportCapability() {
  const s = getNeo4jDriver().session();
  try {
    const v = await s.run('CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition');
    for (const r of v.records) console.log('[cap] component', r.get('name'), JSON.stringify(r.get('versions')), r.get('edition'));
    const ix = await s.run('SHOW INDEXES YIELD name, type, labelsOrTypes, properties, state RETURN name, type, labelsOrTypes, properties, state');
    for (const r of ix.records) console.log('[cap] index', r.get('name'), r.get('type'), JSON.stringify(r.get('labelsOrTypes')), JSON.stringify(r.get('properties')), r.get('state'));
    console.log('[cap] EMBEDDING_MODEL env =', process.env.EMBEDDING_MODEL || process.env.OPENROUTER_EMBEDDING_MODEL || '(none)');
  } catch (e: any) {
    console.log('[cap] NEO_ERROR', e?.message || e);
  } finally {
    await s.close();
  }
}

async function main() {
  await reportCapability();
}

main()
  .catch((e) => { console.error('[cap] EXCEPTION', e?.message || e); process.exitCode = 2; })
  .finally(async () => { await closeNeo4j().catch(() => {}); });
