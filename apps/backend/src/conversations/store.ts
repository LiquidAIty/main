// @graph entity: ConversationStore
// @graph role: durable-project-conversation-persistence
// @graph relates_to: DeckStore (sibling key in the same project agent_io_schema)
//
// Durable, project-scoped Harness conversation history with branching (parent
// message links). This is the user-facing/UI transcript layer — SEPARATE from
// DeckDocument (canvas/Plan) and from ThinkGraph/KnowGraph (curated memory).
// Persistence reuses the existing authoritative substrate: the project row's
// `agent_io_schema` jsonb, under its own key (`liquidaity_conversations_v1`).

import { randomUUID } from 'crypto';
import { pool } from '../db/pool';

const PROJECTS_TABLE = 'ag_catalog.projects';
const CONVERSATIONS_STATE_KEY = 'liquidaity_conversations_v1';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAS_RETRIES = 4;

// ── Types ────────────────────────────────────────────────────────────────────

type ConversationRole = 'user' | 'assistant' | 'system' | 'tool' | 'question' | 'answer';
type ConversationMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

type VisibleActivity = {
  kind: string;
  label: string;
  status?: string;
  detail?: string;
  ref?: string;
};

type ConversationMessage = {
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

type ProjectConversation = {
  conversationId: string;
  projectId: string;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

type ConversationBlob = {
  conversations: Record<string, ProjectConversation>;
  messages: Record<string, ConversationMessage>;
  seq: number;
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) return { clause: 'id = $1', params: [projectId] };
  return { clause: 'code = $1', params: [projectId] };
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyBlob(): ConversationBlob {
  return { conversations: {}, messages: {}, seq: 0 };
}

function normalizeBlob(value: unknown): ConversationBlob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyBlob();
  const raw = value as Record<string, unknown>;
  const conversations: Record<string, ProjectConversation> = {};
  const messages: Record<string, ConversationMessage> = {};
  const cRaw = raw.conversations && typeof raw.conversations === 'object' ? (raw.conversations as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(cRaw)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    conversations[id] = {
      conversationId: asStr(o.conversationId) || id,
      projectId: asStr(o.projectId),
      title: typeof o.title === 'string' ? o.title : null,
      createdAt: asStr(o.createdAt) || nowIso(),
      updatedAt: asStr(o.updatedAt) || nowIso(),
      archivedAt: typeof o.archivedAt === 'string' ? o.archivedAt : null,
    };
  }
  const mRaw = raw.messages && typeof raw.messages === 'object' ? (raw.messages as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(mRaw)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    messages[id] = {
      messageId: asStr(o.messageId) || id,
      projectId: asStr(o.projectId),
      conversationId: asStr(o.conversationId),
      parentMessageId: typeof o.parentMessageId === 'string' ? o.parentMessageId : null,
      role: (typeof o.role === 'string' ? o.role : 'user') as ConversationRole,
      content: typeof o.content === 'string' ? o.content : '',
      status: (typeof o.status === 'string' ? o.status : 'complete') as ConversationMessageStatus,
      createdAt: asStr(o.createdAt) || nowIso(),
      completedAt: typeof o.completedAt === 'string' ? o.completedAt : null,
      providerContinuationRef: typeof o.providerContinuationRef === 'string' ? o.providerContinuationRef : null,
      providerMessageId: typeof o.providerMessageId === 'string' ? o.providerMessageId : null,
      linkedPlanDraftId: typeof o.linkedPlanDraftId === 'string' ? o.linkedPlanDraftId : null,
      linkedPlanStepId: typeof o.linkedPlanStepId === 'string' ? o.linkedPlanStepId : null,
      linkedArtifactIds: Array.isArray(o.linkedArtifactIds) ? o.linkedArtifactIds.filter((x): x is string => typeof x === 'string') : [],
      linkedEvidenceIds: Array.isArray(o.linkedEvidenceIds) ? o.linkedEvidenceIds.filter((x): x is string => typeof x === 'string') : [],
      visibleActivities: Array.isArray(o.visibleActivities) ? (o.visibleActivities as VisibleActivity[]) : undefined,
      seq: typeof o.seq === 'number' ? o.seq : 0,
    };
  }
  return {
    conversations,
    messages,
    seq: typeof raw.seq === 'number' ? raw.seq : 0,
  };
}

async function loadSchema(projectId: string): Promise<{ clause: string; params: any[]; ioSchema: Record<string, unknown> }> {
  const { clause, params } = projectLookup(projectId);
  const { rows } = await pool.query(
    `SELECT agent_io_schema FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params,
  );
  if (!rows.length) throw new Error('project_not_found');
  const ioSchema =
    rows[0].agent_io_schema && typeof rows[0].agent_io_schema === 'object'
      ? (rows[0].agent_io_schema as Record<string, unknown>)
      : {};
  return { clause, params, ioSchema };
}

async function getConversationBlob(projectId: string): Promise<ConversationBlob> {
  const { ioSchema } = await loadSchema(projectId);
  return normalizeBlob((ioSchema as any)[CONVERSATIONS_STATE_KEY]);
}

async function writeConversationBlobCas(
  projectId: string,
  updater: (blob: ConversationBlob) => ConversationBlob,
): Promise<ConversationBlob> {
  for (let attempt = 0; attempt < CAS_RETRIES; attempt += 1) {
    const { clause, params, ioSchema } = await loadSchema(projectId);
    const current = normalizeBlob((ioSchema as any)[CONVERSATIONS_STATE_KEY]);
    const next = updater(current);
    const nextSchema = { ...ioSchema, [CONVERSATIONS_STATE_KEY]: next };
    const result = await pool.query(
      `UPDATE ${PROJECTS_TABLE}
       SET agent_io_schema = $${params.length + 1}::jsonb, updated_at = NOW()
       WHERE ${clause}
         AND COALESCE(agent_io_schema, '{}'::jsonb) = $${params.length + 2}::jsonb
       RETURNING agent_io_schema`,
      [...params, JSON.stringify(nextSchema), JSON.stringify(ioSchema)],
    );
    if (result.rows.length > 0) {
      const saved =
        result.rows[0].agent_io_schema && typeof result.rows[0].agent_io_schema === 'object'
          ? (result.rows[0].agent_io_schema as Record<string, unknown>)
          : {};
      return normalizeBlob((saved as any)[CONVERSATIONS_STATE_KEY]);
    }
  }
  throw new Error('conversation_store_conflict');
}

function ensureConversation(blob: ConversationBlob, projectId: string, conversationId: string): ConversationBlob {
  if (blob.conversations[conversationId]) return blob;
  const ts = nowIso();
  return {
    ...blob,
    conversations: {
      ...blob.conversations,
      [conversationId]: { conversationId, projectId, title: null, createdAt: ts, updatedAt: ts },
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

type AppendMessageInput = {
  projectId: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  status?: ConversationMessageStatus;
  parentMessageId?: string | null;
  messageId?: string;
  linkedPlanDraftId?: string | null;
  linkedPlanStepId?: string | null;
  linkedArtifactIds?: string[];
  linkedEvidenceIds?: string[];
  visibleActivities?: VisibleActivity[];
  providerContinuationRef?: string | null;
};

export async function appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
  const messageId = asStr(input.messageId).trim() || `msg_${randomUUID()}`;
  let saved: ConversationMessage | null = null;
  await writeConversationBlobCas(input.projectId, (blob0) => {
    const blob = ensureConversation(blob0, input.projectId, input.conversationId);
    const seq = blob.seq + 1;
    const ts = nowIso();
    const status = input.status ?? 'complete';
    const message: ConversationMessage = {
      messageId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      parentMessageId: input.parentMessageId ?? null,
      role: input.role,
      content: input.content,
      status,
      createdAt: ts,
      completedAt: status === 'complete' || status === 'error' ? ts : null,
      providerContinuationRef: input.providerContinuationRef ?? null,
      linkedPlanDraftId: input.linkedPlanDraftId ?? null,
      linkedPlanStepId: input.linkedPlanStepId ?? null,
      linkedArtifactIds: input.linkedArtifactIds ?? [],
      linkedEvidenceIds: input.linkedEvidenceIds ?? [],
      visibleActivities: input.visibleActivities,
      seq,
    };
    saved = message;
    return {
      ...blob,
      seq,
      messages: { ...blob.messages, [messageId]: message },
      conversations: {
        ...blob.conversations,
        [input.conversationId]: { ...blob.conversations[input.conversationId], updatedAt: ts },
      },
    };
  });
  if (!saved) throw new Error('append_message_failed');
  return saved;
}

export async function listConversations(projectId: string): Promise<ProjectConversation[]> {
  const blob = await getConversationBlob(projectId);
  return Object.values(blob.conversations).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversationMessages(
  projectId: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const blob = await getConversationBlob(projectId);
  return Object.values(blob.messages)
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.seq - b.seq);
}
