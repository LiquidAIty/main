// @graph entity: ThinkGraphProjectTruth
// @graph role: curated-project-truth-records
// @graph relates_to: ThinkGraphMemory, ContextPackBuilder
// @graph depends_on: Apache AGE, Postgres
//
// Smallest real ThinkGraph project-truth slice (Batch A). Stores CURATED,
// reference-backed project truth — requested outcomes, constraints, open
// questions, and Plan/step references — as `:ProjectTruthRecord` nodes in the
// EXISTING working AGE graph `thinkgraph_liq` (never the known-bad `graph_liq`,
// never a new store). It never writes raw chat bodies: only a curated title +
// summary plus reference ids (planDraftId / planStepId / conversationId /
// messageId). projectId is the authoritative Batch A scope — every write and
// read is project-scoped, so one project can never read another's truth.

import { runCypherOnGraph } from '../graphService';

const THINKGRAPH_GRAPH_NAME = 'thinkgraph_liq';
const MAX_TEXT = 2000;
const MAX_LIMIT = 50;

export type ProjectTruthKind =
  | 'requested_outcome'
  | 'constraint'
  | 'open_question'
  | 'plan_ref'
  | 'plan_step_ref'
  | 'decision';

const KINDS = new Set<ProjectTruthKind>([
  'requested_outcome',
  'constraint',
  'open_question',
  'plan_ref',
  'plan_step_ref',
  'decision',
]);

export type ProjectTruthRecordInput = {
  projectId: string;
  kind: ProjectTruthKind;
  title: string;
  summary?: string;
  planDraftId?: string | null;
  planStepId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  createdBy?: string;
};

export type StoredProjectTruthRecord = {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  summary: string;
  planDraftId: string;
  planStepId: string;
  conversationId: string;
  messageId: string;
  createdBy: string;
  createdAt: string;
};

function clampText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…(truncated)` : text;
}

function parseRow(raw: unknown): Record<string, any> | null {
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

/**
 * Write one curated `:ProjectTruthRecord` into ThinkGraph (`thinkgraph_liq`).
 * Fails closed (throws) on a missing project scope, an unknown kind, an empty
 * title, or a failed AGE write — never reports a fabricated success.
 */
export async function recordProjectTruth(
  input: ProjectTruthRecordInput,
): Promise<{ id: string; ts: string }> {
  const projectId = String(input.projectId || '').trim();
  if (!projectId) throw new Error('project_truth_project_id_required');
  if (!KINDS.has(input.kind)) throw new Error('project_truth_kind_invalid');
  const title = clampText(input.title);
  if (!title) throw new Error('project_truth_title_required');

  const ts = new Date().toISOString();
  const id = `tgtruth:${projectId}:${input.kind}:${Date.now().toString(36)}`;

  const cypher = `
    CREATE (r:ProjectTruthRecord {
      id: $id,
      project_id: $projectId,
      kind: $kind,
      title: $title,
      summary: $summary,
      plan_draft_id: $planDraftId,
      plan_step_id: $planStepId,
      conversation_id: $conversationId,
      message_id: $messageId,
      created_by: $createdBy,
      created_at: $ts
    })
    RETURN r.id
  `;
  await runCypherOnGraph(THINKGRAPH_GRAPH_NAME, cypher, {
    id,
    projectId,
    kind: input.kind,
    title,
    summary: clampText(input.summary),
    planDraftId: clampText(input.planDraftId),
    planStepId: clampText(input.planStepId),
    conversationId: clampText(input.conversationId),
    messageId: clampText(input.messageId),
    createdBy: clampText(input.createdBy) || 'harness',
    ts,
  });
  return { id, ts };
}

export type ReadProjectTruthQuery = {
  projectId: string;
  planDraftId?: string | null;
  planStepId?: string | null;
  limit?: number;
};

/**
 * Read project-scoped `:ProjectTruthRecord`s from `thinkgraph_liq`, newest
 * first. ALWAYS filters by project_id (the Batch A boundary) so another project
 * can never retrieve these rows. Optional planStepId/planDraftId narrow within
 * the project. Returns [] for an empty/blank scope — honest empty, never fake.
 */
export async function readProjectTruth(
  query: ReadProjectTruthQuery,
): Promise<StoredProjectTruthRecord[]> {
  const projectId = String(query.projectId || '').trim();
  if (!projectId) return [];
  const planStepId = String(query.planStepId || '').trim();
  const planDraftId = String(query.planDraftId || '').trim();
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 10) || 10, 1), MAX_LIMIT);

  // Project lens: project-level truth (no plan/step link) ALWAYS surfaces for the
  // project. A plan/step filter additionally admits records tied to THAT plan/step
  // and hides records tied to a DIFFERENT plan/step — it never hides project-level
  // truth. project_id (the MATCH) is the hard cross-project boundary.
  const cypher = `
    MATCH (r:ProjectTruthRecord {project_id: $projectId})
    WHERE ($planStepId = '' OR r.plan_step_id = '' OR r.plan_step_id = $planStepId)
      AND ($planDraftId = '' OR r.plan_draft_id = '' OR r.plan_draft_id = $planDraftId)
    RETURN {
      id: r.id, project_id: r.project_id, kind: r.kind,
      title: r.title, summary: r.summary,
      plan_draft_id: r.plan_draft_id, plan_step_id: r.plan_step_id,
      conversation_id: r.conversation_id, message_id: r.message_id,
      created_by: r.created_by, created_at: r.created_at
    }
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;
  const rows = await runCypherOnGraph(THINKGRAPH_GRAPH_NAME, cypher, {
    projectId,
    planStepId,
    planDraftId,
  });
  return rows
    .map(parseRow)
    .filter((row): row is Record<string, any> => Boolean(row))
    .map((row) => ({
      id: String(row.id ?? ''),
      projectId: String(row.project_id ?? ''),
      kind: String(row.kind ?? ''),
      title: String(row.title ?? ''),
      summary: String(row.summary ?? ''),
      planDraftId: String(row.plan_draft_id ?? ''),
      planStepId: String(row.plan_step_id ?? ''),
      conversationId: String(row.conversation_id ?? ''),
      messageId: String(row.message_id ?? ''),
      createdBy: String(row.created_by ?? ''),
      createdAt: String(row.created_at ?? ''),
    }));
}
