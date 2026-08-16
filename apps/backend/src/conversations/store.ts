// Legacy conversation data is read-only after the transient-IDF cutover.
// New Main/Card turns keep live UI/runtime state and Python owns prompt-free
// durable Runs; TypeScript must not write transcripts or domain lifecycle.
import { pool } from '../db/pool';

const PROJECTS_TABLE = 'ag_catalog.projects';
const CONVERSATIONS_TABLE = 'ag_catalog.conversations';
const MESSAGES_TABLE = 'ag_catalog.conversation_messages';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConversationRole = 'user' | 'assistant' | 'system' | 'tool' | 'question' | 'answer';
export type ConversationMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export type VisibleActivity = {
  kind: string;
  label: string;
  status?: string;
  detail?: string;
  ref?: string;
};

export type ConversationMessage = {
  messageId: string;
  projectId: string;
  conversationId: string;
  parentMessageId?: string | null;
  role: ConversationRole;
  content: string;
  status: ConversationMessageStatus;
  createdAt: string;
  completedAt?: string | null;
  providerContinuationRef?: string | null;
  providerMessageId?: string | null;
  linkedPlanDraftId?: string | null;
  linkedPlanStepId?: string | null;
  linkedArtifactIds?: string[];
  linkedEvidenceIds?: string[];
  visibleActivities?: VisibleActivity[];
  seq: number;
};

export type ProjectConversation = {
  conversationId: string;
  projectId: string;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

function projectLookup(projectId: string, parameterIndex = 1): { clause: string; value: string } {
  return {
    clause: UUID_REGEX.test(projectId) ? `id = $${parameterIndex}` : `code = $${parameterIndex}`,
    value: projectId,
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function mapMessage(row: Record<string, any>): ConversationMessage {
  return {
    messageId: String(row.message_id),
    projectId: String(row.project_id),
    conversationId: String(row.conversation_id),
    parentMessageId: row.parent_message_id == null ? null : String(row.parent_message_id),
    role: row.role as ConversationRole,
    content: String(row.content ?? ''),
    status: row.status as ConversationMessageStatus,
    createdAt: iso(row.created_at),
    completedAt: row.completed_at == null ? null : iso(row.completed_at),
    providerContinuationRef: row.provider_continuation_ref == null
      ? null
      : String(row.provider_continuation_ref),
    providerMessageId: row.provider_message_id == null ? null : String(row.provider_message_id),
    linkedPlanDraftId: row.linked_plan_draft_id == null ? null : String(row.linked_plan_draft_id),
    linkedPlanStepId: row.linked_plan_step_id == null ? null : String(row.linked_plan_step_id),
    linkedArtifactIds: stringArray(row.linked_artifact_ids),
    linkedEvidenceIds: stringArray(row.linked_evidence_ids),
    visibleActivities: Array.isArray(row.visible_activities)
      ? row.visible_activities as VisibleActivity[]
      : undefined,
    seq: Number(row.seq),
  };
}

function mapConversation(row: Record<string, any>): ProjectConversation {
  return {
    projectId: String(row.project_id),
    conversationId: String(row.conversation_id),
    title: row.title == null ? null : String(row.title),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: row.archived_at == null ? null : iso(row.archived_at),
  };
}

export async function listConversations(projectId: string): Promise<ProjectConversation[]> {
  const lookup = projectLookup(projectId);
  const result = await pool.query(
    `SELECT conversation.*
     FROM ${CONVERSATIONS_TABLE} AS conversation
     JOIN ${PROJECTS_TABLE} AS project ON project.id = conversation.project_id
     WHERE project.${lookup.clause}
     ORDER BY conversation.updated_at DESC`,
    [lookup.value],
  );
  return result.rows.map(mapConversation);
}

export async function getConversationMessages(
  projectId: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const lookup = projectLookup(projectId);
  const result = await pool.query(
    `SELECT message.*
     FROM ${MESSAGES_TABLE} AS message
     JOIN ${PROJECTS_TABLE} AS project ON project.id = message.project_id
     WHERE project.${lookup.clause}
       AND message.conversation_id = $2
     ORDER BY message.seq ASC`,
    [lookup.value, conversationId],
  );
  return result.rows.map(mapMessage);
}
