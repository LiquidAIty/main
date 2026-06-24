// @graph entity: ConversationStore
// @graph role: durable-project-conversation-persistence
// @graph relates_to: DeckStore (sibling key in the same project agent_io_schema)
//
// Durable, project-scoped Harness conversation history with branching (parent
// message links) and an OutcomeReview foundation. This is the user-facing/UI
// transcript layer — SEPARATE from DeckDocument (canvas/Plan) and from
// ThinkGraph/KnowGraph (curated memory). The full transcript is never written
// into the deck, and raw message bodies are never auto-dumped into the graphs.
//
// Persistence reuses the existing authoritative substrate: the project row's
// `agent_io_schema` jsonb, under its own key (`liquidaity_conversations_v1`), with
// the same compare-and-swap write pattern as the deck store. Not React-only state,
// not browser localStorage.

import { createHash, randomUUID } from 'crypto';
import { pool } from '../db/pool';

const PROJECTS_TABLE = 'ag_catalog.projects';
const CONVERSATIONS_STATE_KEY = 'liquidaity_conversations_v1';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAS_RETRIES = 4;

export type ConversationRole = 'user' | 'assistant' | 'system' | 'tool' | 'question' | 'answer';
export type ConversationMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

// Only SAFE, user-visible work summaries / references — never raw hidden tool
// payloads, secrets, or private reasoning.
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
  // monotonic append sequence for stable ordering within a conversation
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

export type OutcomeReviewVerdict = 'unreviewed' | 'matched' | 'partial' | 'contradicted' | 'unknown';

export type OutcomeReview = {
  reviewId: string;
  projectId: string;
  requestMessageId?: string | null;
  planDraftId?: string | null;
  planStepId?: string | null;
  requestedOutcome: string;
  acceptanceCriteria: string[];
  actualArtifactIds: string[];
  actualEvidenceIds: string[];
  actualSummary?: string | null;
  verdict: OutcomeReviewVerdict;
  gaps: string[];
  nextDecision?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ConversationBlob = {
  conversations: Record<string, ProjectConversation>;
  messages: Record<string, ConversationMessage>;
  reviews: Record<string, OutcomeReview>;
  seq: number;
};

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) return { clause: 'id = $1', params: [projectId] };
  return { clause: 'code = $1', params: [projectId] };
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function asStrList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function nowIso(): string {
  return new Date().toISOString();
}

function emptyBlob(): ConversationBlob {
  return { conversations: {}, messages: {}, reviews: {}, seq: 0 };
}

function normalizeBlob(value: unknown): ConversationBlob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyBlob();
  const raw = value as Record<string, unknown>;
  const conversations: Record<string, ProjectConversation> = {};
  const messages: Record<string, ConversationMessage> = {};
  const reviews: Record<string, OutcomeReview> = {};
  const cRaw = raw.conversations && typeof raw.conversations === 'object' ? (raw.conversations as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(cRaw)) {
    if (!v || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    conversations[id] = {
      conversationId: asStr(c.conversationId) || id,
      projectId: asStr(c.projectId),
      title: typeof c.title === 'string' ? c.title : null,
      createdAt: asStr(c.createdAt) || nowIso(),
      updatedAt: asStr(c.updatedAt) || nowIso(),
      archivedAt: typeof c.archivedAt === 'string' ? c.archivedAt : null,
    };
  }
  const mRaw = raw.messages && typeof raw.messages === 'object' ? (raw.messages as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(mRaw)) {
    if (!v || typeof v !== 'object') continue;
    const m = v as Record<string, unknown>;
    messages[id] = {
      messageId: asStr(m.messageId) || id,
      projectId: asStr(m.projectId),
      conversationId: asStr(m.conversationId),
      parentMessageId: typeof m.parentMessageId === 'string' ? m.parentMessageId : null,
      role: (asStr(m.role) || 'user') as ConversationRole,
      content: asStr(m.content),
      status: (asStr(m.status) || 'complete') as ConversationMessageStatus,
      createdAt: asStr(m.createdAt) || nowIso(),
      completedAt: typeof m.completedAt === 'string' ? m.completedAt : null,
      providerContinuationRef: typeof m.providerContinuationRef === 'string' ? m.providerContinuationRef : null,
      providerMessageId: typeof m.providerMessageId === 'string' ? m.providerMessageId : null,
      linkedPlanDraftId: typeof m.linkedPlanDraftId === 'string' ? m.linkedPlanDraftId : null,
      linkedPlanStepId: typeof m.linkedPlanStepId === 'string' ? m.linkedPlanStepId : null,
      linkedArtifactIds: asStrList(m.linkedArtifactIds),
      linkedEvidenceIds: asStrList(m.linkedEvidenceIds),
      visibleActivities: Array.isArray(m.visibleActivities)
        ? (m.visibleActivities as unknown[])
            .filter((a) => a && typeof a === 'object')
            .map((a) => {
              const act = a as Record<string, unknown>;
              return {
                kind: asStr(act.kind),
                label: asStr(act.label),
                status: typeof act.status === 'string' ? act.status : undefined,
                detail: typeof act.detail === 'string' ? act.detail : undefined,
                ref: typeof act.ref === 'string' ? act.ref : undefined,
              };
            })
        : undefined,
      seq: typeof m.seq === 'number' && Number.isFinite(m.seq) ? m.seq : 0,
    };
  }
  const rRaw = raw.reviews && typeof raw.reviews === 'object' ? (raw.reviews as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(rRaw)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const verdict = asStr(r.verdict);
    reviews[id] = {
      reviewId: asStr(r.reviewId) || id,
      projectId: asStr(r.projectId),
      requestMessageId: typeof r.requestMessageId === 'string' ? r.requestMessageId : null,
      planDraftId: typeof r.planDraftId === 'string' ? r.planDraftId : null,
      planStepId: typeof r.planStepId === 'string' ? r.planStepId : null,
      requestedOutcome: asStr(r.requestedOutcome),
      acceptanceCriteria: asStrList(r.acceptanceCriteria),
      actualArtifactIds: asStrList(r.actualArtifactIds),
      actualEvidenceIds: asStrList(r.actualEvidenceIds),
      actualSummary: typeof r.actualSummary === 'string' ? r.actualSummary : null,
      verdict: (['unreviewed', 'matched', 'partial', 'contradicted', 'unknown'].includes(verdict)
        ? verdict
        : 'unreviewed') as OutcomeReviewVerdict,
      gaps: asStrList(r.gaps),
      nextDecision: typeof r.nextDecision === 'string' ? r.nextDecision : null,
      createdAt: asStr(r.createdAt) || nowIso(),
      updatedAt: asStr(r.updatedAt) || nowIso(),
    };
  }
  return {
    conversations,
    messages,
    reviews,
    seq: typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : Object.keys(messages).length,
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

export async function getConversationBlob(projectId: string): Promise<ConversationBlob> {
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

export type AppendMessageInput = {
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

/** Append a new message (safe to call before/while a model turn runs). */
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

export type FinalizeMessageInput = {
  projectId: string;
  messageId: string;
  content?: string;
  status?: ConversationMessageStatus;
  linkedPlanDraftId?: string | null;
  linkedPlanStepId?: string | null;
  linkedArtifactIds?: string[];
  linkedEvidenceIds?: string[];
  visibleActivities?: VisibleActivity[];
};

/** Finalize an existing message (e.g. on stream done). No-op if missing. */
export async function finalizeMessage(input: FinalizeMessageInput): Promise<ConversationMessage | null> {
  let saved: ConversationMessage | null = null;
  await writeConversationBlobCas(input.projectId, (blob) => {
    const existing = blob.messages[input.messageId];
    if (!existing) return blob;
    const ts = nowIso();
    const status = input.status ?? 'complete';
    const next: ConversationMessage = {
      ...existing,
      content: input.content !== undefined ? input.content : existing.content,
      status,
      completedAt: status === 'complete' || status === 'error' ? ts : existing.completedAt ?? null,
      linkedPlanDraftId: input.linkedPlanDraftId !== undefined ? input.linkedPlanDraftId : existing.linkedPlanDraftId,
      linkedPlanStepId: input.linkedPlanStepId !== undefined ? input.linkedPlanStepId : existing.linkedPlanStepId,
      linkedArtifactIds: input.linkedArtifactIds ?? existing.linkedArtifactIds,
      linkedEvidenceIds: input.linkedEvidenceIds ?? existing.linkedEvidenceIds,
      visibleActivities: input.visibleActivities ?? existing.visibleActivities,
    };
    saved = next;
    return {
      ...blob,
      messages: { ...blob.messages, [input.messageId]: next },
      conversations: {
        ...blob.conversations,
        [existing.conversationId]: { ...blob.conversations[existing.conversationId], updatedAt: ts },
      },
    };
  });
  return saved;
}

export async function listConversations(projectId: string): Promise<ProjectConversation[]> {
  const blob = await getConversationBlob(projectId);
  return Object.values(blob.conversations).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMostRecentConversation(projectId: string): Promise<ProjectConversation | null> {
  const list = await listConversations(projectId);
  return list.find((c) => !c.archivedAt) ?? list[0] ?? null;
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

// ── Branch traversal ────────────────────────────────────────────────────────
/** Walk parentMessageId from a leaf up to the root, returning root→leaf order. */
export function lineageOf(
  messagesById: Record<string, ConversationMessage>,
  leafMessageId: string,
): ConversationMessage[] {
  const chain: ConversationMessage[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = leafMessageId;
  while (cur && messagesById[cur] && !seen.has(cur)) {
    seen.add(cur);
    chain.push(messagesById[cur]);
    cur = messagesById[cur].parentMessageId;
  }
  return chain.reverse();
}

// ── Outcome review foundation ───────────────────────────────────────────────
export type UpsertOutcomeReviewInput = {
  projectId: string;
  reviewId?: string;
  requestMessageId?: string | null;
  planDraftId?: string | null;
  planStepId?: string | null;
  requestedOutcome: string;
  acceptanceCriteria?: string[];
  actualArtifactIds?: string[];
  actualEvidenceIds?: string[];
  actualSummary?: string | null;
  // verdict NEVER auto-advances past unreviewed here — only an explicit caller may.
  verdict?: OutcomeReviewVerdict;
  gaps?: string[];
  nextDecision?: string | null;
};

export async function upsertOutcomeReview(input: UpsertOutcomeReviewInput): Promise<OutcomeReview> {
  const reviewId = asStr(input.reviewId).trim() || `review_${randomUUID()}`;
  let saved: OutcomeReview | null = null;
  await writeConversationBlobCas(input.projectId, (blob) => {
    const existing = blob.reviews[reviewId];
    const ts = nowIso();
    const review: OutcomeReview = {
      reviewId,
      projectId: input.projectId,
      requestMessageId: input.requestMessageId ?? existing?.requestMessageId ?? null,
      planDraftId: input.planDraftId ?? existing?.planDraftId ?? null,
      planStepId: input.planStepId ?? existing?.planStepId ?? null,
      requestedOutcome: input.requestedOutcome ?? existing?.requestedOutcome ?? '',
      acceptanceCriteria: input.acceptanceCriteria ?? existing?.acceptanceCriteria ?? [],
      actualArtifactIds: input.actualArtifactIds ?? existing?.actualArtifactIds ?? [],
      actualEvidenceIds: input.actualEvidenceIds ?? existing?.actualEvidenceIds ?? [],
      actualSummary: input.actualSummary ?? existing?.actualSummary ?? null,
      // Default verdict is ALWAYS unreviewed; never auto-marked matched/complete.
      verdict: input.verdict ?? existing?.verdict ?? 'unreviewed',
      gaps: input.gaps ?? existing?.gaps ?? [],
      nextDecision: input.nextDecision ?? existing?.nextDecision ?? null,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    saved = review;
    return { ...blob, reviews: { ...blob.reviews, [reviewId]: review } };
  });
  if (!saved) throw new Error('upsert_outcome_review_failed');
  return saved;
}

export async function getOutcomeReviews(
  projectId: string,
  filter?: { planDraftId?: string; planStepId?: string },
): Promise<OutcomeReview[]> {
  const blob = await getConversationBlob(projectId);
  let list = Object.values(blob.reviews);
  if (filter?.planDraftId) list = list.filter((r) => r.planDraftId === filter.planDraftId);
  if (filter?.planStepId) list = list.filter((r) => r.planStepId === filter.planStepId);
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function _hashForTest(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value ?? null)).digest('hex');
}
