/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Main Chat
 * Relationship: This file transports full Project conversations to Engraphis and starts the bounded ThinkGraph handoff only after a new completed reply commits.
 * Entity: Projects
 * Relationship: This file resolves each conversation against the canonical Project identity and keeps message ordering isolated within that Project conversation.
 */
// Runtime histories remain owned by their exact saved Card sessions.
// This store persists Main's application conversation: user-authored turns and
// completed provider replies with truthful Card speaker identity. Python remains
// the sole owner of saved Card Runs and their IDFs.
import { pool } from '../db/pool';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { submitSavedThinkPair } from './thinkGraphHandoff';

const PROJECTS_TABLE = 'ag_catalog.projects';
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

export type ConversationParticipant = {
  kind: 'user' | 'card';
  label: string;
  cardId?: string;
  profile?: string;
  address?: string;
};

export type ConversationMessageWrite = {
  messageId?: string;
  role: 'user' | 'assistant';
  content: string;
  speaker: ConversationParticipant;
  target?: ConversationParticipant;
  status?: Extract<ConversationMessageStatus, 'pending' | 'complete' | 'error'>;
  providerContinuationRef?: string | null;
  providerMessageId?: string | null;
  linkedEvidenceIds?: string[];
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

async function storage(action: string, input: { projectId: string; conversationId: string; [key: string]: unknown }): Promise<unknown> {
  const { projectId, ...arguments_ } = input;
  const project = await pool.query(
    `SELECT id FROM ${PROJECTS_TABLE} WHERE ${UUID_REGEX.test(projectId) ? 'id' : 'code'} = $1 LIMIT 1`,
    [projectId],
  );
  if (!project.rows.length) throw new Error('project_not_found');
  return requestPythonRailsJson('/thinkgraph/operation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: String(project.rows[0].id), operation: 'conversation',
      arguments: { action, ...arguments_ } }),
  });
}

export async function appendConversationTurn(input: {
  projectId: string;
  conversationId: string;
  seedMessages?: ConversationMessageWrite[];
  messages: ConversationMessageWrite[];
}): Promise<ConversationMessage[]> {
  return await storage('append', input) as ConversationMessage[];
}

export async function appendConversationReplyOnce(input: {
  projectId: string;
  conversationId: string;
  message: ConversationMessageWrite & { role: 'assistant'; providerMessageId: string };
}): Promise<{ inserted: boolean; message: ConversationMessage }> {
  const saved = await storage('reply', input) as { inserted: boolean; message: ConversationMessage };
  if (saved.inserted && saved.message.status === 'complete'
    && (input.message.status === undefined || input.message.status === 'complete')) {
    void submitSavedThinkPair(saved.message).catch(error => {
      console.error('[thinkgraph]', { messageId: saved.message.messageId,
        error: error instanceof Error ? error.message : 'submission_failed' });
    });
  }
  return saved;
}

export async function settleConversationMessage(input: {
  projectId: string;
  conversationId: string;
  messageId: string;
  providerMessageId: string;
  status: Extract<ConversationMessageStatus, 'complete' | 'error'>;
}): Promise<ConversationMessage> {
  return await storage('settle', input) as ConversationMessage;
}

export async function getConversationMessages(projectId: string, conversationId: string): Promise<ConversationMessage[]> {
  return await storage('read', { projectId, conversationId }) as ConversationMessage[];
}
