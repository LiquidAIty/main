// Runtime histories remain owned by their exact saved Card sessions.
// This store persists only the shared-chat projection of user-authored turns and
// completed provider replies so the UI can retain truthful cross-Card speaker
// identity. Python remains the sole owner of saved Card Runs and their IDFs.
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';

const PROJECTS_TABLE = 'ag_catalog.projects';
const CONVERSATIONS_TABLE = 'ag_catalog.conversations';
const MESSAGES_TABLE = 'ag_catalog.conversation_messages';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_ID_REGEX = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  messageId?: string;
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
  role: ConversationRole;
  content: string;
  status: ConversationMessageStatus;
  createdAt: string;
  completedAt?: string | null;
  providerContinuationRef?: string | null;
  providerMessageId?: string | null;
  visibleActivities?: VisibleActivity[];
  seq: number;
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

function mapMessage(row: Record<string, any>): ConversationMessage {
  return {
    messageId: String(row.message_id),
    projectId: String(row.project_id),
    conversationId: String(row.conversation_id),
    role: row.role as ConversationRole,
    content: String(row.content ?? ''),
    status: row.status as ConversationMessageStatus,
    createdAt: iso(row.created_at),
    completedAt: row.completed_at == null ? null : iso(row.completed_at),
    providerContinuationRef: row.provider_continuation_ref == null
      ? null
      : String(row.provider_continuation_ref),
    providerMessageId: row.provider_message_id == null ? null : String(row.provider_message_id),
    visibleActivities: Array.isArray(row.visible_activities)
      ? row.visible_activities as VisibleActivity[]
      : undefined,
    seq: Number(row.seq),
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

function replayMatches(
  existing: ConversationMessage,
  write: SharedChatMessageWrite,
  activities: VisibleActivity[],
): boolean {
  return existing.role === write.role
    && (!write.messageId || existing.messageId === write.messageId)
    && existing.content === write.content
    && (existing.providerContinuationRef || null) === (write.providerContinuationRef || null)
    && JSON.stringify(existing.visibleActivities || []) === JSON.stringify(activities);
}

/** Persist one user-authored shared-chat message exactly once by client message ID. */
export async function appendSharedConversationUserMessageOnce(input: {
  projectId: string;
  conversationId: string;
  message: SharedChatMessageWrite & { role: 'user'; messageId: string };
}): Promise<{ inserted: boolean; message: ConversationMessage }> {
  if (
    !input.conversationId.trim()
    || !MESSAGE_ID_REGEX.test(input.message.messageId)
    || !input.message.content.trim()
  ) {
    throw new Error('shared_conversation_user_message_invalid');
  }
  return withTransaction(async (client) => {
    const canonicalProjectId = await resolveProjectId(client, input.projectId);
    const activities = [
      participantActivity('shared_chat_speaker', input.message.speaker),
      ...(input.message.target
        ? [participantActivity('shared_chat_target', input.message.target)]
        : []),
    ];
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
      `SELECT * FROM ${MESSAGES_TABLE}
       WHERE project_id = $1::uuid AND conversation_id = $2 AND message_id = $3
       ORDER BY seq ASC
       LIMIT 1`,
      [canonicalProjectId, input.conversationId, input.message.messageId],
    );
    if (existing.rows.length) {
      const message = mapMessage(existing.rows[0]);
      if (!replayMatches(message, input.message, activities)) {
        throw new Error('shared_conversation_message_identity_conflict');
      }
      return { inserted: false, message };
    }
    const sequence = await client.query(
      `UPDATE ${CONVERSATIONS_TABLE}
       SET next_seq = next_seq + 1, updated_at = NOW()
       WHERE project_id = $1::uuid AND conversation_id = $2
       RETURNING next_seq`,
      [canonicalProjectId, input.conversationId],
    );
    if (!sequence.rows.length) throw new Error('conversation_not_found');
    const write = input.message;
    const result = await client.query(
      `INSERT INTO ${MESSAGES_TABLE} (
         project_id, conversation_id, message_id, role, content, status, seq,
         completed_at, provider_continuation_ref, provider_message_id,
         visible_activities
       )
       VALUES ($1::uuid, $2, $3, 'user', $4, 'complete', $5, NOW(), $6, $7, $8::jsonb)
       RETURNING *`,
      [
        canonicalProjectId,
        input.conversationId,
        write.messageId,
        write.content,
        Number(sequence.rows[0].next_seq),
        write.providerContinuationRef ?? null,
        write.providerMessageId ?? null,
        JSON.stringify(activities),
      ],
    );
    return { inserted: true, message: mapMessage(result.rows[0]) };
  });
}

/**
 * Append one completed Card reply exactly once by provider message id.
 * The existing conversation-row lock is the serialization owner, so concurrent
 * completion observers cannot allocate duplicate sequence numbers or messages.
 */
export async function appendSharedConversationReplyOnce(input: {
  projectId: string;
  conversationId: string;
  message: SharedChatMessageWrite & { role: 'assistant'; providerMessageId: string };
}): Promise<{ inserted: boolean; message: ConversationMessage }> {
  const providerMessageId = input.message.providerMessageId.trim();
  if (!input.conversationId.trim() || !providerMessageId || !input.message.content.trim()) {
    throw new Error('shared_conversation_reply_invalid');
  }
  if (input.message.messageId && !MESSAGE_ID_REGEX.test(input.message.messageId)) {
    throw new Error('shared_conversation_message_id_invalid');
  }
  return withTransaction(async (client) => {
    const canonicalProjectId = await resolveProjectId(client, input.projectId);
    const activities = [
      participantActivity('shared_chat_speaker', input.message.speaker),
      ...(input.message.target
        ? [participantActivity('shared_chat_target', input.message.target)]
        : []),
    ];
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
      `SELECT * FROM ${MESSAGES_TABLE}
       WHERE project_id = $1::uuid AND conversation_id = $2
         AND provider_message_id = $3
       ORDER BY seq ASC
       LIMIT 1`,
      [canonicalProjectId, input.conversationId, providerMessageId],
    );
    if (existing.rows.length) {
      const message = mapMessage(existing.rows[0]);
      if (!replayMatches(message, input.message, activities)) {
        throw new Error('shared_conversation_reply_identity_conflict');
      }
      return { inserted: false, message };
    }
    const sequence = await client.query(
      `UPDATE ${CONVERSATIONS_TABLE}
       SET next_seq = next_seq + 1, updated_at = NOW()
       WHERE project_id = $1::uuid AND conversation_id = $2
       RETURNING next_seq`,
      [canonicalProjectId, input.conversationId],
    );
    if (!sequence.rows.length) throw new Error('conversation_not_found');
    const result = await client.query(
      `INSERT INTO ${MESSAGES_TABLE} (
         project_id, conversation_id, message_id, role, content, status, seq,
         completed_at, provider_continuation_ref, provider_message_id,
         visible_activities
       )
       VALUES ($1::uuid, $2, $3, 'assistant', $4, 'complete', $5, NOW(), $6, $7, $8::jsonb)
       RETURNING *`,
      [
        canonicalProjectId,
        input.conversationId,
        input.message.messageId || `msg_${randomUUID()}`,
        input.message.content,
        Number(sequence.rows[0].next_seq),
        input.message.providerContinuationRef ?? null,
        providerMessageId,
        JSON.stringify(activities),
      ],
    );
    return { inserted: true, message: mapMessage(result.rows[0]) };
  });
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
