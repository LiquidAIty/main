// @graph entity: ThinkGraphMemory
// @graph role: real-planning-and-run-event-memory
// @graph relates_to: ThinkGraph, DeckRuntime, GraphContextPromptWriter
// @graph depends_on: Apache AGE, Postgres
// @graph feeds_to: ThinkGraphContextPacket
//
// Minimal ThinkGraph memory for real planning and run events.
// Stores real events and their PlanFlow links in the existing AGE graph and
// reads them back as a versioned context packet. It never invents planner state.
import { runCypherOnGraph } from '../graphService';

// Own AGE graph: keeps planning memory separate from KG entity extraction and
// avoids the pre-existing graph_liq catalog corruption (ag_graph.graphid does
// not match the namespace oid there, so MATCH fails with "graph with oid ...
// does not exist").
const THINKGRAPH_GRAPH_NAME = 'thinkgraph_liq';
const MAX_TEXT = 2000;
const EVENT_TYPES = new Set<ThinkGraphEventType>([
  'planflow_loaded_from_markdown',
  'run_requested',
  'run_started',
  'run_completed',
  'run_failed',
  'proof_recorded',
  'blocker_found',
  'coder_packet_created',
  'coder_report_recorded',
]);
const EVENT_STATUSES = new Set<ThinkGraphEvent['status']>([
  'pending',
  'running',
  'complete',
  'failed',
  'blocked',
  'success',
  'error',
  'skipped',
]);

export type ThinkGraphEventType =
  | 'planflow_loaded_from_markdown'
  | 'run_requested'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'proof_recorded'
  | 'blocker_found'
  | 'coder_packet_created'
  | 'coder_report_recorded';

export type ThinkGraphEvent = {
  projectId: string;
  eventType: ThinkGraphEventType;
  title: string;
  summary: string;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'blocked' | 'success' | 'error' | 'skipped';
  planFlowNodeIds?: string[];
  deckId?: string;
  deckTitle?: string;
  task?: string;
  cards?: string[];
  tools?: string[];
  runtimeRoute?: string;
  finalOutput?: string | null;
  error?: string | null;
  assumptions?: string[];
  nextTask?: string;
  coderPacketId?: string;
  coderPacketObjective?: string;
  coderReportStatus?: string;
  completedRequirements?: string[];
  incompleteRequirements?: string[];
  blockedRequirements?: string[];
  changedRequirements?: string[];
  outOfScopeFindings?: string[];
  proofSummary?: string[];
  contextEvidenceSummary?: string[];
  cbmStatus?: string;
  codeAnchors?: string[];
  cbmBlocker?: string;
  sourceDiagnosticsSummary?: string[];
  plannerProvider?: string;
  plannerModel?: string;
  plannerConfigSource?: string;
  taskLedger?: any;
  progressLedger?: any;
};

export type ThinkGraphRunEvent = {
  projectId: string;
  deckId: string;
  eventType: Extract<ThinkGraphEventType, 'run_requested' | 'run_started' | 'run_completed' | 'run_failed'>;
  deckTitle: string;
  task: string;
  cards: string[];
  tools: string[];
  runtimeRoute: string;
  status: 'success' | 'error' | 'running' | 'skipped';
  finalOutput: string | null;
  error: string | null;
  assumptions: string[];
  nextTask: string;
  planFlowNodeIds?: string[];
};

export type ThinkGraphContextPacket = {
  packet_version: 1;
  source: 'thinkgraph';
  project_id: string;
  planflow_nodes: string[];
  recent_events: ThinkGraphContextEvent[];
  active_decisions: string[];
  assumptions: string[];
  open_questions: string[];
  last_runs: ThinkGraphContextEvent[];
  next_task: string;
  warnings: string[];
};

export type ThinkGraphContextEvent = {
  id: string;
  ts: string;
  event_type: string;
  title: string;
  summary: string;
  status: string;
  planflow_node_ids: string[];
  deck_id: string;
  deck_title: string;
  task: string;
  cards: string[];
  tools: string[];
  runtime_route: string;
  final_output: string;
  error: string;
  next_task: string;
  coder_packet_id: string;
  coder_packet_objective: string;
  coder_report_status: string;
  completed_requirements: string[];
  incomplete_requirements: string[];
  blocked_requirements: string[];
  changed_requirements: string[];
  out_of_scope_findings: string[];
  proof_summary: string[];
  context_evidence_summary: string[];
  cbm_status: string;
  code_anchors: string[];
  cbm_blocker: string;
  source_diagnostics_summary: string[];
  planner_provider: string;
  planner_model: string;
  planner_config_source: string;
};

function clampText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…(truncated)` : text;
}

function cleanList(values: unknown): string[] {
  return (Array.isArray(values) ? values : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, 50);
}

export async function recordThinkGraphEvent(record: ThinkGraphEvent): Promise<{ id: string; ts: string }> {
  const projectId = String(record.projectId || '').trim();
  if (!projectId) {
    throw new Error('thinkgraph_project_id_required');
  }
  if (!EVENT_TYPES.has(record.eventType)) {
    throw new Error('thinkgraph_event_type_required');
  }
  if (!EVENT_STATUSES.has(record.status)) {
    throw new Error('thinkgraph_event_status_required');
  }
  const ts = new Date().toISOString();
  const id = `tgevent:${projectId}:${record.eventType}:${Date.now().toString(36)}`;
  // ThinkGraph no longer MIRRORS runtime/event/PlanFlow telemetry into the AGE graph `thinkgraph_liq`.
  // The deck-run lifecycle and PLAN.md/spec ingestion still run normally and keep their own runtime/log
  // behavior; they simply stop writing :ThinkGraphEvent / :PlanFlowNodeRef / :LINKS_PLANFLOW_NODE into
  // ThinkGraph (rejected as ThinkGraph data — it is runtime/spec-ingestion telemetry, not project state).
  // Signature + id/ts are preserved so every caller (deck execution, PlanFlow loading, …) is unchanged.
  // No AGE write happens here.
  return { id, ts };
}

export async function recordThinkGraphRunEvent(record: ThinkGraphRunEvent): Promise<{ id: string; ts: string }> {
  const deckId = String(record.deckId || '').trim();
  if (!deckId) {
    throw new Error('thinkgraph_deck_id_required');
  }
  return recordThinkGraphEvent({
    ...record,
    title: `${record.eventType.replace(/_/g, ' ')}: ${record.deckTitle || deckId}`,
    summary: record.finalOutput || record.error || record.task,
  });
}

export type ThinkGraphSemanticRecord = {
  projectId: string;
  /** Unique lookup key (stored as a queryable `source_ref` property for read-back). */
  sourceRef: string;
  createdBy: string;
  entities: { id: string; label: string; type: string }[];
  relations: { from: string; to: string; type: string }[];
  categories: string[];
  sourceRefs: { ref: string; type?: string }[];
  confidence: number | null;
  uncertainty: string[];
  /** Forward search seeds carried from the extraction (optional, preserved on read-back). */
  nextSearchSeedCandidates?: string[];
};

/**
 * Write a semantic graph record (e.g. an SLM graph extraction) into the ThinkGraph AGE graph
 * as a real `:SlmGraphRecord` node — same mechanism as event memory. Entity/relation/
 * sourceRef payloads are stored as JSON text (the established ThinkGraph pattern).
 * Throws on a failed write so callers can fail closed rather than report fake success.
 */
export async function recordThinkGraphSemanticRecord(
  record: ThinkGraphSemanticRecord,
): Promise<{ id: string; ts: string }> {
  const projectId = String(record.projectId || '').trim();
  if (!projectId) {
    throw new Error('thinkgraph_project_id_required');
  }
  const ts = new Date().toISOString();
  const id = `tgsem:${projectId}:${Date.now().toString(36)}`;
  const cypher = `
    CREATE (r:SlmGraphRecord {
      id: $id,
      project_id: $projectId,
      source_ref: $sourceRef,
      ts: $ts,
      target_graph: 'thinkgraph',
      created_by: $createdBy,
      entities_json: $entitiesJson,
      relations_json: $relationsJson,
      categories: $categories,
      source_refs_json: $sourceRefsJson,
      confidence: $confidence,
      uncertainty: $uncertainty,
      next_search_seed_candidates: $nextSearchSeedCandidates
    })
    RETURN r.id
  `;
  await runCypherOnGraph(THINKGRAPH_GRAPH_NAME, cypher, {
    id,
    projectId,
    sourceRef: clampText(record.sourceRef),
    ts,
    createdBy: clampText(record.createdBy) || 'slmGraphWorker',
    entitiesJson: JSON.stringify(Array.isArray(record.entities) ? record.entities : []),
    relationsJson: JSON.stringify(Array.isArray(record.relations) ? record.relations : []),
    categories: cleanList(record.categories),
    sourceRefsJson: JSON.stringify(Array.isArray(record.sourceRefs) ? record.sourceRefs : []),
    confidence: typeof record.confidence === 'number' ? record.confidence : null,
    uncertainty: cleanList(record.uncertainty),
    nextSearchSeedCandidates: cleanList(record.nextSearchSeedCandidates),
  });
  return { id, ts };
}

export type StoredThinkGraphSemanticRecord = {
  id: string;
  projectId: string;
  sourceRef: string;
  createdBy: string;
  entities: { id: string; label: string; type: string }[];
  relations: { from: string; to: string; type: string }[];
  categories: string[];
  sourceRefs: { ref: string; type?: string }[];
  confidence: number | null;
  uncertainty: string[];
  nextSearchSeedCandidates: string[];
  createdAt: string;
};

export type ThinkGraphSemanticReadResult =
  | { ok: true; record: StoredThinkGraphSemanticRecord }
  | { ok: false; reason: 'not_found' | 'age_query_failed'; error?: string };

function safeJsonArray(value: unknown): any[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Read back one `:SlmGraphRecord` from the SAME ThinkGraph AGE graph the write path
 * uses (`thinkgraph_liq`), keyed by `project_id` + unique `source_ref`. Honest results:
 * found → ok:true; no row → ok:false/not_found; AGE query throws → ok:false/age_query_failed.
 */
export async function readThinkGraphSemanticRecord(query: {
  projectId: string;
  sourceRef: string;
}): Promise<ThinkGraphSemanticReadResult> {
  const projectId = String(query.projectId || '').trim();
  const sourceRef = String(query.sourceRef || '').trim();
  if (!projectId || !sourceRef) {
    return { ok: false, reason: 'not_found' };
  }
  const cypher = `
    MATCH (r:SlmGraphRecord {project_id: $projectId, source_ref: $sourceRef})
    RETURN {
      id: r.id, project_id: r.project_id, source_ref: r.source_ref,
      created_by: r.created_by, target_graph: r.target_graph,
      entities_json: r.entities_json, relations_json: r.relations_json,
      categories: r.categories, source_refs_json: r.source_refs_json,
      confidence: r.confidence, uncertainty: r.uncertainty,
      next_search_seed_candidates: r.next_search_seed_candidates, ts: r.ts
    }
    ORDER BY r.ts DESC
    LIMIT 1
  `;
  let rows: unknown[];
  try {
    rows = await runCypherOnGraph(THINKGRAPH_GRAPH_NAME, cypher, { projectId, sourceRef });
  } catch (err: any) {
    return { ok: false, reason: 'age_query_failed', error: err?.message || String(err) };
  }
  const row = parseEventRow(rows[0]);
  if (!row) {
    return { ok: false, reason: 'not_found' };
  }
  const confidenceNum = Number(row.confidence);
  return {
    ok: true,
    record: {
      id: String(row.id ?? ''),
      projectId: String(row.project_id ?? ''),
      sourceRef: String(row.source_ref ?? ''),
      createdBy: String(row.created_by ?? ''),
      entities: safeJsonArray(row.entities_json),
      relations: safeJsonArray(row.relations_json),
      categories: cleanList(row.categories),
      sourceRefs: safeJsonArray(row.source_refs_json),
      confidence: Number.isFinite(confidenceNum) ? confidenceNum : null,
      uncertainty: cleanList(row.uncertainty),
      nextSearchSeedCandidates: cleanList(row.next_search_seed_candidates),
      createdAt: String(row.ts ?? ''),
    },
  };
}

export type ThinkGraphSemanticListResult =
  | { ok: true; records: StoredThinkGraphSemanticRecord[] }
  | { ok: false; reason: 'age_query_failed'; error: string };

/**
 * Read back the most recent `:SlmGraphRecord` semantic records for a project from the same
 * ThinkGraph AGE graph the write path uses (`thinkgraph_liq`). Read-only — surfaces accepted
 * Mag One graphPayload records (entities/relations/sourceRefs/uncertainty/seeds) so a
 * read-only preflight can ground task creation. Honest: AGE query throws → ok:false.
 */
export async function readRecentThinkGraphSemanticRecords(query: {
  projectId: string;
  limit?: number;
}): Promise<ThinkGraphSemanticListResult> {
  const projectId = String(query.projectId || '').trim();
  if (!projectId) {
    return { ok: true, records: [] };
  }
  const safeLimit = Math.min(Math.max(Math.trunc(query.limit ?? 10) || 10, 1), 50);
  const cypher = `
    MATCH (r:SlmGraphRecord {project_id: $projectId})
    RETURN {
      id: r.id, project_id: r.project_id, source_ref: r.source_ref,
      created_by: r.created_by, target_graph: r.target_graph,
      entities_json: r.entities_json, relations_json: r.relations_json,
      categories: r.categories, source_refs_json: r.source_refs_json,
      confidence: r.confidence, uncertainty: r.uncertainty,
      next_search_seed_candidates: r.next_search_seed_candidates, ts: r.ts
    }
    ORDER BY r.ts DESC
    LIMIT ${safeLimit}
  `;
  let rows: unknown[];
  try {
    rows = await runCypherOnGraph(THINKGRAPH_GRAPH_NAME, cypher, { projectId });
  } catch (err: any) {
    return { ok: false, reason: 'age_query_failed', error: err?.message || String(err) };
  }
  const records: StoredThinkGraphSemanticRecord[] = rows
    .map(parseEventRow)
    .filter((row): row is Record<string, any> => Boolean(row))
    .map((row) => {
      const confidenceNum = Number(row.confidence);
      return {
        id: String(row.id ?? ''),
        projectId: String(row.project_id ?? ''),
        sourceRef: String(row.source_ref ?? ''),
        createdBy: String(row.created_by ?? ''),
        entities: safeJsonArray(row.entities_json),
        relations: safeJsonArray(row.relations_json),
        categories: cleanList(row.categories),
        sourceRefs: safeJsonArray(row.source_refs_json),
        confidence: Number.isFinite(confidenceNum) ? confidenceNum : null,
        uncertainty: cleanList(row.uncertainty),
        nextSearchSeedCandidates: cleanList(row.next_search_seed_candidates),
        createdAt: String(row.ts ?? ''),
      };
    });
  return { ok: true, records };
}

function parseEventRow(raw: unknown): Record<string, any> | null {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
}

export async function readThinkGraphContextPacket(
  projectId: string,
  limit = 10,
): Promise<ThinkGraphContextPacket> {
  const cleanProjectId = String(projectId || '').trim();
  if (!cleanProjectId) {
    throw new Error('thinkgraph_project_id_required');
  }
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);

  // AGE map projection serializes as a JSON object per row.
  const cypher = `
    MATCH (r:ThinkGraphEvent {project_id: $projectId})
    RETURN {
      id: r.id, ts: r.ts, event_type: r.event_type,
      title: r.title, summary: r.summary,
      planflow_node_ids: r.planflow_node_ids,
      deck_id: r.deck_id, deck_title: r.deck_title,
      task: r.task, cards: r.cards, tools: r.tools,
      runtime_route: r.runtime_route, status: r.status,
      final_output: r.final_output, error: r.error,
      assumptions: r.assumptions, next_task: r.next_task,
      coder_packet_id: r.coder_packet_id,
      coder_packet_objective: r.coder_packet_objective,
      coder_report_status: r.coder_report_status,
      completed_requirements: r.completed_requirements,
      incomplete_requirements: r.incomplete_requirements,
      blocked_requirements: r.blocked_requirements,
      changed_requirements: r.changed_requirements,
      out_of_scope_findings: r.out_of_scope_findings,
      proof_summary: r.proof_summary,
      context_evidence_summary: r.context_evidence_summary,
      cbm_status: r.cbm_status,
      code_anchors: r.code_anchors,
      cbm_blocker: r.cbm_blocker,
      source_diagnostics_summary: r.source_diagnostics_summary,
      planner_provider: r.planner_provider,
      planner_model: r.planner_model,
      planner_config_source: r.planner_config_source
    }
    ORDER BY r.ts DESC
    LIMIT ${safeLimit}
  `;
  const rows = await runCypherOnGraph(THINKGRAPH_GRAPH_NAME, cypher, {
    projectId: cleanProjectId,
  });

  const recentEvents = rows
    .map(parseEventRow)
    .filter((row): row is Record<string, any> => Boolean(row))
    .map((row) => ({
      id: String(row.id ?? ''),
      ts: String(row.ts ?? ''),
      event_type: String(row.event_type ?? ''),
      title: String(row.title ?? ''),
      summary: String(row.summary ?? ''),
      planflow_node_ids: cleanList(row.planflow_node_ids),
      deck_id: String(row.deck_id ?? ''),
      deck_title: String(row.deck_title ?? ''),
      task: String(row.task ?? ''),
      cards: cleanList(row.cards),
      tools: cleanList(row.tools),
      runtime_route: String(row.runtime_route ?? ''),
      status: String(row.status ?? ''),
      final_output: String(row.final_output ?? ''),
      error: String(row.error ?? ''),
      next_task: String(row.next_task ?? ''),
      coder_packet_id: String(row.coder_packet_id ?? ''),
      coder_packet_objective: String(row.coder_packet_objective ?? ''),
      coder_report_status: String(row.coder_report_status ?? ''),
      completed_requirements: cleanList(row.completed_requirements),
      incomplete_requirements: cleanList(row.incomplete_requirements),
      blocked_requirements: cleanList(row.blocked_requirements),
      changed_requirements: cleanList(row.changed_requirements),
      out_of_scope_findings: cleanList(row.out_of_scope_findings),
      proof_summary: cleanList(row.proof_summary),
      context_evidence_summary: cleanList(row.context_evidence_summary),
      cbm_status: String(row.cbm_status ?? ''),
      code_anchors: cleanList(row.code_anchors),
      cbm_blocker: String(row.cbm_blocker ?? ''),
      source_diagnostics_summary: cleanList(row.source_diagnostics_summary),
      planner_provider: String(row.planner_provider ?? ''),
      planner_model: String(row.planner_model ?? ''),
      planner_config_source: String(row.planner_config_source ?? ''),
    }));

  const latest = recentEvents[0] || null;
  const lastRuns = recentEvents.filter((event) => event.event_type.startsWith('run_'));
  const planFlowNodes = Array.from(
    new Set(recentEvents.flatMap((event) => event.planflow_node_ids)),
  );
  const warnings: string[] = [
    'thinkgraph_minimal: real events and PlanFlow links only; decisions and assumptions require explicit recorded events',
  ];
  if (recentEvents.length === 0) {
    warnings.push('thinkgraph_empty: no real events recorded for this project yet');
  }

  return {
    packet_version: 1,
    source: 'thinkgraph',
    project_id: cleanProjectId,
    planflow_nodes: planFlowNodes,
    recent_events: recentEvents,
    active_decisions: [],
    assumptions: latest
      ? cleanList((rows.map(parseEventRow)[0] as any)?.assumptions)
      : [],
    open_questions: [],
    last_runs: lastRuns,
    next_task: latest?.next_task || '',
    warnings,
  };
}
