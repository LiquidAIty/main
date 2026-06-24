/**
 * Frontend client for the persistent OpenClaude QueryEngine session bridge
 * (`/api/coder/openclaude/session/*`). The browser never speaks gRPC — it talks
 * to the backend SSE endpoint, which bridges to the gRPC QueryEngine.
 *
 * `streamSession` forwards the RAW native event stream (verbatim) to `onEvent`
 * and resolves with `done.full_text`. No transformation, no curation.
 */

export type NativeSessionEvent = {
  kind: 'session' | 'text' | 'tool_start' | 'tool_result' | 'permission' | 'done' | 'error' | 'end' | string;
  [key: string]: unknown;
};

export type StoredConversationMessage = {
  messageId: string;
  projectId: string;
  conversationId: string;
  parentMessageId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'question' | 'answer';
  content: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  createdAt: string;
  linkedPlanDraftId?: string | null;
  linkedPlanStepId?: string | null;
  visibleActivities?: Array<{ kind: string; label: string; status?: string; detail?: string; ref?: string }>;
  seq: number;
};

const BASE = '/api/coder/openclaude/session';
const CONV_BASE = '/api/coder/openclaude';

/** Durable per-tab runtime id (sessionStorage): preserved across refresh in the
 *  SAME tab, distinct in another tab — keeps live Harness/MCP sessions isolated. */
export function getTabRuntimeId(): string {
  try {
    const KEY = 'liquidaity_tab_runtime_id';
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = `tab_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `tab_${Math.random().toString(36).slice(2)}`;
  }
}

/** Load the most-recent saved conversation for a project (durable history). */
export async function loadProjectConversation(
  projectId: string,
): Promise<{ conversationId: string | null; messages: StoredConversationMessage[] }> {
  const listRes = await fetch(`${CONV_BASE}/conversation/list?projectId=${encodeURIComponent(projectId)}`, {
    credentials: 'include',
  });
  const listJson = (await listRes.json().catch(() => ({}))) as { mostRecentConversationId?: string | null };
  const conversationId = listJson.mostRecentConversationId ?? null;
  if (!conversationId) return { conversationId: null, messages: [] };
  const msgRes = await fetch(
    `${CONV_BASE}/conversation/messages?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`,
    { credentials: 'include' },
  );
  const msgJson = (await msgRes.json().catch(() => ({}))) as { messages?: StoredConversationMessage[] };
  return { conversationId, messages: Array.isArray(msgJson.messages) ? msgJson.messages : [] };
}

export async function streamSession(args: {
  projectId: string;
  conversationId: string;
  message: string;
  deckId?: string;
  tabRuntimeId?: string;
  parentMessageId?: string | null;
  runtimeFresh?: boolean;
  onEvent: (event: NativeSessionEvent) => void;
  signal?: AbortSignal;
}): Promise<{ finalText: string }> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      conversationId: args.conversationId,
      message: args.message,
      ...(args.deckId ? { deckId: args.deckId } : {}),
      ...(args.tabRuntimeId ? { tabRuntimeId: args.tabRuntimeId } : {}),
      ...(args.parentMessageId ? { parentMessageId: args.parentMessageId } : {}),
      ...(args.runtimeFresh ? { runtimeFresh: true } : {}),
    }),
    signal: args.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`session_chat_failed_${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const evMatch = /^event: (.*)$/m.exec(frame);
      const dataMatch = /^data: ([\s\S]*)$/m.exec(frame);
      const kind = evMatch?.[1];
      if (!kind) continue;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(dataMatch?.[1] || '{}');
      } catch {
        /* keep empty */
      }
      if (kind === 'done') finalText = String((data as { fullText?: string }).fullText ?? finalText);
      args.onEvent({ ...data, kind });
    }
  }
  return { finalText };
}

export async function answerSession(args: {
  projectId: string;
  conversationId: string;
  promptId: string;
  reply: string;
  tabRuntimeId?: string;
}): Promise<boolean> {
  const res = await fetch(`${BASE}/answer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean((payload as { ok?: boolean }).ok);
}
