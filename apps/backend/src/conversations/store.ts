// Native runtime histories remain owned by their exact saved Card sessions.
// This store persists only the shared-chat projection of user-authored turns and
// completed native replies so the UI can retain truthful cross-Card speaker
// identity. Python remains the sole owner of saved Card Runs and their IDFs.
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
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
  cardId?: string;
  profile?: string;
  address?: string;
};

export type SharedChatParticipant = {
  kind: 'user' | 'card';
  label: string;
  cardId?: string;
  profile?: string;
  address?: string;
};

export type SharedChatMessageWrite = {
  role: 'user' | 'assistant';
  content: string;
  speaker: SharedChatParticipant;
  target?: SharedChatParticipant;
  providerContinuationRef?: string | null;
  providerMessageId?: string | null;
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

async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function resolveProjectId(
  client: Pick<PoolClient, 'query'>,
  projectId: string,
): Promise<string> {
  const lookup = projectLookup(projectId);
  const result = await client.query(
    `SELECT id FROM ${PROJECTS_TABLE} WHERE ${lookup.clause} LIMIT 1`,
    [lookup.value],
  );
  if (!result.rows.length) throw new Error('project_not_found');
  return String(result.rows[0].id);
}

function participantActivity(
  kind: 'shared_chat_speaker' | 'shared_chat_target',
  participant: SharedChatParticipant,
): VisibleActivity {
  return {
    kind,
    label: participant.label,
    status: participant.kind,
    ...(participant.cardId ? { cardId: participant.cardId, ref: participant.cardId } : {}),
    ...(participant.profile ? { profile: participant.profile } : {}),
    ...(participant.address ? { address: participant.address } : {}),
  };
}

/**
 * Append one completed shared-chat turn. If this is the first projected turn,
 * the caller may supply the already-read native Main history as a one-time seed.
 * The transaction locks the existing conversation row so speaker ordering and
 * sequence identities remain exact under concurrent requests.
 */
export async function appendSharedConversationTurn(input: {
  projectId: string;
  conversationId: string;
  seedMessages?: SharedChatMessageWrite[];
  messages: SharedChatMessageWrite[];
}): Promise<ConversationMessage[]> {
  if (!input.conversationId.trim() || input.messages.length === 0) {
    throw new Error('shared_conversation_turn_invalid');
  }
  return withTransaction(async (client) => {
    const canonicalProjectId = await resolveProjectId(client, input.projectId);
    await client.query(
      `INSERT INTO ${CONVERSATIONS_TABLE} (project_id, conversation_id)
       VALUES ($1::uuid, $2)
       ON CONFLICT (project_id, conversation_id) DO NOTHING`,
      [canonicalProjectId, input.conversationId],
    );
    const locked = await client.query(
      `SELECT next_seq FROM ${CONVERSATIONS_TABLE}
       WHERE project_id = $1::uuid AND conversation_id = $2
       FOR UPDATE`,
      [canonicalProjectId, input.conversationId],
    );
    if (!locked.rows.length) throw new Error('conversation_not_found');
    const existing = await client.query(
      `SELECT 1 FROM ${MESSAGES_TABLE}
       WHERE project_id = $1::uuid AND conversation_id = $2
       LIMIT 1`,
      [canonicalProjectId, input.conversationId],
    );
    const writes = [
      ...(existing.rows.length ? [] : input.seedMessages || []),
      ...input.messages,
    ];
    if (writes.length === 0) return [];
    const sequence = await client.query(
      `UPDATE ${CONVERSATIONS_TABLE}
       SET next_seq = next_seq + $3, updated_at = NOW()
       WHERE project_id = $1::uuid AND conversation_id = $2
       RETURNING next_seq`,
      [canonicalProjectId, input.conversationId, writes.length],
    );
    if (!sequence.rows.length) throw new Error('conversation_not_found');
    const firstSequence = Number(sequence.rows[0].next_seq) - writes.length + 1;
    const inserted: ConversationMessage[] = [];
    for (const [index, write] of writes.entries()) {
      const activities = [
        participantActivity('shared_chat_speaker', write.speaker),
        ...(write.target ? [participantActivity('shared_chat_target', write.target)] : []),
      ];
      const result = await client.query(
        `INSERT INTO ${MESSAGES_TABLE} (
           project_id, conversation_id, message_id, role, content, status, seq,
           completed_at, provider_continuation_ref, provider_message_id,
           visible_activities
         )
         VALUES ($1::uuid, $2, $3, $4, $5, 'complete', $6, NOW(), $7, $8, $9::jsonb)
         RETURNING *`,
        [
          canonicalProjectId,
          input.conversationId,
          `msg_${randomUUID()}`,
          write.role,
          write.content,
          firstSequence + index,
          write.providerContinuationRef ?? null,
          write.providerMessageId ?? null,
          JSON.stringify(activities),
        ],
      );
      inserted.push(mapMessage(result.rows[0]));
    }
    return inserted;
  });
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
