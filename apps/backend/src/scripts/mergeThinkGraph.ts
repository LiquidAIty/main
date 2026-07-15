// One-off canonical ThinkGraph project-history merge (project_consolidation).
// Re-parents every Resource/Statement in SRC into DEST by SETting project_id,
// preserving id/kind/label/properties/conversation_id/timestamps EXACTLY and
// only adding migration provenance. CO_OCCURRED_WITH edges follow their
// endpoints automatically (reader matches both by project_id). Collisions get a
// deterministic suffixed id with original_node_id kept + refs rewritten.
// Run:  npx tsx apps/backend/src/scripts/mergeThinkGraph.ts [--apply]
import '../config/env';
import { pool } from '../db/pool';
import * as fs from 'node:fs';

const GRAPH = 'thinkgraph_liq';
const SRC = process.env.MERGE_SRC || '1b1a6958-0658-4b1a-bf13-e2066582adb4';
const DEST = process.env.MERGE_DEST || '20ac92da-01fd-4cf6-97cc-0672421e751a';
const APPLY = process.argv.includes('--apply');
const RUN_ID = 'merge-1b1a6958-to-admin-20260714';
const AT = new Date().toISOString();

function parse(raw: any): any {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}
async function cy(client: any, cypher: string, params?: Record<string, unknown>) {
  const cleaned = cypher.trim().replace(/;$/, '');
  const sql = params
    ? `SELECT * FROM ag_catalog.cypher('${GRAPH}', $$ ${cleaned} $$, $1) AS (row agtype)`
    : `SELECT * FROM ag_catalog.cypher('${GRAPH}', $$ ${cleaned} $$) AS (row agtype)`;
  const res = await client.query(sql, params ? [JSON.stringify(params)] : []);
  return res.rows.map((r: any) => parse(r.row));
}

async function main() {
  const client = await pool.connect();
  try {
    const srcRes = await cy(client,
      `MATCH (n:Resource {project_id:$p}) RETURN {id:n.id,label:n.label,kind:n.kind,conversation_id:n.conversation_id,properties:n.properties,created_at:n.created_at,updated_at:n.updated_at} AS row`, { p: SRC });
    const srcStmt = await cy(client,
      `MATCH (s:Statement {project_id:$p}) RETURN {id:s.id,subject:s.subject,object:s.object,predicate_term:s.predicate_term,conversation_id:s.conversation_id,properties:s.properties} AS row`, { p: SRC });
    const coCount = (await cy(client,
      `MATCH (a:Resource {project_id:$p})-[r:CO_OCCURRED_WITH]->(b:Resource {project_id:$p}) RETURN count(r) AS row`, { p: SRC }))[0];
    const destResIds = new Set((await cy(client, `MATCH (n:Resource {project_id:$p}) RETURN n.id AS row`, { p: DEST })).map((x: any) => String(x)));
    const destStmtIds = new Set((await cy(client, `MATCH (s:Statement {project_id:$p}) RETURN s.id AS row`, { p: DEST })).map((x: any) => String(x)));

    const idRemap = new Map<string, string>();
    for (const r of srcRes) if (destResIds.has(r.id)) idRemap.set(r.id, `${r.id}::src-1b1a6958`);
    const stmtRemap = new Map<string, string>();
    for (const s of srcStmt) if (destStmtIds.has(s.id)) stmtRemap.set(s.id, `${s.id}::src-1b1a6958`);

    const convBreakdown: Record<string, number> = {};
    for (const r of srcRes) { const c = r.conversation_id || '(none)'; convBreakdown[c] = (convBreakdown[c] || 0) + 1; }

    console.log(JSON.stringify({
      step: 'plan', apply: APPLY,
      source: { project: SRC, resources: srcRes.length, statements: srcStmt.length, co_occurred: coCount, conversations: convBreakdown },
      dest: { project: DEST, existing_resources: destResIds.size, existing_statements: destStmtIds.size },
      resource_id_collisions: [...idRemap.entries()],
      statement_id_collisions: [...stmtRemap.entries()],
    }, null, 2));

    if (!APPLY) { console.log('DRY RUN — no writes. Re-run with --apply.'); return; }

    await client.query('BEGIN');
    const prov: Record<string, string> = { original_project_id: SRC, migrated_to_project_id: DEST, migration_run_id: RUN_ID, migrated_at: AT, migration_reason: 'project_consolidation' };
    let movedRes = 0, movedStmt = 0;
    for (const r of srcRes) {
      const newId = idRemap.get(r.id) || r.id;
      const props = { ...(r.properties || {}), ...prov, ...(newId !== r.id ? { original_node_id: r.id } : {}) };
      await cy(client, `MATCH (n:Resource {id:$oldId, project_id:$src}) SET n.project_id=$dest, n.id=$newId, n.properties=$props RETURN n.id`,
        { oldId: r.id, src: SRC, dest: DEST, newId, props });
      movedRes++;
    }
    for (const s of srcStmt) {
      const newId = stmtRemap.get(s.id) || s.id;
      const subj = idRemap.get(s.subject) || s.subject;
      const obj = idRemap.get(s.object) || s.object;
      const props = { ...(s.properties || {}), ...prov, ...(newId !== s.id ? { original_edge_id: s.id } : {}) };
      await cy(client, `MATCH (s:Statement {id:$oldId, project_id:$src}) SET s.project_id=$dest, s.id=$newId, s.subject=$subj, s.object=$obj, s.properties=$props RETURN s.id`,
        { oldId: s.id, src: SRC, dest: DEST, newId, subj, obj, props });
      movedStmt++;
    }
    await client.query('COMMIT');

    const destAfter = (await cy(client, `MATCH (n:Resource {project_id:$p}) RETURN count(n) AS row`, { p: DEST }))[0];
    const srcAfter = (await cy(client, `MATCH (n:Resource {project_id:$p}) RETURN count(n) AS row`, { p: SRC }))[0];
    const report = {
      step: 'applied', migration_run_id: RUN_ID, migrated_at: AT,
      moved_resources: movedRes, moved_statements: movedStmt,
      remapped_resources: [...idRemap.entries()], remapped_statements: [...stmtRemap.entries()],
      dest_resources_after: destAfter, src_resources_after: srcAfter,
      rollback: `SET project_id back to ${SRC} WHERE properties.migration_run_id='${RUN_ID}'`,
    };
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync('coder-workspace/thinkgraph-merge-1b1a6958-to-admin.json',
      JSON.stringify({ ...report, source_resources: srcRes.map((r: any) => ({ id: r.id, kind: r.kind, conversation_id: r.conversation_id })), source_statements: srcStmt.map((s: any) => ({ id: s.id, predicate: s.predicate_term })) }, null, 2));
    console.log('artifact: coder-workspace/thinkgraph-merge-1b1a6958-to-admin.json');
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error('MIGRATION_FAILED', e?.stack || e); process.exit(1); });
