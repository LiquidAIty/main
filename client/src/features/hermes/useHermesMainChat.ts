/**
 * Entity: Main Chat
 * Relationship: Opens or resumes Main's native Bot Chat session, renders Hermes history/events and reported authors, and maps Send, Stop, voice, and image gestures directly onto the generated Gateway contract.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApprovalChoice,
  ClarifyQuestion,
  SessionCreateResult,
  SessionHistoryResult,
  SessionListResult,
  SessionResumeResult,
  TranscriptMessage,
  VoiceRecordResult,
} from '../../../../HermesLatest/apps/shared/src/gateway-contract.generated';
import type { GatewayEvent } from '../../../../HermesLatest/apps/shared/src/gateway-events';
import type { ServerRequest } from '../../../../HermesLatest/apps/shared/src/json-rpc-channel';
import { randomUuid } from '../../../../HermesLatest/apps/shared/src/session-http-mutations';
import { hermesGateway } from './hermesHost';

type ComposerImage = {
  name: string;
  mediaType: string;
  dataUrl: string;
  kind: 'user-upload';
};

export type HermesChatMessage = {
  role: string;
  text: string;
  speaker?: string;
  linkedEvidenceIds?: string[];
  status?: 'pending' | 'complete' | 'error';
  rowId?: number;
};

export type HermesChatRequest = {
  id: string;
  kind: 'approval' | 'clarify';
  command?: string;
  description?: string;
  choices?: ApprovalChoice[];
  questions?: ClarifyQuestion[];
};

type VoicePhase = 'idle' | 'requesting' | 'listening' | 'processing' | 'speaking' | 'error';
export const HERMES_MAIN_SESSION_TITLE = 'Bot Chat';
// Hermes Bot Mode persists an inbound teammate delivery as a user-role
// internal_notification so the recipient model can answer it. The exact
// transport prefix is the same contract Hermes Desktop renders as an
// inter-agent notice; it is not the human speaking.
const HERMES_AGENT_MESSAGE_RE =
  /^(?:Message from (?:🤖\s*)?([^:\n(]{1,64}?)(?:\s*\(@([a-z0-9][a-z0-9_-]{0,63})(?:@[a-zA-Z0-9][a-zA-Z0-9_-]{0,63})?\))?:\s*|\[Message from agent '([^']{1,64})'\]\s*)([\s\S]*)$/u;

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function transcriptMessage(row: TranscriptMessage): HermesChatMessage | null {
  const metadata = objectRecord(row.display_metadata);
  const author = objectRecord(metadata.turn_author || row.turn_author);
  const botAuthored = author.is_bot === true;
  const displayKind = text(row.display_kind).trim().toLowerCase();
  const displayText = text(metadata.display_text);
  const body = displayText || text(row.text ?? row.content);
  if (!body.trim() || displayKind === 'hidden' || displayKind === 'process_complete') return null;
  if (displayKind === 'internal_notification') {
    const delivery = HERMES_AGENT_MESSAGE_RE.exec(body);
    if (!delivery) return null;
    return {
      role: 'assistant',
      text: text(delivery[4]),
      speaker: text(delivery[1] || delivery[3] || delivery[2]) || 'Agent',
      status: 'complete',
      rowId: typeof row.row_id === 'number' ? row.row_id : undefined,
    };
  }
  const role = botAuthored ? 'assistant' : text(row.role).trim().toLowerCase();
  if (role !== 'user' && role !== 'assistant') return null;
  return {
    role,
    text: body,
    speaker: botAuthored
      ? text(author.name || author.id)
      : role === 'assistant' ? 'Main' : 'You',
    status: row.display_kind === 'failed_turn' ? 'error' : 'complete',
    rowId: typeof row.row_id === 'number' ? row.row_id : undefined,
    linkedEvidenceIds: Array.isArray(metadata.linkedEvidenceIds)
      ? metadata.linkedEvidenceIds.filter((value): value is string => typeof value === 'string')
      : undefined,
  };
}

function historyMessages(rows: TranscriptMessage[]): HermesChatMessage[] {
  return rows.flatMap((row) => {
    const mapped = transcriptMessage(row);
    return mapped ? [mapped] : [];
  });
}

function base64(dataUrl: string): string {
  const marker = dataUrl.indexOf(',');
  return marker >= 0 ? dataUrl.slice(marker + 1) : dataUrl;
}

export default function useHermesMainChat(projectId: string) {
  const profile = 'main';
  const generationRef = useRef(0);
  const sessionRef = useRef('');
  const streamingIndexRef = useRef<number | null>(null);
  const visibleTurnRef = useRef(true);
  const deltaCursorRef = useRef({ turnId: '', segment: -1, offset: 0 });
  const pendingVoiceRef = useRef<{ draft: string; images: ComposerImage[] } | null>(null);
  const resumePromiseRef = useRef<Promise<void> | null>(null);
  const serverRequestsRef = useRef(new Map<string, ServerRequest>());
  const [messages, setMessages] = useState<HermesChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [pendingRequests, setPendingRequests] = useState<HermesChatRequest[]>([]);

  const removePendingRequest = useCallback((id: string) => {
    serverRequestsRef.current.delete(id);
    setPendingRequests((current) => current.filter((request) => request.id !== id));
  }, []);

  const answerApproval = useCallback((id: string, choice: ApprovalChoice) => {
    const request = serverRequestsRef.current.get(id);
    if (!request || request.method !== 'approval') return false;
    request.respond({ choice });
    removePendingRequest(id);
    return true;
  }, [removePendingRequest]);

  const answerClarify = useCallback((id: string, answers: Record<string, string | null>) => {
    const request = serverRequestsRef.current.get(id);
    if (!request || request.method !== 'clarify') return false;
    request.respond({ answers, outcome: 'submitted' });
    removePendingRequest(id);
    return true;
  }, [removePendingRequest]);

  const cancelRequest = useCallback((id: string) => {
    const request = serverRequestsRef.current.get(id);
    if (!request) return false;
    if (request.method === 'approval') request.respond({ choice: 'deny' });
    else if (request.method === 'clarify') request.respond({ outcome: 'cancelled' });
    else return false;
    removePendingRequest(id);
    return true;
  }, [removePendingRequest]);

  const appendAssistantDelta = useCallback((value: string) => {
    if (!value) return;
    setMessages((current) => {
      const index = streamingIndexRef.current;
      if (index != null && current[index]?.role === 'assistant') {
        const next = [...current];
        next[index] = { ...next[index], text: next[index].text + value, status: 'pending' };
        return next;
      }
      const next = [...current, { role: 'assistant', text: value, status: 'pending' as const }];
      streamingIndexRef.current = next.length - 1;
      return next;
    });
  }, []);

  useEffect(() => {
    const project = String(projectId || '').trim();
    generationRef.current += 1;
    const generation = generationRef.current;
    sessionRef.current = '';
    streamingIndexRef.current = null;
    visibleTurnRef.current = true;
    deltaCursorRef.current = { turnId: '', segment: -1, offset: 0 };
    pendingVoiceRef.current = null;
    resumePromiseRef.current = null;
    serverRequestsRef.current.clear();
    setPendingRequests([]);
    setMessages([]);
    setBusy(false);
    setError(null);
    setVoiceError(null);
    setVoicePhase('idle');
    if (!project) {
      setHistoryLoading(false);
      return;
    }
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    setHistoryLoading(true);
    void hermesGateway(profile).then(async (gateway) => {
      if (disposed || generationRef.current !== generation) return;
      const belongs = (event: GatewayEvent) => (
        Boolean(sessionRef.current) && event.session_id === sessionRef.current
      );
      const refreshHistory = async (): Promise<void> => {
        const sessionId = sessionRef.current;
        if (!sessionId) return;
        const history = await gateway.request<SessionHistoryResult>('session.history', {
          session_id: sessionId,
          profile,
        });
        if (
          disposed
          || generationRef.current !== generation
          || sessionRef.current !== sessionId
        ) return;
        setMessages(historyMessages(history.messages));
      };
      const resumeAfterReconnect = (sessionId: string): Promise<void> => {
        const pending = gateway.request<SessionResumeResult>('session.resume', {
          session_id: sessionId,
          profile,
          source: 'gui',
        }).then((opened) => {
          if (
            disposed
            || generationRef.current !== generation
            || sessionRef.current !== sessionId
          ) return;
          sessionRef.current = opened.session_id;
          setMessages(historyMessages(opened.messages));
          setBusy(opened.running === true);
          setError(null);
        });
        const tracked = pending.finally(() => {
          if (resumePromiseRef.current === tracked) resumePromiseRef.current = null;
        });
        resumePromiseRef.current = tracked;
        return tracked;
      };
      unsubscribers.push(gateway.onState((state) => {
        const sessionId = sessionRef.current;
        if (state !== 'open' || !sessionId || resumePromiseRef.current) return;
        void resumeAfterReconnect(sessionId).catch((cause) => {
          if (!disposed && generationRef.current === generation) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
      }));
      unsubscribers.push(gateway.onRequest((request) => {
        const requestSession = typeof request.params.session_id === 'string'
          ? request.params.session_id : '';
        if (!sessionRef.current || requestSession !== sessionRef.current) return false;
        if (request.method === 'approval') {
          const allowed = new Set<ApprovalChoice>(['once', 'session', 'always', 'deny']);
          const choices = Array.isArray(request.params.choices)
            ? request.params.choices.filter((choice): choice is ApprovalChoice => (
              typeof choice === 'string' && allowed.has(choice as ApprovalChoice)
            ))
            : ['once', 'deny'] as ApprovalChoice[];
          serverRequestsRef.current.set(request.id, request);
          setPendingRequests((current) => current.some((item) => item.id === request.id)
            ? current
            : [...current, {
                id: request.id,
                kind: 'approval',
                command: text(request.params.command),
                description: text(request.params.description),
                choices,
              }]);
          return true;
        }
        if (request.method === 'clarify') {
          const questions = Array.isArray(request.params.questions)
            ? request.params.questions.filter((question): question is ClarifyQuestion => (
              Boolean(question) && typeof question === 'object'
              && typeof (question as ClarifyQuestion).qid === 'string'
              && typeof (question as ClarifyQuestion).question === 'string'
            ))
            : [];
          if (!questions.length) return false;
          serverRequestsRef.current.set(request.id, request);
          setPendingRequests((current) => current.some((item) => item.id === request.id)
            ? current
            : [...current, { id: request.id, kind: 'clarify', questions }]);
          return true;
        }
        return false;
      }));
      unsubscribers.push(gateway.on('message.start', (event) => {
        if (!belongs(event)) return;
        const displayKind = text(event.payload?.display_kind).trim().toLowerCase();
        visibleTurnRef.current = displayKind !== 'hidden' && displayKind !== 'process_complete';
        if (!visibleTurnRef.current) return;
        streamingIndexRef.current = null;
        deltaCursorRef.current = { turnId: '', segment: -1, offset: 0 };
        setBusy(true);
      }));
      unsubscribers.push(gateway.on('message.delta', (event) => {
        if (!belongs(event) || !visibleTurnRef.current) return;
        let chunk = text(event.payload?.text);
        const turnId = text(event.payload?.turn_id);
        const segment = typeof event.payload?.segment === 'number'
          ? event.payload.segment
          : 0;
        const offset = typeof event.payload?.offset === 'number'
          ? event.payload.offset
          : null;
        if (turnId && offset !== null && Number.isSafeInteger(offset) && offset >= 0) {
          const chunkEnd = offset + chunk.length;
          const cursor = deltaCursorRef.current;
          if (cursor.turnId !== turnId || cursor.segment !== segment) {
            deltaCursorRef.current = { turnId, segment, offset: 0 };
          }
          const current = deltaCursorRef.current;
          if (offset > current.offset) {
            void refreshHistory().catch(() => undefined);
            return;
          }
          if (chunkEnd <= current.offset) return;
          if (offset < current.offset) chunk = chunk.slice(current.offset - offset);
          current.offset = chunkEnd;
        }
        appendAssistantDelta(chunk);
      }));
      unsubscribers.push(gateway.on('message.interim', (event) => {
        if (!belongs(event) || !visibleTurnRef.current || event.payload?.already_streamed) return;
        appendAssistantDelta(text(event.payload?.text));
      }));
      unsubscribers.push(gateway.on('message.complete', (event) => {
        if (!belongs(event)) return;
        if (!visibleTurnRef.current) {
          visibleTurnRef.current = true;
          streamingIndexRef.current = null;
          deltaCursorRef.current = { turnId: '', segment: -1, offset: 0 };
          void refreshHistory().catch(() => undefined);
          return;
        }
        const finalText = text(event.payload?.text);
        const failed = event.payload?.status === 'error' || event.payload?.status === 'interrupted';
        setMessages((current) => {
          const index = streamingIndexRef.current;
          if (index != null && current[index]?.role === 'assistant') {
            const next = [...current];
            next[index] = {
              ...next[index],
              text: finalText || next[index].text,
              status: failed ? 'error' : 'complete',
            };
            return next;
          }
          return current;
        });
        streamingIndexRef.current = null;
        deltaCursorRef.current = { turnId: '', segment: -1, offset: 0 };
        setBusy(false);
        if (failed) setError(text(event.payload?.error || event.payload?.warning || 'Hermes turn did not complete.'));
        void refreshHistory().catch((cause) => {
          if (!disposed && generationRef.current === generation) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
      }));
      unsubscribers.push(gateway.on('session.replay_gap', (event) => {
        if (!belongs(event)) return;
        void refreshHistory().catch((cause) => {
          if (!disposed && generationRef.current === generation) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
      }));
      unsubscribers.push(gateway.on('voice.status', (event) => {
        if (!belongs(event)) return;
        const state = text(event.payload?.state).toLowerCase();
        setVoicePhase(state === 'listening' || state === 'recording' ? 'listening'
          : state === 'transcribing' || state === 'processing' ? 'processing'
            : state === 'speaking' ? 'speaking' : 'idle');
      }));
      unsubscribers.push(gateway.on('voice.transcript', (event) => {
        if (!belongs(event)) return;
        const pending = pendingVoiceRef.current;
        pendingVoiceRef.current = null;
        setVoicePhase('idle');
        if (event.payload?.stop_phrase || !pending) return;
        const spoken = text(event.payload?.text).trim();
        const literal = [pending.draft.trim(), spoken].filter(Boolean).join('\n');
        if (!literal) return;
        const submissionId = randomUuid();
        void (async () => {
          if (resumePromiseRef.current) await resumePromiseRef.current;
          for (const image of pending.images) {
            await gateway.request('image.attach_bytes', {
              session_id: sessionRef.current, profile,
              content_base64: base64(image.dataUrl), filename: image.name,
            });
          }
          await gateway.request('prompt.submit', {
            session_id: sessionRef.current,
            profile,
            submission_id: submissionId,
            text: literal,
            voice_turn: true,
          });
          setMessages((current) => [...current, {
            role: 'user', text: literal, speaker: 'You', status: 'complete',
          }]);
          setBusy(true);
        })().catch((cause) => {
          setVoicePhase('error');
          setVoiceError(cause instanceof Error ? cause.message : String(cause));
        });
      }));

      const listed = await gateway.request<SessionListResult>('session.list', {
        profile, title: HERMES_MAIN_SESSION_TITLE, limit: 10, include_hidden: false,
      });
      if (disposed || generationRef.current !== generation) return;
      const existing = listed.sessions[0];
      let opened: SessionResumeResult | SessionCreateResult;
      if (existing) {
        opened = await gateway.request<SessionResumeResult>('session.resume', {
          session_id: existing.resolved_id || existing.id,
          profile,
          source: 'gui',
        });
      } else {
        opened = await gateway.request<SessionCreateResult>('session.create', {
          profile,
          request_id: randomUuid(),
          source: 'gui',
          title: HERMES_MAIN_SESSION_TITLE,
          hidden: true,
          follow_profile_config: true,
        });
      }
      if (disposed || generationRef.current !== generation) return;
      sessionRef.current = opened.session_id;
      setMessages(historyMessages(opened.messages));
      setHistoryLoading(false);
      if ('running' in opened && opened.running) setBusy(true);
    }).catch((cause) => {
      if (disposed || generationRef.current !== generation) return;
      setHistoryLoading(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [appendAssistantDelta, projectId]);

  const send = useCallback(async (literal: string, input?: { images?: ComposerImage[] }) => {
    const body = String(literal || '');
    if (!body.trim() || !sessionRef.current) return false;
    try {
      const submissionId = randomUuid();
      const gateway = await hermesGateway(profile);
      if (resumePromiseRef.current) await resumePromiseRef.current;
      for (const image of input?.images || []) {
        await gateway.request('image.attach_bytes', {
          session_id: sessionRef.current, profile,
          content_base64: base64(image.dataUrl), filename: image.name,
        });
      }
      await gateway.request('prompt.submit', {
        session_id: sessionRef.current,
        profile,
        submission_id: submissionId,
        text: body,
      });
      setMessages((current) => [...current, {
        role: 'user', text: body, speaker: 'You', status: 'complete',
      }]);
      setBusy(true);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    if (!sessionRef.current) return;
    void hermesGateway(profile).then((gateway) => gateway.request('session.interrupt', {
      session_id: sessionRef.current, profile,
    })).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const startVoice = useCallback(async (draft: string, input: { images?: ComposerImage[] }) => {
    if (!sessionRef.current) return false;
    setVoiceError(null);
    setVoicePhase('requesting');
    pendingVoiceRef.current = { draft, images: input.images || [] };
    try {
      const gateway = await hermesGateway(profile);
      if (resumePromiseRef.current) await resumePromiseRef.current;
      const result = await gateway.request<VoiceRecordResult>('voice.record', {
        action: 'start', session_id: sessionRef.current, profile,
      });
      if (result.status !== 'recording') throw new Error(result.reason || 'Hermes microphone is busy.');
      setVoicePhase('listening');
      return true;
    } catch (cause) {
      pendingVoiceRef.current = null;
      setVoicePhase('error');
      setVoiceError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, []);

  const stopVoice = useCallback(() => {
    if (!sessionRef.current) return;
    void hermesGateway(profile).then((gateway) => gateway.request('voice.record', {
      action: 'stop', session_id: sessionRef.current, profile,
    })).catch((cause) => {
      setVoicePhase('error');
      setVoiceError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  return {
    messages, busy, historyLoading, error, voiceError, voicePhase,
    pendingRequest: pendingRequests[0] || null,
    answerApproval, answerClarify, cancelRequest,
    send, stop, startVoice, stopVoice,
  };
}
