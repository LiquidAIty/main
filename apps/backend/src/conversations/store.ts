// @graph entity: ConversationStore
// @graph role: normalized-conversation-and-run-persistence
//
// PostgreSQL is the exact-content and lifecycle authority for the product
// transcript around LiquidAIty runtimes. Hermes and OpenClaude may retain
// native in-process history for live model continuity; those caches are not
// the product's durable conversation or run ledger.

import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';

const PROJECTS_TABLE = 'ag_catalog.projects';
const CONVERSATIONS_TABLE = 'ag_catalog.conversations';
const MESSAGES_TABLE = 'ag_catalog.conversation_messages';
const RUNS_TABLE = 'ag_catalog.card_run_traces';
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

export type ConversationRunUsage = {
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  totalCostUsd: number | null;
  usageAvailable: boolean;
  usageSource: string;
  contextBreakdownJson: string;
};

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
  providerMessageId?: string | null;
};

export type BeginConversationRunInput = {
  runId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId: string;
  runtime: string;
  sessionId: string;
  userContent: string;
  senderCardId?: string | null;
  parentRunId?: string | null;
  invocation?: {
    idfId: string;
    version: number;
    contentSha256: string;
  } | null;
};

export type ConversationRunReceipt = {
  correlationId: string;
  state: string;
  cardId: string;
  runtime: string;
  provider: string | null;
  modelKey: string | null;
  providerModelId: string | null;
  accessMode: string | null;
  idfId: string | null;
  idfVersion: number | null;
  idfContentSha256: string | null;
  resultArtifact: Record<string, unknown> | null;
  assignment: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  references: Array<Record<string, unknown>>;
  ageLineage: Array<Record<string, unknown>>;
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
    providerContinuationRef:
      row.provider_continuation_ref == null ? null : String(row.provider_continuation_ref),
    providerMessageId: row.provider_message_id == null ? null : String(row.provider_message_id),
    linkedPlanDraftId: row.linked_plan_draft_id == null ? null : String(row.linked_plan_draft_id),
    linkedPlanStepId: row.linked_plan_step_id == null ? null : String(row.linked_plan_step_id),
    linkedArtifactIds: stringArray(row.linked_artifact_ids),
    linkedEvidenceIds: stringArray(row.linked_evidence_ids),
    visibleActivities: Array.isArray(row.visible_activities)
      ? (row.visible_activities as VisibleActivity[])
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

async function resolveProjectId(client: Pick<PoolClient, 'query'>, projectId: string): Promise<string> {
  const lookup = projectLookup(projectId);
  const result = await client.query(
    `SELECT id FROM ${PROJECTS_TABLE} WHERE ${lookup.clause} LIMIT 1`,
    [lookup.value],
  );
  if (!result.rows.length) throw new Error('project_not_found');
  return String(result.rows[0].id);
}

async function queryAge(
  client: Pick<PoolClient, 'query'>,
  statement: string,
  parameters: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const result = await client.query(
    `SELECT observed::text AS observed
     FROM ag_catalog.cypher('agentgraph', $age$${statement}$age$, $1)
       AS (observed agtype)`,
    [JSON.stringify(parameters)],
  );
  return result.rows.map((row) => {
    const raw = String(row.observed || '{}');
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { raw };
    }
  });
}

async function observeAge(
  statement: string,
  parameters: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  try {
    return await queryAge(pool, statement, parameters);
  } catch {
    // AGE is an observer. A telemetry outage must not become execution or
    // persistence authority for the conversation, IDF, run, or result.
    console.warn('[age-observer] invocation lineage unavailable');
    return [];
  }
}

async function appendMessageWithClient(
  client: PoolClient,
  canonicalProjectId: string,
  input: AppendMessageInput,
): Promise<ConversationMessage> {
  const messageId = String(input.messageId || '').trim() || `msg_${randomUUID()}`;
  const existing = await client.query(
    `SELECT * FROM ${MESSAGES_TABLE} WHERE project_id = $1::uuid AND message_id = $2 LIMIT 1`,
    [canonicalProjectId, messageId],
  );
  if (existing.rows.length) return mapMessage(existing.rows[0]);

  await client.query(
    `INSERT INTO ${CONVERSATIONS_TABLE} (project_id, conversation_id)
     VALUES ($1::uuid, $2)
     ON CONFLICT (project_id, conversation_id) DO NOTHING`,
    [canonicalProjectId, input.conversationId],
  );
  const sequence = await client.query(
    `UPDATE ${CONVERSATIONS_TABLE}
     SET next_seq = next_seq + 1, updated_at = NOW()
     WHERE project_id = $1::uuid AND conversation_id = $2
     RETURNING next_seq`,
    [canonicalProjectId, input.conversationId],
  );
  if (!sequence.rows.length) throw new Error('conversation_not_found');

  const status = input.status ?? 'complete';
  const inserted = await client.query(
    `INSERT INTO ${MESSAGES_TABLE} (
       project_id,
       conversation_id,
       message_id,
       parent_message_id,
       role,
       content,
       status,
       seq,
       completed_at,
       provider_continuation_ref,
       provider_message_id,
       linked_plan_draft_id,
       linked_plan_step_id,
       linked_artifact_ids,
       linked_evidence_ids,
       visible_activities
     )
     VALUES (
       $1::uuid, $2, $3, $4, $5, $6, $7, $8,
       CASE WHEN $7 IN ('complete', 'error') THEN NOW() ELSE NULL END,
       $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb
     )
     RETURNING *`,
    [
      canonicalProjectId,
      input.conversationId,
      messageId,
      input.parentMessageId ?? null,
      input.role,
      input.content,
      status,
      Number(sequence.rows[0].next_seq),
      input.providerContinuationRef ?? null,
      input.providerMessageId ?? null,
      input.linkedPlanDraftId ?? null,
      input.linkedPlanStepId ?? null,
      JSON.stringify(input.linkedArtifactIds ?? []),
      JSON.stringify(input.linkedEvidenceIds ?? []),
      input.visibleActivities ? JSON.stringify(input.visibleActivities) : null,
    ],
  );
  return mapMessage(inserted.rows[0]);
}

async function getRunForUpdate(client: PoolClient, runId: string): Promise<Record<string, any>> {
  const result = await client.query(
    `SELECT * FROM ${RUNS_TABLE} WHERE correlation_id = $1 FOR UPDATE`,
    [runId],
  );
  if (!result.rows.length) throw new Error(`agent_run_not_found:${runId}`);
  return result.rows[0];
}

export async function beginConversationRun(
  input: BeginConversationRunInput,
): Promise<{ runId: string; userMessage: ConversationMessage }> {
  const begun = await withTransaction(async (client) => {
    const projectId = await resolveProjectId(client, input.projectId);
    const duplicate = await client.query(
      `SELECT correlation_id FROM ${RUNS_TABLE} WHERE correlation_id = $1 LIMIT 1`,
      [input.runId],
    );
    if (duplicate.rows.length) throw new Error(`agent_run_already_exists:${input.runId}`);

    const userMessage = await appendMessageWithClient(client, projectId, {
      projectId,
      conversationId: input.conversationId,
      role: 'user',
      content: input.userContent,
    });
    await client.query(
      `INSERT INTO ${RUNS_TABLE} (
         correlation_id,
         project_id,
         deck_id,
         card_id,
         outcome,
         conversation_id,
         runtime,
         state,
         session_id,
         user_message_id
       )
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'pending', $7, $8)`,
      [
        input.runId,
        projectId,
        input.deckId,
        input.cardId,
        input.conversationId,
        input.runtime,
        input.sessionId,
        userMessage.messageId,
      ],
    );
    if (input.invocation) {
      const assignmentId = `assignment:${input.runId}`;
      await client.query(
        `INSERT INTO ag_catalog.agent_assignments (
           assignment_id, project_id, correlation_id, deck_id, conversation_id,
           sender_card_id, receiver_card_id, parent_run_id, state
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
         ON CONFLICT (project_id, correlation_id) DO NOTHING`,
        [
          assignmentId,
          projectId,
          input.runId,
          input.deckId,
          input.conversationId,
          input.senderCardId || null,
          input.cardId,
          input.parentRunId || null,
        ],
      );
      await client.query(
        `INSERT INTO ag_catalog.agent_context_references
           (assignment_id, reference_id, reference_type, required)
         VALUES ($1,$2,'idf',TRUE)
         ON CONFLICT DO NOTHING`,
        [assignmentId, input.invocation.idfId],
      );
    }
    return {
      runId: input.runId,
      userMessage,
      ageObservation: input.invocation
        ? {
            assignmentId: `assignment:${input.runId}`,
            correlationId: input.runId,
            projectId,
            deckId: input.deckId,
            conversationId: input.conversationId,
            senderCardId: input.senderCardId || '',
            receiverCardId: input.cardId,
            idfId: input.invocation.idfId,
            idfVersion: input.invocation.version,
            idfContentSha256: input.invocation.contentSha256,
            observedAt: new Date().toISOString(),
          }
        : null,
    };
  });
  if (begun.ageObservation) {
    await observeAge(
      `MERGE (assignment:Assignment {assignmentId: $assignmentId})
       SET assignment.correlationId = $correlationId,
           assignment.projectId = $projectId,
           assignment.deckId = $deckId,
           assignment.conversationId = $conversationId,
           assignment.senderCardId = $senderCardId,
           assignment.receiverCardId = $receiverCardId,
           assignment.state = 'pending',
           assignment.materializedAt = $observedAt
       MERGE (idf:InputDataFile {idfId: $idfId})
       SET idf.version = $idfVersion,
           idf.contentSha256 = $idfContentSha256
       MERGE (assignment)-[:USES_IDF]->(idf)
       RETURN properties(assignment)`,
      begun.ageObservation,
    );
  }
  return { runId: begun.runId, userMessage: begun.userMessage };
}

export async function markConversationRunRunning(input: {
  runId: string;
  invokingCardId: string;
  runtime: string;
  provider: string;
  modelKey: string;
  providerModelId: string;
  accessMode: string;
  idfId: string;
  idfVersion: number;
  idfContentSha256: string;
}): Promise<void> {
  const result = await pool.query(
    `UPDATE ${RUNS_TABLE}
     SET state = 'running',
         outcome = 'running',
         card_id = $2,
         runtime = $3,
         provider = $4,
         model_key = $5,
          provider_model_id = $6,
          access_mode = $7,
          idf_id = $8,
          idf_version = $9,
          idf_content_sha256 = $10,
         started_at = COALESCE(started_at, NOW()),
         updated_at = NOW()
     WHERE correlation_id = $1 AND state = 'pending'
     RETURNING correlation_id`,
    [
      input.runId,
      input.invokingCardId,
      input.runtime,
      input.provider,
      input.modelKey,
      input.providerModelId,
      input.accessMode,
      input.idfId,
      input.idfVersion,
      input.idfContentSha256,
    ],
  );
  if (!result.rows.length) throw new Error(`agent_run_transition_conflict:${input.runId}:running`);
  await pool.query(
    `UPDATE ag_catalog.agent_assignments
     SET state='running', started_at=COALESCE(started_at,NOW()), updated_at=NOW()
     WHERE correlation_id=$1`,
    [input.runId],
  );
  await observeAge(
    `MATCH (assignment:Assignment {correlationId: $correlationId})
     SET assignment.state='running', assignment.dispatchedAt=$observedAt,
         assignment.runtime=$runtime, assignment.provider=$provider,
         assignment.model=$providerModelId
     RETURN properties(assignment)`,
    {
      correlationId: input.runId,
      observedAt: new Date().toISOString(),
      runtime: input.runtime,
      provider: input.provider,
      providerModelId: input.providerModelId,
    },
  );
}

export async function completeConversationRun(input: {
  runId: string;
  assistantContent: string;
  usage: ConversationRunUsage;
  transport?: {
    threadId?: string | null;
    turnId?: string | null;
    authMode?: string | null;
    planType?: string | null;
  };
  resultArtifact?: Record<string, unknown> | null;
}): Promise<{ resultMessageId: string | null }> {
  const completed = await withTransaction(async (client) => {
    const run = await getRunForUpdate(client, input.runId);
    if (run.state === 'completed') {
      return {
        resultMessageId: run.result_message_id == null ? null : String(run.result_message_id),
        ageObservation: null,
      };
    }
    if (run.state !== 'running') {
      throw new Error(`agent_run_transition_conflict:${input.runId}:completed_from_${run.state}`);
    }

    let resultMessageId: string | null = null;
    if (input.assistantContent.trim()) {
      const message = await appendMessageWithClient(client, String(run.project_id), {
        projectId: String(run.project_id),
        conversationId: String(run.conversation_id),
        role: 'assistant',
        content: input.assistantContent,
      });
      resultMessageId = message.messageId;
    }
    await client.query(
      `UPDATE ${RUNS_TABLE}
       SET state = 'completed',
           outcome = 'completed',
           result_message_id = $2,
           provider_input_tokens = $3,
           provider_output_tokens = $4,
           total_cost_usd = $5,
           usage_available = $6,
           usage_source = $7,
            context_breakdown_json = $8,
            provider_thread_id = $9,
            provider_turn_id = $10,
            provider_auth_mode = $11,
            provider_plan_type = $12,
            result_artifact_json = $13::jsonb,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE correlation_id = $1`,
      [
        input.runId,
        resultMessageId,
        input.usage.providerInputTokens,
        input.usage.providerOutputTokens,
        input.usage.totalCostUsd,
        input.usage.usageAvailable,
        input.usage.usageSource,
        input.usage.contextBreakdownJson,
        input.transport?.threadId ?? null,
        input.transport?.turnId ?? null,
        input.transport?.authMode ?? null,
        input.transport?.planType ?? null,
        input.resultArtifact ? JSON.stringify(input.resultArtifact) : null,
      ],
    );
    const assignment = await client.query<{ assignment_id: string }>(
      `SELECT assignment_id
       FROM ag_catalog.agent_assignments
       WHERE project_id=$1 AND correlation_id=$2`,
      [String(run.project_id), input.runId],
    );
    if (assignment.rows.length) {
      const assignmentId = assignment.rows[0].assignment_id;
      const resultId = `result:${input.runId}`;
      await client.query(
        `UPDATE ag_catalog.agent_assignments
         SET state='completed', completed_at=NOW(), updated_at=NOW()
         WHERE project_id=$1 AND correlation_id=$2`,
        [String(run.project_id), input.runId],
      );
      await client.query(
        `INSERT INTO ag_catalog.agent_results
           (result_id, assignment_id, project_id, correlation_id, status, output, summary, tool_evidence)
         VALUES ($1,$2,$3,$4,'completed',$5,$6,$7::jsonb)
         ON CONFLICT (assignment_id) DO UPDATE
         SET status='completed', output=EXCLUDED.output, summary=EXCLUDED.summary,
             tool_evidence=EXCLUDED.tool_evidence`,
        [
          resultId,
          assignmentId,
          String(run.project_id),
          input.runId,
          input.assistantContent,
          input.assistantContent.slice(0, 500),
          JSON.stringify([]),
        ],
      );
      return {
        resultMessageId,
        ageObservation: {
          correlationId: input.runId,
          resultId,
          observedAt: new Date().toISOString(),
        },
      };
    }
    return { resultMessageId, ageObservation: null };
  });
  if (completed.ageObservation) {
    await observeAge(
      `MATCH (assignment:Assignment {correlationId: $correlationId})
       SET assignment.state='completed', assignment.completedAt=$observedAt
       MERGE (result:Result {resultId: $resultId})
       SET result.status='completed', result.correlationId=$correlationId,
           result.createdAt=$observedAt
       MERGE (assignment)-[:PRODUCED]->(result)
       RETURN properties(assignment)`,
      completed.ageObservation,
    );
  }
  return { resultMessageId: completed.resultMessageId };
}

export async function failConversationRun(
  runId: string,
  errorCode: string,
  errorDetail: string,
): Promise<void> {
  const result = await pool.query(
    `UPDATE ${RUNS_TABLE}
     SET state = 'failed',
         outcome = 'failed',
         error_code = $2,
         detail = $3,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE correlation_id = $1 AND state IN ('pending', 'running')
     RETURNING correlation_id`,
    [runId, errorCode, errorDetail],
  );
  if (!result.rows.length) {
    const current = await pool.query(
      `SELECT state FROM ${RUNS_TABLE} WHERE correlation_id = $1`,
      [runId],
    );
    if (current.rows[0]?.state !== 'failed') {
      throw new Error(`agent_run_transition_conflict:${runId}:failed`);
    }
  }
  await pool.query(
    `UPDATE ag_catalog.agent_assignments
     SET state='failed', completed_at=NOW(), updated_at=NOW()
     WHERE correlation_id=$1`,
    [runId],
  );
  await observeAge(
    `MATCH (assignment:Assignment {correlationId: $correlationId})
     SET assignment.state='failed', assignment.completedAt=$observedAt,
         assignment.errorCode=$errorCode
     RETURN properties(assignment)`,
    { correlationId: runId, observedAt: new Date().toISOString(), errorCode },
  );
}

export async function getConversationRunReceipt(runId: string): Promise<ConversationRunReceipt> {
  const runResult = await pool.query(
    `SELECT * FROM ${RUNS_TABLE} WHERE correlation_id=$1 LIMIT 1`,
    [runId],
  );
  if (!runResult.rows.length) throw new Error(`agent_run_not_found:${runId}`);
  const run = runResult.rows[0];
  const assignmentResult = await pool.query(
    `SELECT * FROM ag_catalog.agent_assignments WHERE correlation_id=$1 LIMIT 1`,
    [runId],
  );
  const assignment = assignmentResult.rows[0] || null;
  const resultResult = assignment
    ? await pool.query(`SELECT * FROM ag_catalog.agent_results WHERE assignment_id=$1 LIMIT 1`, [assignment.assignment_id])
    : { rows: [] as any[] };
  const referencesResult = assignment
    ? await pool.query(`SELECT * FROM ag_catalog.agent_context_references WHERE assignment_id=$1 ORDER BY created_at`, [assignment.assignment_id])
    : { rows: [] as any[] };
  const ageLineage = await observeAge(
    `MATCH (assignment:Assignment {correlationId: $correlationId})
     OPTIONAL MATCH (assignment)-[relationship]->(related)
     RETURN {assignment: properties(assignment), relationship: type(relationship), related: properties(related)}`,
    { correlationId: runId },
  );
  return {
    correlationId: String(run.correlation_id),
    state: String(run.state),
    cardId: String(run.card_id),
    runtime: String(run.runtime),
    provider: run.provider == null ? null : String(run.provider),
    modelKey: run.model_key == null ? null : String(run.model_key),
    providerModelId: run.provider_model_id == null ? null : String(run.provider_model_id),
    accessMode: run.access_mode == null ? null : String(run.access_mode),
    idfId: run.idf_id == null ? null : String(run.idf_id),
    idfVersion: run.idf_version == null ? null : Number(run.idf_version),
    idfContentSha256: run.idf_content_sha256 == null ? null : String(run.idf_content_sha256),
    resultArtifact: run.result_artifact_json && typeof run.result_artifact_json === 'object'
      ? run.result_artifact_json as Record<string, unknown>
      : null,
    assignment,
    result: resultResult.rows[0] || null,
    references: referencesResult.rows,
    ageLineage,
  };
}

export async function cancelConversationRun(runId: string, reason = 'client_cancel'): Promise<void> {
  const result = await pool.query(
    `UPDATE ${RUNS_TABLE}
     SET state = 'cancelled',
         outcome = 'cancelled',
         error_code = $2,
         detail = $2,
         cancelled_at = NOW(),
         completed_at = NOW(),
         updated_at = NOW()
     WHERE correlation_id = $1 AND state IN ('pending', 'running')
     RETURNING correlation_id`,
    [runId, reason],
  );
  if (!result.rows.length) {
    const current = await pool.query(
      `SELECT state FROM ${RUNS_TABLE} WHERE correlation_id = $1`,
      [runId],
    );
    if (current.rows[0]?.state !== 'cancelled') {
      throw new Error(`agent_run_transition_conflict:${runId}:cancelled`);
    }
  }
  await pool.query(
    `UPDATE ag_catalog.agent_assignments
     SET state='cancelled', cancelled_at=NOW(), completed_at=NOW(), updated_at=NOW()
     WHERE correlation_id=$1`,
    [runId],
  );
  await observeAge(
    `MATCH (assignment:Assignment {correlationId: $correlationId})
     SET assignment.state='cancelled', assignment.completedAt=$observedAt,
         assignment.errorCode=$reason
     RETURN properties(assignment)`,
    { correlationId: runId, observedAt: new Date().toISOString(), reason },
  );
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
