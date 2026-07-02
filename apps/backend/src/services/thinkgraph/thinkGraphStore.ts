// @graph entity: ThinkGraphStore
// @graph role: thinkgraph-read-projection
// @graph relates_to: ThinkGraph card graph-view
// @graph depends_on: Apache AGE, Postgres
//
// READ-ONLY projection of ThinkGraph records for the existing ThinkGraph card.
// ThinkGraph is written ONLY by the Harness calling the ThinkGraph agent card
// (the canonical server-side writer — not yet wired; see graph-write-authority).
// Until real records exist the card is honestly empty. No semantics are invented
// here: this returns exactly what is stored.
//
// Stored shape this reads (storage mechanics, not a taxonomy):
//   (:Resource {id, project_id, label, ...})
//   (:Resource)-[:CO_OCCURRED_WITH {observation_count, first/last_observed,
//                latest_context_id}]->(:Resource)   ← derived observation layer
//   (:Statement {id, subject, predicate_term, object, review, rationale, ...})

import type { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { ensureVertexLabel, runCypherOnGraph } from '../graphService';

const GRAPH = 'thinkgraph_liq';

export type ThinkGraphViewNode = {
  id: string; label: string; kind: 'resource' | 'statement'; review?: string;
  turnId?: string; degree?: number;
  // Direct stored provenance (SPEC: projection must prove pair/card/run identity).
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  cardId?: string;
  correlationId?: string;
  updatedAt?: string;
};
export type ThinkGraphViewEdge = {
  id: string; source: string; target: string; predicate: string; weight?: number;
  latestContextId?: string;
};
export type ThinkGraphView = { nodes: ThinkGraphViewNode[]; edges: ThinkGraphViewEdge[] };

function s(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function parseRow(raw: unknown): Record<string, any> | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

/** Direct bounded projection of stored ThinkGraph records. Fails honestly on DB errors. */
export async function getThinkGraphView(args: { projectId: string; limit?: number }): Promise<ThinkGraphView> {
  const projectId = s(args.projectId).trim();
  if (!projectId) return { nodes: [], edges: [] };
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 500) || 500, 1), 2000);

  const resourceRows = await runCypherOnGraph(
    GRAPH,
    `MATCH (n:Resource {project_id: $projectId})
     RETURN { id: n.id, label: n.label, turn_id: n.last_turn_id,
              conversation_id: n.conversation_id, user_message_id: n.source_user_message_id,
              assistant_message_id: n.source_assistant_message_id, card_id: n.card_id,
              correlation_id: n.correlation_id, updated_at: n.updated_at } AS row LIMIT ${limit}`,
    { projectId },
  );
  const statementRows = await runCypherOnGraph(
    GRAPH,
    `MATCH (st:Statement {project_id: $projectId})
     RETURN { id: st.id, subject: st.subject, predicate_term: st.predicate_term, object: st.object,
              review: st.review, rationale: st.rationale, turn_id: st.turn_id,
              conversation_id: st.conversation_id, user_message_id: st.source_user_message_id,
              assistant_message_id: st.source_assistant_message_id, card_id: st.card_id,
              correlation_id: st.correlation_id, updated_at: st.updated_at } AS row LIMIT 500`,
    { projectId },
  );
  const coRows = await runCypherOnGraph(
    GRAPH,
    `MATCH (a:Resource {project_id: $projectId})-[r:CO_OCCURRED_WITH]->(b:Resource {project_id: $projectId})
     RETURN { from: a.id, to: b.id, weight: r.observation_count, latest_context: r.latest_context_id } AS row LIMIT 8000`,
    { projectId },
  );

  const provenanceOf = (r: Record<string, any>) => ({
    conversationId: s(r.conversation_id) || undefined,
    userMessageId: s(r.user_message_id) || undefined,
    assistantMessageId: s(r.assistant_message_id) || undefined,
    cardId: s(r.card_id) || undefined,
    correlationId: s(r.correlation_id) || undefined,
    updatedAt: s(r.updated_at) || undefined,
  });

  const nodes: ThinkGraphViewNode[] = resourceRows
    .map(parseRow)
    .filter((r): r is Record<string, any> => Boolean(r?.id))
    .map((r) => ({
      id: s(r.id), label: s(r.label) || s(r.id), kind: 'resource' as const,
      turnId: s(r.turn_id) || undefined,
      ...provenanceOf(r),
    }));
  const ids = new Set(nodes.map((n) => n.id));

  const edges: ThinkGraphViewEdge[] = coRows
    .map(parseRow)
    .filter((r): r is Record<string, any> => Boolean(r?.from && r?.to))
    .filter((r) => ids.has(s(r.from)) && ids.has(s(r.to)))
    .map((r, i) => ({
      id: `${s(r.from)}|co|${s(r.to)}|${i}`,
      source: s(r.from), target: s(r.to), predicate: 'co_occurred_with',
      weight: Number(r.weight) > 0 ? Number(r.weight) : undefined,
      latestContextId: s(r.latest_context) || undefined,
    }));

  // Statements render as first-class markers wired to their endpoints when loaded.
  for (const raw of statementRows) {
    const r = parseRow(raw);
    if (!r?.id) continue;
    const stId = s(r.id);
    nodes.push({
      id: stId,
      label: s(r.rationale) || `${s(r.subject)} —${s(r.predicate_term)}→ ${s(r.object)}`,
      kind: 'statement',
      review: s(r.review) || 'provisional',
      turnId: s(r.turn_id) || undefined,
      ...provenanceOf(r),
    });
    if (ids.has(s(r.subject))) {
      edges.push({ id: `${stId}|subj`, source: s(r.subject), target: stId, predicate: s(r.predicate_term) || 'statement' });
    }
    if (ids.has(s(r.object))) {
      edges.push({ id: `${stId}|obj`, source: stId, target: s(r.object), predicate: s(r.predicate_term) || 'statement' });
    }
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  for (const n of nodes) n.degree = degree.get(n.id) || 0;

  return { nodes, edges };
}

/** Bounded read scope for the ThinkGraph card run — same projection the view uses. */
export async function readThinkGraphScope(args: { projectId: string; limit?: number }): Promise<ThinkGraphView> {
  return getThinkGraphView({ projectId: args.projectId, limit: Math.min(Math.trunc(args.limit ?? 300) || 300, 500) });
}

// ── THE one ThinkGraph writer: card-authorized transactional patch ───────────────────────
// Callable only through the ThinkGraph card's apply_thinkgraph_patch tool authority
// (the bridge injects trusted run context; the model supplies only the patch body).
// Persistence enforces ONLY: project scope, card authority presence, schema shape
// (labels fixed by construction: Resource / Statement / CO_OCCURRED_WITH), record
// identity, complete source-pair provenance, idempotency, size limits, and one AGE
// transaction. It never decides what a concept means or which records matter.

const PATCH_MAX_RESOURCES = 40;
const PATCH_MAX_RELATIONS = 80;
const PATCH_MAX_STATEMENTS = 30;
const PATCH_MAX_TEXT = 2000;

export type ThinkGraphPatchAuthority = {
  projectId: string;
  cardId: string;
  correlationId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

export type ThinkGraphPatch = {
  resources?: Array<{ id: string; label: string }>;
  relations?: Array<{ a: string; b: string }>;
  statements?: Array<{
    id: string; subject: string; predicateTerm: string; object: string;
    rationale?: string; review?: string;
  }>;
};

export type ApplyThinkGraphPatchResult =
  | {
      ok: true;
      status: 'applied' | 'duplicate' | 'empty';
      correlationId: string;
      storedResourceIds: string[];
      storedStatementIds: string[];
      relationCount: number;
    }
  | { ok: false; error: string };

function clip(v: unknown): string {
  const t = s(v);
  return t.length > PATCH_MAX_TEXT ? t.slice(0, PATCH_MAX_TEXT) : t;
}

/** Structural/ownership validation only. Returns an honest error string or null. */
export function validateThinkGraphPatch(
  authority: ThinkGraphPatchAuthority,
  patch: ThinkGraphPatch,
): string | null {
  for (const k of ['projectId', 'cardId', 'correlationId', 'conversationId', 'userMessageId', 'assistantMessageId'] as const) {
    if (!s(authority?.[k]).trim()) return `patch_authority_${k}_missing`;
  }
  const resources = patch?.resources ?? [];
  const relations = patch?.relations ?? [];
  const statements = patch?.statements ?? [];
  if (resources.length > PATCH_MAX_RESOURCES) return 'patch_too_many_resources';
  if (relations.length > PATCH_MAX_RELATIONS) return 'patch_too_many_relations';
  if (statements.length > PATCH_MAX_STATEMENTS) return 'patch_too_many_statements';
  for (const r of resources) {
    if (!s(r?.id).trim()) return 'patch_resource_id_required';
    if (!s(r?.label).trim()) return `patch_resource_label_required: ${r.id}`;
  }
  for (const rel of relations) {
    const a = s(rel?.a).trim();
    const b = s(rel?.b).trim();
    if (!a || !b) return 'patch_relation_endpoints_required';
    if (a === b) return `patch_relation_self_pair_rejected: ${a}`;
  }
  for (const st of statements) {
    if (!s(st?.id).trim()) return 'patch_statement_id_required';
    if (!s(st?.subject).trim() || !s(st?.object).trim()) return `patch_statement_endpoints_required: ${st.id}`;
    if (!s(st?.predicateTerm).trim()) return `patch_statement_predicate_required: ${st.id}`;
  }
  return null;
}

/** Client-scoped cypher — same SQL shape as graphService.runCypherOnGraph, but on one
 * transaction connection so the whole patch commits or rolls back atomically. */
async function cypherOnClient(
  client: PoolClient,
  cypher: string,
  params?: Record<string, unknown>,
): Promise<unknown[]> {
  const cleaned = cypher.trim().replace(/;$/, '');
  if (cleaned.includes('$$')) throw new Error('cypher query cannot contain $$');
  const sql = params
    ? `SELECT * FROM ag_catalog.cypher('${GRAPH}', $$ ${cleaned} $$, $1) AS (row agtype)`
    : `SELECT * FROM ag_catalog.cypher('${GRAPH}', $$ ${cleaned} $$) AS (row agtype)`;
  const res = await client.query(sql, params ? [JSON.stringify(params)] : []);
  return res.rows.map((r: any) => r.row);
}

export async function applyThinkGraphPatch(
  authority: ThinkGraphPatchAuthority,
  patch: ThinkGraphPatch,
): Promise<ApplyThinkGraphPatchResult> {
  const err = validateThinkGraphPatch(authority, patch);
  if (err) return { ok: false, error: err };

  const resources = patch.resources ?? [];
  const relations = patch.relations ?? [];
  const statements = patch.statements ?? [];
  const correlationId = s(authority.correlationId).trim();
  if (!resources.length && !relations.length && !statements.length) {
    return { ok: true, status: 'empty', correlationId, storedResourceIds: [], storedStatementIds: [], relationCount: 0 };
  }

  const projectId = s(authority.projectId).trim();
  const ts = new Date().toISOString();
  const prov = {
    projectId,
    cardId: s(authority.cardId).trim(),
    correlationId,
    conversationId: s(authority.conversationId).trim(),
    userMessageId: s(authority.userMessageId).trim(),
    assistantMessageId: s(authority.assistantMessageId).trim(),
    ts,
  };

  // Labels are idempotently ensured OUTSIDE the transaction (AGE label DDL).
  for (const label of ['Resource', 'Statement', 'ThinkDeltaApplied']) {
    await ensureVertexLabel(GRAPH, label);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency inside the transaction: same correlation key applies once.
    const marker = await cypherOnClient(
      client,
      `MATCH (m:ThinkDeltaApplied {project_id: $projectId, correlation_id: $correlationId}) RETURN m.correlation_id LIMIT 1`,
      { projectId, correlationId },
    );
    if (Array.isArray(marker) && marker.length > 0) {
      await client.query('ROLLBACK');
      return { ok: true, status: 'duplicate', correlationId, storedResourceIds: [], storedStatementIds: [], relationCount: 0 };
    }

    const storedResourceIds: string[] = [];
    for (const r of resources) {
      await cypherOnClient(
        client,
        `MERGE (n:Resource {id: $id, project_id: $projectId})
         SET n.label = $label, n.last_turn_id = $correlationId,
             n.card_id = $cardId, n.correlation_id = $correlationId,
             n.conversation_id = $conversationId,
             n.source_user_message_id = $userMessageId,
             n.source_assistant_message_id = $assistantMessageId,
             n.created_at = coalesce(n.created_at, $ts), n.updated_at = $ts
         RETURN n.id`,
        { id: s(r.id).trim(), label: clip(r.label), ...prov },
      );
      storedResourceIds.push(s(r.id).trim());
    }

    let relationCount = 0;
    const seenPairs = new Set<string>();
    for (const rel of relations) {
      const a = s(rel.a).trim();
      const b = s(rel.b).trim();
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const key = `${lo}|${hi}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      await cypherOnClient(
        client,
        `MATCH (x:Resource {id: $lo, project_id: $projectId})
         MATCH (y:Resource {id: $hi, project_id: $projectId})
         MERGE (x)-[r:CO_OCCURRED_WITH]->(y)
         SET r.observation_count = coalesce(r.observation_count, 0) + 1,
             r.first_observed = coalesce(r.first_observed, $ts), r.last_observed = $ts,
             r.card_id = $cardId, r.correlation_id = $correlationId
         RETURN r.observation_count`,
        { lo, hi, ...prov },
      );
      relationCount += 1;
    }

    const storedStatementIds: string[] = [];
    for (const st of statements) {
      await cypherOnClient(
        client,
        `MERGE (s:Statement {id: $id, project_id: $projectId})
         SET s.subject = $subject, s.predicate_term = $predicateTerm, s.object = $object,
             s.review = $review, s.rationale = $rationale, s.turn_id = $correlationId,
             s.card_id = $cardId, s.correlation_id = $correlationId,
             s.conversation_id = $conversationId,
             s.source_user_message_id = $userMessageId,
             s.source_assistant_message_id = $assistantMessageId,
             s.created_at = coalesce(s.created_at, $ts), s.updated_at = $ts
         RETURN s.id`,
        {
          id: s(st.id).trim(), subject: s(st.subject).trim(), predicateTerm: s(st.predicateTerm).trim(),
          object: s(st.object).trim(), review: s(st.review).trim() || 'provisional',
          rationale: clip(st.rationale), ...prov,
        },
      );
      storedStatementIds.push(s(st.id).trim());
    }

    await cypherOnClient(
      client,
      `CREATE (m:ThinkDeltaApplied {project_id: $projectId, correlation_id: $correlationId,
               card_id: $cardId, conversation_id: $conversationId,
               source_user_message_id: $userMessageId, source_assistant_message_id: $assistantMessageId,
               ts: $ts})
       RETURN m.correlation_id`,
      prov,
    );

    await client.query('COMMIT');
    return { ok: true, status: 'applied', correlationId, storedResourceIds, storedStatementIds, relationCount };
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    return { ok: false, error: `thinkgraph_patch_failed: ${error?.message || 'age_error'}` };
  } finally {
    client.release();
  }
}
