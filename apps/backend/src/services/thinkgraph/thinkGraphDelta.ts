// @graph entity: ThinkGraphDelta
// @graph role: canonical-thinkgraph-writer-and-reader
// @graph relates_to: LiquidAItyMcpServer (thinkgraph.apply_delta), ThinkGraph canvas
// @graph depends_on: Apache AGE, Postgres
//
// THE ONE canonical, entity-first ThinkGraph store contract: real :ThinkNode vertices +
// :THINK_EDGE relationships in the AGE graph `thinkgraph_liq` (NOT the legacy SlmGraphRecord
// JSON-blob envelope). Harness writes through `applyThinkGraphDelta`; the canvas/MCP reads
// through the slice/class/search readers here. Integrity-only validation: it NEVER invents
// semantic content, never routes by regex, never falls back to a different writer.

import { runCypherOnGraph, ensureVertexLabel } from '../graphService';

const THINKGRAPH_GRAPH_NAME = 'thinkgraph_liq';

export const THINK_NODE_CLASSES = [
  'Question', 'Hypothesis', 'Entity', 'UnresolvedEntity', 'QuerySeed',
  'Constraint', 'Decision', 'ResearchAction', 'RejectedPath', 'KnowGraphReference',
] as const;
export type ThinkNodeClass = (typeof THINK_NODE_CLASSES)[number];

export const THINK_PREDICATES = [
  'suggests', 'requires_verification', 'depends_on', 'contradicts', 'supports',
  'refines', 'replaces', 'answers', 'blocks', 'leads_to', 'rejected_because',
  'investigates', 'references',
] as const;
export type ThinkPredicate = (typeof THINK_PREDICATES)[number];

export type ThinkChangeKind =
  | 'added' | 'refined' | 'contradicted' | 'superseded' | 'rejected' | 'unresolved' | 'skipped';

export type ThinkDeltaNode = {
  id: string;                 // stable think:* id (existing ref or new local identity)
  label: string;
  class: ThinkNodeClass;
  note?: string;              // concise editable working rationale — NOT raw chain-of-thought
  status?: string;
  confidence?: number | null; // resolution/confidence state
  change?: ThinkChangeKind;
  knowGraphRef?: string | null; // optional know:* pointer for KnowGraphReference nodes
};

export type ThinkDeltaEdge = {
  source: string;
  target: string;
  predicate: ThinkPredicate;
  rationale?: string;
  status?: string;
  change?: ThinkChangeKind;
};

export type ThinkDeltaProvenance = {
  projectId: string;
  conversationId: string;
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  origin: 'harness_chat';
};

export type ThinkDelta = {
  provenance: ThinkDeltaProvenance;
  deltaId?: string;            // optional explicit delta id; defaults to turnId
  nodes?: ThinkDeltaNode[];
  edges?: ThinkDeltaEdge[];
};

export type ThinkDeltaResult =
  | { ok: true; status: 'applied' | 'duplicate' | 'empty'; nodes: number; edges: number; deltaId: string }
  | { ok: false; error: string };

function s(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Integrity-only validation. Returns an error string, or null when valid. NO semantic judgement. */
export function validateThinkDelta(delta: ThinkDelta): string | null {
  const p = delta?.provenance;
  if (!p) return 'provenance_required';
  for (const k of ['projectId', 'conversationId', 'turnId', 'userMessageId', 'assistantMessageId'] as const) {
    if (!s(p[k]).trim()) return `provenance_${k}_required`;
  }
  if (p.origin !== 'harness_chat') return 'provenance_origin_must_be_harness_chat';
  const nodeIds = new Set<string>();
  for (const n of delta.nodes ?? []) {
    if (!s(n.id).trim()) return 'node_id_required';
    if (!s(n.label).trim()) return `node_label_required:${n.id}`;
    if (!THINK_NODE_CLASSES.includes(n.class)) return `node_class_invalid:${n.id}:${n.class}`;
    nodeIds.add(s(n.id));
  }
  for (const e of delta.edges ?? []) {
    const from = s(e.source).trim();
    const to = s(e.target).trim();
    if (!from || !to) return 'edge_endpoint_required';
    if (!THINK_PREDICATES.includes(e.predicate)) return `edge_predicate_invalid:${e.predicate}`;
    // Self-loop is rejected — no predicate in this vocabulary permits self-reference.
    if (from === to) return `self_loop_rejected:${from}:${e.predicate}`;
  }
  return null;
}

async function turnAlreadyApplied(projectId: string, deltaId: string): Promise<boolean> {
  // Explicitly initialize the marker label through the AGE init path so a genuine
  // first-use does NOT throw "label does not exist". Any error past this point is a
  // real DB failure and is allowed to propagate — never swallowed into a fake answer.
  await ensureVertexLabel(THINKGRAPH_GRAPH_NAME, 'ThinkDeltaApplied');
  const rows = await runCypherOnGraph(
    THINKGRAPH_GRAPH_NAME,
    `MATCH (m:ThinkDeltaApplied {project_id: $projectId, delta_id: $deltaId}) RETURN m.delta_id LIMIT 1`,
    { projectId, deltaId },
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Apply one Harness MindDelta to the canonical ThinkGraph store. Idempotent per delta/turn:
 * a second application of the same deltaId is a no-op `duplicate`. NO cross-graph write
 * (only `thinkgraph_liq`). Fails closed on a real write error — never a fake success.
 */
export async function applyThinkGraphDelta(delta: ThinkDelta): Promise<ThinkDeltaResult> {
  const err = validateThinkDelta(delta);
  if (err) return { ok: false, error: err };

  const projectId = s(delta.provenance.projectId).trim();
  const deltaId = s(delta.deltaId).trim() || s(delta.provenance.turnId).trim();
  const nodes = delta.nodes ?? [];
  const edges = delta.edges ?? [];
  if (nodes.length === 0 && edges.length === 0) {
    return { ok: true, status: 'empty', nodes: 0, edges: 0, deltaId };
  }

  const prov = delta.provenance;
  const ts = nowIso();
  let nodesWritten = 0;
  let edgesWritten = 0;

  try {
    if (await turnAlreadyApplied(projectId, deltaId)) {
      return { ok: true, status: 'duplicate', nodes: 0, edges: 0, deltaId };
    }

    // ponytail: writes are not one atomic AGE transaction; a mid-write failure returns a
    // real error below (no fake success) and the un-marked delta is safely re-appliable
    // (MERGE-by-id is idempotent). Add a shared-client transaction only if partial writes bite.
  for (const n of nodes) {
    await runCypherOnGraph(
      THINKGRAPH_GRAPH_NAME,
      `MERGE (n:ThinkNode {id: $id, project_id: $projectId})
       SET n.label = $label, n.class = $class, n.note = $note, n.status = $status,
           n.confidence = $confidence, n.change = $change, n.know_graph_ref = $knowGraphRef,
           n.conversation_id = $conversationId, n.turn_id = $turnId,
           n.user_message_id = $userMessageId, n.assistant_message_id = $assistantMessageId,
           n.origin = $origin, n.updated_at = $ts
       RETURN n.id`,
      {
        id: s(n.id), projectId, label: s(n.label), class: s(n.class), note: s(n.note),
        status: s(n.status) || 'open', confidence: typeof n.confidence === 'number' ? n.confidence : null,
        change: s(n.change) || 'added', knowGraphRef: n.knowGraphRef ?? null,
        conversationId: s(prov.conversationId), turnId: s(prov.turnId),
        userMessageId: s(prov.userMessageId), assistantMessageId: s(prov.assistantMessageId),
        origin: prov.origin, ts,
      },
    );
    nodesWritten += 1;
  }

  for (const e of edges) {
    await runCypherOnGraph(
      THINKGRAPH_GRAPH_NAME,
      `MATCH (a:ThinkNode {id: $source, project_id: $projectId})
       MATCH (b:ThinkNode {id: $target, project_id: $projectId})
       MERGE (a)-[r:THINK_EDGE {predicate: $predicate, project_id: $projectId}]->(b)
       SET r.rationale = $rationale, r.status = $status, r.change = $change,
           r.turn_id = $turnId, r.user_message_id = $userMessageId,
           r.assistant_message_id = $assistantMessageId, r.origin = $origin, r.updated_at = $ts
       RETURN r.predicate`,
      {
        source: s(e.source), target: s(e.target), predicate: s(e.predicate), projectId,
        rationale: s(e.rationale), status: s(e.status) || 'open', change: s(e.change) || 'added',
        turnId: s(prov.turnId), userMessageId: s(prov.userMessageId),
        assistantMessageId: s(prov.assistantMessageId), origin: prov.origin, ts,
      },
    );
    edgesWritten += 1;
  }

    // Idempotency marker — recorded only after the real writes succeed.
    await runCypherOnGraph(
      THINKGRAPH_GRAPH_NAME,
      `CREATE (m:ThinkDeltaApplied {project_id: $projectId, delta_id: $deltaId, turn_id: $turnId, ts: $ts}) RETURN m.delta_id`,
      { projectId, deltaId, turnId: s(prov.turnId), ts },
    );

    return { ok: true, status: 'applied', nodes: nodesWritten, edges: edgesWritten, deltaId };
  } catch (e: any) {
    // Real AGE/query failure (setup already ensured): honest error, never a fake success
    // and never silently treated as "not previously applied".
    return { ok: false, error: `thinkgraph_write_failed: ${e?.message || 'age_error'}` };
  }
}

// ── Readers over the canonical :ThinkNode / :THINK_EDGE model ────────────────────────────
export type ThinkViewNode = {
  id: string; label: string; class: string; note: string; status: string;
  confidence: number | null; knowGraphRef: string | null; turnId: string;
};
export type ThinkViewEdge = {
  id: string; source: string; target: string; predicate: string; rationale: string; status: string;
};
export type ThinkGraphSlice = { nodes: ThinkViewNode[]; edges: ThinkViewEdge[] };

function parseRow(raw: unknown): Record<string, any> | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

function toViewNode(r: Record<string, any>): ThinkViewNode {
  const c = Number(r.confidence);
  return {
    id: s(r.id), label: s(r.label), class: s(r.class) || 'Entity', note: s(r.note),
    status: s(r.status) || 'open', confidence: Number.isFinite(c) ? c : null,
    knowGraphRef: r.know_graph_ref != null ? s(r.know_graph_ref) : null, turnId: s(r.turn_id),
  };
}

/** Read a bounded slice. With no refs, the whole project ThinkNode set + its edges (capped). */
export async function getThinkGraphSlice(args: {
  projectId: string; refs?: string[]; edgeTypes?: string[]; limit?: number;
}): Promise<ThinkGraphSlice> {
  const projectId = s(args.projectId).trim();
  if (!projectId) return { nodes: [], edges: [] };
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 300) || 300, 1), 1000);
  const refs = (args.refs ?? []).map((r) => s(r)).filter(Boolean);
  const nodeRows = refs.length
    ? await runCypherOnGraph(
        THINKGRAPH_GRAPH_NAME,
        `MATCH (n:ThinkNode {project_id: $projectId}) WHERE n.id IN $refs
         RETURN { id: n.id, label: n.label, class: n.class, note: n.note, status: n.status,
                  confidence: n.confidence, know_graph_ref: n.know_graph_ref, turn_id: n.turn_id } AS row LIMIT ${limit}`,
        { projectId, refs },
      )
    : await runCypherOnGraph(
        THINKGRAPH_GRAPH_NAME,
        `MATCH (n:ThinkNode {project_id: $projectId})
         RETURN { id: n.id, label: n.label, class: n.class, note: n.note, status: n.status,
                  confidence: n.confidence, know_graph_ref: n.know_graph_ref, turn_id: n.turn_id } AS row LIMIT ${limit}`,
        { projectId },
      );
  const nodes = nodeRows.map(parseRow).filter((r): r is Record<string, any> => Boolean(r?.id)).map(toViewNode);
  const ids = new Set(nodes.map((n) => n.id));
  const edgeRows = await runCypherOnGraph(
    THINKGRAPH_GRAPH_NAME,
    `MATCH (a:ThinkNode {project_id: $projectId})-[r:THINK_EDGE]->(b:ThinkNode {project_id: $projectId})
     RETURN { from: a.id, to: b.id, predicate: r.predicate, rationale: r.rationale, status: r.status } AS row LIMIT 4000`,
    { projectId },
  );
  const edges: ThinkViewEdge[] = edgeRows
    .map(parseRow)
    .filter((r): r is Record<string, any> => Boolean(r?.from && r?.to))
    .filter((r) => ids.has(s(r.from)) && ids.has(s(r.to)))
    .map((r, i) => ({
      id: `${s(r.from)}|${s(r.predicate)}|${s(r.to)}|${i}`, source: s(r.from), target: s(r.to),
      predicate: s(r.predicate) || 'relates_to', rationale: s(r.rationale), status: s(r.status) || 'open',
    }));
  return { nodes, edges };
}

/** Read all nodes of given classes (used by get_open_questions / get_query_seeds / etc.). */
export async function getThinkNodesByClass(projectId: string, classes: ThinkNodeClass[]): Promise<ThinkViewNode[]> {
  const pid = s(projectId).trim();
  if (!pid || classes.length === 0) return [];
  const rows = await runCypherOnGraph(
    THINKGRAPH_GRAPH_NAME,
    `MATCH (n:ThinkNode {project_id: $projectId}) WHERE n.class IN $classes
     RETURN { id: n.id, label: n.label, class: n.class, note: n.note, status: n.status,
              confidence: n.confidence, know_graph_ref: n.know_graph_ref, turn_id: n.turn_id } AS row LIMIT 500`,
    { projectId: pid, classes },
  );
  return rows.map(parseRow).filter((r): r is Record<string, any> => Boolean(r?.id)).map(toViewNode);
}

/** Free-text search over node label/note (substring, project-scoped). */
export async function searchThinkGraph(projectId: string, query: string): Promise<ThinkViewNode[]> {
  const pid = s(projectId).trim();
  const q = s(query).trim().toLowerCase();
  if (!pid || !q) return [];
  const rows = await runCypherOnGraph(
    THINKGRAPH_GRAPH_NAME,
    `MATCH (n:ThinkNode {project_id: $projectId})
     WHERE toLower(coalesce(n.label,'')) CONTAINS $q OR toLower(coalesce(n.note,'')) CONTAINS $q
     RETURN { id: n.id, label: n.label, class: n.class, note: n.note, status: n.status,
              confidence: n.confidence, know_graph_ref: n.know_graph_ref, turn_id: n.turn_id } AS row LIMIT 200`,
    { projectId: pid, q },
  );
  return rows.map(parseRow).filter((r): r is Record<string, any> => Boolean(r?.id)).map(toViewNode);
}
