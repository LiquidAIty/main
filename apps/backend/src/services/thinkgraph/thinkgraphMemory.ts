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
  const planFlowNodeIds = cleanList(record.planFlowNodeIds);

  const cypher = `
    CREATE (r:ThinkGraphEvent {
      id: $id,
      project_id: $projectId,
      ts: $ts,
      event_type: $eventType,
      title: $title,
      summary: $summary,
      planflow_node_ids: $planFlowNodeIds,
      deck_id: $deckId,
      deck_title: $deckTitle,
      task: $task,
      cards: $cards,
      tools: $tools,
      runtime_route: $runtimeRoute,
      status: $status,
      final_output: $finalOutput,
      error: $error,
      assumptions: $assumptions,
      next_task: $nextTask,
      coder_packet_id: $coderPacketId,
      coder_packet_objective: $coderPacketObjective,
      coder_report_status: $coderReportStatus,
      completed_requirements: $completedRequirements,
      incomplete_requirements: $incompleteRequirements,
      blocked_requirements: $blockedRequirements,
      changed_requirements: $changedRequirements,
      out_of_scope_findings: $outOfScopeFindings,
      proof_summary: $proofSummary,
      context_evidence_summary: $contextEvidenceSummary,
      cbm_status: $cbmStatus,
      code_anchors: $codeAnchors,
      cbm_blocker: $cbmBlocker,
      source_diagnostics_summary: $sourceDiagnosticsSummary,
      planner_provider: $plannerProvider,
      planner_model: $plannerModel,
      planner_config_source: $plannerConfigSource
    })
    RETURN r.id
  `;
  await runCypherOnGraph(THINKGRAPH_GRAPH_NAME, cypher, {
    id,
    projectId,
    ts,
    eventType: record.eventType,
    title: clampText(record.title),
    summary: clampText(record.summary),
    planFlowNodeIds,
    deckId: clampText(record.deckId),
    deckTitle: clampText(record.deckTitle) || clampText(record.deckId),
    task: clampText(record.task),
    cards: cleanList(record.cards),
    tools: cleanList(record.tools),
    runtimeRoute: clampText(record.runtimeRoute),
    status: record.status,
    finalOutput: clampText(record.finalOutput),
    error: clampText(record.error),
    assumptions: cleanList(record.assumptions),
    nextTask: clampText(record.nextTask),
    coderPacketId: clampText(record.coderPacketId),
    coderPacketObjective: clampText(record.coderPacketObjective),
    coderReportStatus: clampText(record.coderReportStatus),
    completedRequirements: cleanList(record.completedRequirements),
    incompleteRequirements: cleanList(record.incompleteRequirements),
    blockedRequirements: cleanList(record.blockedRequirements),
    changedRequirements: cleanList(record.changedRequirements),
    outOfScopeFindings: cleanList(record.outOfScopeFindings),
    proofSummary: cleanList(record.proofSummary),
    contextEvidenceSummary: cleanList(record.contextEvidenceSummary),
    cbmStatus: clampText(record.cbmStatus),
    codeAnchors: cleanList(record.codeAnchors),
    cbmBlocker: clampText(record.cbmBlocker),
    sourceDiagnosticsSummary: cleanList(record.sourceDiagnosticsSummary),
    plannerProvider: clampText(record.plannerProvider),
    plannerModel: clampText(record.plannerModel),
    plannerConfigSource: clampText(record.plannerConfigSource),
  });
  if (planFlowNodeIds.length > 0) {
    await runCypherOnGraph(
      THINKGRAPH_GRAPH_NAME,
      `
        UNWIND $planFlowNodeIds AS nodeId
        MATCH (e:ThinkGraphEvent {id: $id})
        MERGE (p:PlanFlowNodeRef {id: nodeId, project_id: $projectId})
        MERGE (e)-[:LINKS_PLANFLOW_NODE]->(p)
        RETURN count(p)
      `,
      { id, projectId, planFlowNodeIds },
    );
  }
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
