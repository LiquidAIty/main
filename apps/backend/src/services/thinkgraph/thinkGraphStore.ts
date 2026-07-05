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
//   (:Resource {id, project_id, label, kind?, properties?, mention_count,
//               last_mentioned_at, mentioned_correlation_ids, ...})
//   (:Resource)-[:CO_OCCURRED_WITH {observation_count, first/last_observed,
//                latest_context_id}]->(:Resource)   ← derived observation layer
//   (:Statement {id, subject, predicate_term, object, review, rationale, tag?,
//                properties?, mention_count, last_mentioned_at,
//                mentioned_correlation_ids, ...})
//
// Mention counting is provenance-gated, not MERGE-gated: a Resource/Statement's
// mention_count increases only the first time a given correlationId (one real
// source message/turn) is attached to it — tracked via the internal
// `mentioned_correlation_ids` list, never returned to callers. Replaying the
// same correlationId (retry, duplicate tool call) never inflates the count;
// the whole-patch ThinkDeltaApplied idempotency guard already blocks that
// case before these writes run at all, and this list is a second, narrower
// guard against the same resource/statement appearing more than once inside
// one patch. `provenanceCount` returned to callers is the same integer as
// `mentionCount` in this v1 — they are defined identically (one new
// correlationId = one new mention = one new provenance reference).

import type { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { ensureVertexLabel, runCypherOnGraph } from '../graphService';

const GRAPH = 'thinkgraph_liq';

export type ThinkGraphViewNode = {
  id: string; label: string; kind: 'resource' | 'statement'; itemKind?: string; review?: string;
  turnId?: string; degree?: number;
  properties?: Record<string, unknown>;
  mentionCount: number;
  lastMentionedAt?: string;
  provenanceCount: number;
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
  properties?: Record<string, unknown>;
  mentionCount: number;
  lastMentionedAt?: string;
  provenanceCount: number;
};
export type ThinkGraphView = {
  nodes: ThinkGraphViewNode[];
  edges: ThinkGraphViewEdge[];
};

function s(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function parseRow(raw: unknown): Record<string, any> | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

function n(v: unknown): number {
  const num = Number(v);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function properties(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const keys = Object.keys(v as Record<string, unknown>);
  return keys.length > 0 ? (v as Record<string, unknown>) : undefined;
}

/** Direct bounded projection of stored ThinkGraph records. Fails honestly on DB errors. */
export async function getThinkGraphView(args: { projectId: string; limit?: number }): Promise<ThinkGraphView> {
  const projectId = s(args.projectId).trim();
  if (!projectId) return { nodes: [], edges: [] };
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 500) || 500, 1), 2000);

  const resourceRows = await runCypherOnGraph(
    GRAPH,
    `MATCH (n:Resource {project_id: $projectId})
     RETURN { id: n.id, label: n.label, kind: n.kind, turn_id: n.last_turn_id,
              properties: n.properties, mention_count: n.mention_count,
              last_mentioned_at: n.last_mentioned_at,
              conversation_id: n.conversation_id, user_message_id: n.source_user_message_id,
              assistant_message_id: n.source_assistant_message_id, card_id: n.card_id,
              correlation_id: n.correlation_id, updated_at: n.updated_at } AS row
     ORDER BY n.updated_at DESC LIMIT ${limit}`,
    { projectId },
  );
  const statementRows = await runCypherOnGraph(
    GRAPH,
    `MATCH (st:Statement {project_id: $projectId})
     RETURN { id: st.id, subject: st.subject, predicate_term: st.predicate_term, object: st.object,
              review: st.review, rationale: st.rationale, tag: st.tag, turn_id: st.turn_id,
              properties: st.properties, mention_count: st.mention_count,
              last_mentioned_at: st.last_mentioned_at,
              conversation_id: st.conversation_id, user_message_id: st.source_user_message_id,
              assistant_message_id: st.source_assistant_message_id, card_id: st.card_id,
              correlation_id: st.correlation_id, updated_at: st.updated_at } AS row
     ORDER BY st.updated_at DESC LIMIT 500`,
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
    .map((r) => {
      const mentionCount = n(r.mention_count);
      return {
        id: s(r.id), label: s(r.label) || s(r.id), kind: 'resource' as const,
        itemKind: s(r.kind) || undefined,
        turnId: s(r.turn_id) || undefined,
        properties: properties(r.properties),
        mentionCount,
        lastMentionedAt: s(r.last_mentioned_at) || undefined,
        provenanceCount: mentionCount,
        ...provenanceOf(r),
      };
    });
  const ids = new Set(nodes.map((n) => n.id));

  const edges: ThinkGraphViewEdge[] = coRows
    .map(parseRow)
    .filter((r): r is Record<string, any> => Boolean(r?.from && r?.to))
    .filter((r) => ids.has(s(r.from)) && ids.has(s(r.to)))
    .map((r, i) => {
      const weight = n(r.weight);
      return {
        id: `${s(r.from)}|co|${s(r.to)}|${i}`,
        source: s(r.from), target: s(r.to), predicate: 'co_occurred_with',
        weight: weight > 0 ? weight : undefined,
        latestContextId: s(r.latest_context) || undefined,
        mentionCount: weight,
        provenanceCount: weight,
      };
    });

  // Statements are DIRECT relationships (subject -> object), never rendered
  // as their own node — one edge per statement, endpoints only wired when
  // both actually resolve to a returned resource in this slice.
  for (const raw of statementRows) {
    const r = parseRow(raw);
    if (!r?.id) continue;
    const stId = s(r.id);
    const subject = s(r.subject);
    const object = s(r.object);
    if (ids.has(subject) && ids.has(object)) {
      const mentionCount = n(r.mention_count);
      edges.push({
        id: stId, source: subject, target: object, predicate: s(r.predicate_term) || 'statement',
        properties: properties(r.properties),
        mentionCount,
        lastMentionedAt: s(r.last_mentioned_at) || undefined,
        provenanceCount: mentionCount,
      });
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
const ITEM_KIND_MAX_LEN = 60;
const RELATION_TAG_MAX_LEN = 60;
const PROPERTIES_MAX_KEYS = 20;
const PROPERTY_KEY_MAX_LEN = 60;
const PROPERTY_VALUE_MAX_LEN = 200;

// `kind` (resources) and `tag` (statements) are optional, model-authored, and
// free-form — NOT a forced ontology and NOT enum-validated. Python/TS validate
// STRUCTURE only (present → non-empty, compact, single line); the model chooses
// the meaning.
//
// The one real safety rule: a statement's `review` status may never claim
// source-backed evidence merely because chat language asserted it — that
// requires an actual persisted source/evidence reference, which does not yet
// exist as a patch primitive. So those specific status words are rejected
// outright; any other free-text review value is accepted as-is.
const REVIEW_REQUIRES_REAL_EVIDENCE = ['source_linked', 'supported', 'evidenced', 'verified'];

// userMessageId/assistantMessageId are optional: present for a completed-pair
// caller (real persisted message ids) and absent for a live in-progress
// OpenClaude turn, which has no completed pair yet. correlationId is always
// required and is real, trusted, per-call provenance either way — a live
// caller must never fabricate message ids merely to satisfy this shape.
export type ThinkGraphPatchAuthority = {
  projectId: string;
  cardId: string;
  correlationId: string;
  conversationId: string;
  userMessageId?: string;
  assistantMessageId?: string;
};

export type ThinkGraphProperties = Record<string, string | number | boolean>;

export type ThinkGraphPatch = {
  resources?: Array<{ id: string; label: string; kind?: string; properties?: ThinkGraphProperties }>;
  relations?: Array<{ a: string; b: string }>;
  statements?: Array<{
    id: string; subject: string; predicateTerm: string; object: string;
    rationale?: string; review?: string; tag?: string; properties?: ThinkGraphProperties;
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

/** Open key/value map, shape-only validation: flat, scalar values, bounded
 * counts/lengths. Never a schema — the model chooses keys and values freely. */
function validatePropertiesShape(id: string, value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `patch_properties_must_be_flat_object: ${id}`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > PROPERTIES_MAX_KEYS) return `patch_properties_too_many_keys: ${id}`;
  for (const [key, val] of entries) {
    if (!key.trim() || key.length > PROPERTY_KEY_MAX_LEN || /\n/.test(key)) {
      return `patch_property_key_not_compact: ${id} (${key})`;
    }
    if (!['string', 'number', 'boolean'].includes(typeof val)) {
      return `patch_property_value_must_be_scalar: ${id} (${key})`;
    }
    if (typeof val === 'string' && (val.length > PROPERTY_VALUE_MAX_LEN || /\n/.test(val))) {
      return `patch_property_value_not_compact: ${id} (${key})`;
    }
  }
  return null;
}

/** Structural/ownership validation only. Returns an honest error string or null. */
export function validateThinkGraphPatch(
  authority: ThinkGraphPatchAuthority,
  patch: ThinkGraphPatch,
): string | null {
  for (const k of ['projectId', 'cardId', 'correlationId', 'conversationId'] as const) {
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
    if (r.kind !== undefined) {
      const kind = s(r.kind).trim();
      if (!kind) return `patch_resource_kind_empty: ${r.id}`;
      if (kind.length > ITEM_KIND_MAX_LEN || /\n/.test(kind)) return `patch_resource_kind_not_compact: ${r.id}`;
    }
    const propsError = validatePropertiesShape(s(r.id), r.properties);
    if (propsError) return propsError;
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

    const review = s(st?.review).trim().toLowerCase();
    if (review && REVIEW_REQUIRES_REAL_EVIDENCE.includes(review)) {
      return `patch_statement_review_requires_persisted_source_provenance: ${st.id} (${review})`;
    }
    if (st.tag !== undefined) {
      const tag = s(st.tag).trim();
      if (!tag) return `patch_statement_tag_empty: ${st.id}`;
      if (tag.length > RELATION_TAG_MAX_LEN || /\n/.test(tag)) return `patch_statement_tag_not_compact: ${st.id}`;
    }
    const propsError = validatePropertiesShape(s(st.id), st.properties);
    if (propsError) return propsError;
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

    // Provenance-gated mention counting (mechanical, never model-reported): a
    // Resource/Statement's mention_count increases only the first time THIS
    // correlationId is attached to it — tracked via mentioned_correlation_ids.
    // A same-correlationId replay of the whole patch is already blocked above
    // by the ThinkDeltaApplied marker before any write runs; this list is the
    // narrower guard for a resource/statement referenced more than once
    // within one patch. Properties shallow-merge (new keys win, old keys not
    // mentioned in this patch persist) — repeated mentions accumulate detail,
    // they never wipe it.
    const readExistingMentionState = async (
      label: 'Resource' | 'Statement',
      id: string,
    ): Promise<{ mentionCount: number; mentionedIds: string[]; lastMentionedAt: string | null; properties: Record<string, unknown> }> => {
      const rows = await cypherOnClient(
        client,
        `MATCH (x:${label} {id: $id, project_id: $projectId})
         RETURN { mention_count: x.mention_count, mentioned_correlation_ids: x.mentioned_correlation_ids,
                  last_mentioned_at: x.last_mentioned_at, properties: x.properties } AS row LIMIT 1`,
        { id, projectId },
      );
      const row = parseRow(rows[0]);
      const mentionedIds = Array.isArray(row?.mentioned_correlation_ids)
        ? (row!.mentioned_correlation_ids as unknown[]).map((x) => s(x))
        : [];
      const existingProperties = properties(row?.properties) ?? {};
      return {
        mentionCount: n(row?.mention_count),
        mentionedIds,
        lastMentionedAt: s(row?.last_mentioned_at) || null,
        properties: existingProperties,
      };
    };

    const nextMentionState = (
      existing: { mentionCount: number; mentionedIds: string[]; lastMentionedAt: string | null },
    ): { mentionCount: number; mentionedIds: string[]; lastMentionedAt: string } => {
      if (existing.mentionedIds.includes(correlationId)) {
        return {
          mentionCount: existing.mentionCount,
          mentionedIds: existing.mentionedIds,
          lastMentionedAt: existing.lastMentionedAt || ts,
        };
      }
      return {
        mentionCount: existing.mentionCount + 1,
        mentionedIds: [...existing.mentionedIds, correlationId],
        lastMentionedAt: ts,
      };
    };

    const storedResourceIds: string[] = [];
    for (const r of resources) {
      const id = s(r.id).trim();
      const existing = await readExistingMentionState('Resource', id);
      const nextMention = nextMentionState(existing);
      const mergedProperties = { ...existing.properties, ...(r.properties ?? {}) };
      await cypherOnClient(
        client,
        `MERGE (n:Resource {id: $id, project_id: $projectId})
         SET n.label = $label, n.kind = $kind, n.properties = $properties,
             n.mention_count = $mentionCount, n.mentioned_correlation_ids = $mentionedIds,
             n.last_mentioned_at = $lastMentionedAt,
             n.last_turn_id = $correlationId,
             n.card_id = $cardId, n.correlation_id = $correlationId,
             n.conversation_id = $conversationId,
             n.source_user_message_id = $userMessageId,
             n.source_assistant_message_id = $assistantMessageId,
             n.created_at = coalesce(n.created_at, $ts), n.updated_at = $ts
         RETURN n.id`,
        {
          id, label: clip(r.label), kind: s(r.kind).trim(), properties: mergedProperties,
          mentionCount: nextMention.mentionCount, mentionedIds: nextMention.mentionedIds,
          lastMentionedAt: nextMention.lastMentionedAt, ...prov,
        },
      );
      storedResourceIds.push(id);
    }

    // ── Triple closure (storage invariant) ───────────────────────────────────
    // Every Statement is an entity-to-entity edge: both subject and object must
    // resolve to a real Resource (declared earlier in THIS patch or already
    // stored), or the WHOLE patch rolls back honestly — never a silently
    // dropped/partial write, and the renderer never needs to skip a stored edge.
    const declaredResourceIds = new Set(storedResourceIds);
    const resourceExists = async (id: string): Promise<boolean> => {
      if (declaredResourceIds.has(id)) return true;
      const rows = await cypherOnClient(
        client,
        `MATCH (n:Resource {id: $id, project_id: $projectId}) RETURN n.id LIMIT 1`,
        { id, projectId },
      );
      return Array.isArray(rows) && rows.length > 0;
    };

    for (const st of statements) {
      const subject = s(st.subject).trim();
      const object = s(st.object).trim();
      if (!(await resourceExists(subject))) {
        await client.query('ROLLBACK');
        return { ok: false, error: `patch_statement_subject_unresolved: ${s(st.id)} -> ${subject}` };
      }
      if (!(await resourceExists(object))) {
        await client.query('ROLLBACK');
        return { ok: false, error: `patch_statement_object_unresolved: ${s(st.id)} -> ${object}` };
      }
    }

    // ── Endpoint mention counting ────────────────────────────────────────────
    // A Resource referenced as a Statement subject/object counts as one mention
    // for THIS source turn even when the model never re-declared it in
    // resources[]. Mention-only touch: content (label/kind/properties) is left
    // exactly as stored — this pass only advances provenance/mention fields.
    // The mechanism is idempotent per correlationId (nextMentionState), so
    // running it again for a resource already touched via resources[] this
    // turn is safe — it will not double-count.
    const touchedResourceIds = new Set<string>();
    for (const st of statements) {
      touchedResourceIds.add(s(st.subject).trim());
      touchedResourceIds.add(s(st.object).trim());
    }

    for (const id of touchedResourceIds) {
      const existing = await readExistingMentionState('Resource', id);
      const nextMention = nextMentionState(existing);
      await cypherOnClient(
        client,
        `MATCH (n:Resource {id: $id, project_id: $projectId})
         SET n.mention_count = $mentionCount,
             n.mentioned_correlation_ids = $mentionedIds, n.last_mentioned_at = $lastMentionedAt,
             n.card_id = $cardId, n.correlation_id = $correlationId,
             n.conversation_id = $conversationId,
             n.source_user_message_id = $userMessageId,
             n.source_assistant_message_id = $assistantMessageId,
             n.updated_at = $ts
         RETURN n.id`,
        {
          id, mentionCount: nextMention.mentionCount,
          mentionedIds: nextMention.mentionedIds, lastMentionedAt: nextMention.lastMentionedAt, ...prov,
        },
      );
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

    // Every statement committed here is, by this point, a structurally
    // complete triple (both endpoints resolved above) — the renderer never
    // needs to skip a stored edge for a missing endpoint.
    const storedStatementIds: string[] = [];
    for (const st of statements) {
      const id = s(st.id).trim();
      const existing = await readExistingMentionState('Statement', id);
      const nextMention = nextMentionState(existing);
      const mergedProperties = { ...existing.properties, ...(st.properties ?? {}) };
      await cypherOnClient(
        client,
        `MERGE (s:Statement {id: $id, project_id: $projectId})
         SET s.subject = $subject, s.predicate_term = $predicateTerm, s.object = $object,
             s.review = $review, s.rationale = $rationale, s.tag = $tag, s.properties = $properties,
             s.mention_count = $mentionCount, s.mentioned_correlation_ids = $mentionedIds,
             s.last_mentioned_at = $lastMentionedAt,
             s.turn_id = $correlationId,
             s.card_id = $cardId, s.correlation_id = $correlationId,
             s.conversation_id = $conversationId,
             s.source_user_message_id = $userMessageId,
             s.source_assistant_message_id = $assistantMessageId,
             s.created_at = coalesce(s.created_at, $ts), s.updated_at = $ts
         RETURN s.id`,
        {
          id, subject: s(st.subject).trim(), predicateTerm: s(st.predicateTerm).trim(),
          object: s(st.object).trim(), review: s(st.review).trim() || 'provisional',
          rationale: clip(st.rationale), tag: s(st.tag).trim(), properties: mergedProperties,
          mentionCount: nextMention.mentionCount, mentionedIds: nextMention.mentionedIds,
          lastMentionedAt: nextMention.lastMentionedAt, ...prov,
        },
      );
      storedStatementIds.push(id);
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
