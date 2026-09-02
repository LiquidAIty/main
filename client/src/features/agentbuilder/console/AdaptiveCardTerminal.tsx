import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardRuntime } from '../../../types/agentgraph';

import type { RuntimeEvent, RuntimeObservation, RuntimeConfiguration } from '../../../../../apps/backend/src/contracts/runtimeEvents';
export type CardTerminalEvent = RuntimeEvent;
export type CardTerminalObservation = RuntimeObservation;
export type TerminalRun = {
  runId?: string | null; cardId?: string | null; state?: string | null; status: string; output: string;
  error: string | null; terminal?: CardTerminalObservation | null; observationError?: string | null;
};

export function usesAdaptiveCardTerminal(kind: string | undefined, runtime: CardRuntime | undefined): boolean {
  if (kind !== 'agent' || !runtime) return false;
  if (runtime.kind === 'autogen') return runtime.mode === 'assistant' || runtime.mode === 'magentic_one';
  return runtime.kind === 'hermes' && runtime.mode !== 'main' && runtime.profile.toLowerCase() !== 'coder';
}

const PUBLIC_KINDS = new Set(['session', 'mission', 'model', 'tool_call', 'tool_result', 'tool_error',
  'child_started', 'child_finished', 'task', 'error', 'permission', 'skill', 'autoskill', 'artifact', 'completion']);
export function reconcileTerminalEvents(events: CardTerminalEvent[]): CardTerminalEvent[] {
  const byId = new Map<string, CardTerminalEvent>();
  for (const event of events) {
    if (event.id && PUBLIC_KINDS.has(event.kind)) {
      const key = [event.projectId, event.deckId, event.cardId, event.runId, event.taskId || '', event.agentId || '', event.id].join('\u0000');
      byId.set(key, event);
    }
  }
  // The adapter supplies source order. Replacing by stable ID updates partial
  // model text/tool state without appending a second copy on every status read.
  return [...byId.values()].sort((a, b) => {
    if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
    return a.sequence - b.sequence || a.id.localeCompare(b.id);
  });
}

export function reconcileCardTerminal(previous: CardTerminalObservation | null | undefined,
  next: CardTerminalObservation | null | undefined): CardTerminalObservation | null {
  if (!next) return null;
  if (!previous || previous.runId !== next.runId || previous.cardId !== next.cardId
    || previous.projectId !== next.projectId || previous.deckId !== next.deckId) return next;
  return { ...next, events: reconcileTerminalEvents([...previous.events, ...next.events]) };
}

export async function requestCardTranscript(args: {
  action: 'transcript' | 'delete_transcript'; projectId: string; deckId: string; cardId: string; runId: string;
}): Promise<{ events?: CardTerminalEvent[]; deleted?: boolean }> {
  const response = await fetch('/api/coder/mcp-bridge/run_configured_card', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) throw new Error(String(body?.detail || body?.error || 'card_transcript_failed'));
  if (body.result?.runId !== args.runId || body.result?.projectId !== args.projectId
    || body.result?.deckId !== args.deckId || body.result?.cardId !== args.cardId) {
    throw new Error('card_transcript_identity_mismatch');
  }
  if (args.action === 'transcript' && !Array.isArray(body.result?.events)) throw new Error('card_transcript_response_invalid');
  return body.result;
}

const preStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'break-word' as const,
  wordBreak: 'normal' as const,
  fontFamily: 'inherit',
};

function BoundedText({ text }: { text: string }) {
  const [visible, setVisible] = useState(4000);
  return <><pre style={preStyle}>{text.slice(0, visible)}</pre>
    {text.length > visible ? <button type="button" onClick={() => setVisible((value) => value + 4000)}>Show more output</button> : null}</>;
}

export function RuntimeConfigurationHeader({ configuration }: { configuration?: RuntimeConfiguration }) {
  if (!configuration) return null;
  return <div data-testid="runtime-configuration" style={{ display: 'grid', gap: 4 }}>
    <span>{[configuration.provider, configuration.model, configuration.profile].filter(Boolean).join(' · ')}</span>
    {configuration.grantedTools ? <details><summary>Run-granted tools ({configuration.grantedTools.length})</summary>
      <BoundedText text={configuration.grantedTools.join('\n')} /></details> : null}
    {configuration.loadedSkills ? <details><summary>Loaded skills ({configuration.loadedSkills.length})</summary>
      <BoundedText text={configuration.loadedSkills.join('\n')} /></details> : null}
  </div>;
}

function RuntimeEventRow({ event, conversationOnly }: { event: RuntimeEvent; conversationOnly: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (event.kind === 'model' || event.kind === 'mission') return <div data-event-id={event.id}>
    {event.taskId ? <small>{event.taskId} · {event.agentId || 'unattributed'}</small> : null}
    <BoundedText text={event.text || ''} />
  </div>;
  if ((event as RuntimeEvent & { category?: string }).category === 'execution.progress') {
    return <div data-event-id={event.id}>
      {event.taskId ? <small>{event.taskId} · {event.agentId || 'unattributed'}</small> : null}
      <BoundedText text={event.text || ''} />
    </div>;
  }
  const label = event.toolName ? event.toolName
    : ['child_started', 'child_finished'].includes(event.kind)
      ? `${event.nativeChildId || event.runId}`
      : event.kind;
  const status = event.kind === 'tool_call' || event.kind === 'child_started'
    ? 'started'
    : event.status || '';
  const summaryLabel = `${event.taskId ? `${event.taskId} · ` : ''}${label}`;
  return <details data-event-id={event.id} onToggle={(event) => setExpanded(event.currentTarget.open)}
    style={{ color: event.kind === 'tool_error' || event.status === 'failed' ? '#FFA2A2' : '#9FB2B8' }}>
    <summary style={{ cursor: 'pointer' }}>
      <span style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8,
        alignItems: 'center', minWidth: 0,
      }}>
        <span title={summaryLabel} style={{
          minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          overflowWrap: 'normal', wordBreak: 'normal',
        }}>{summaryLabel}</span>
        {status ? <span style={{ whiteSpace: 'nowrap', wordBreak: 'normal' }}>{status}</span> : null}
      </span>
    </summary>
    {expanded ? <>
      <div>{event.cardName} · {event.runId}{event.parentRunId ? ` · parent ${event.parentRunId}` : ''}</div>
      {event.agentId ? <div>Agent {event.agentId}</div> : null}
      {event.timestamp ? <time>{event.timestamp}</time> : null}
      {!conversationOnly && event.text ? <BoundedText text={event.text} /> : null}
      {event.detail ? <BoundedText text={event.detail} /> : null}
      {event.reference ? <BoundedText text={JSON.stringify(event.reference, null, 2)} /> : null}
    </> : null}
  </details>;
}

/** Shared pixels only: runtime adapters supply identity, order and public payloads. */
export function RuntimeEventList({ events, taskId = null, main = false }: {
  events: RuntimeEvent[]; taskId?: string | null; main?: boolean;
}) {
  const [visible, setVisible] = useState(100);
  const selected = reconcileTerminalEvents(events).filter((event) => (!taskId || event.taskId === taskId)
    && (!main || event.category?.startsWith('execution.')));
  return <div data-testid="runtime-event-list" style={{ display: 'grid', gap: 8 }}>
    {selected.length > visible ? <button type="button" onClick={() => setVisible((value) => value + 100)}>Show earlier events</button> : null}
    {selected.slice(-visible).map((event) => <RuntimeEventRow key={`${event.runId}:${event.taskId || ''}:${event.agentId || ''}:${event.id}`}
      event={event} conversationOnly={false} />)}
  </div>;
}

export default function AdaptiveCardTerminal(props: {
  enabled: boolean; projectId: string; deckId: string; cardId: string; runtime: CardRuntime;
  run: TerminalRun | null; busy: boolean; onStop?: () => void; onRejoin?: () => void;
  children: ReactNode;
}) {
  const { busy, runtime } = props;
  const run = (props.run?.cardId && props.run.cardId !== props.cardId)
    || (props.run?.terminal && (props.run.terminal.cardId !== props.cardId
      || props.run.terminal.projectId !== props.projectId || props.run.terminal.deckId !== props.deckId)) ? null : props.run;
  const runId = run?.runId || '';
  const [newInputFor, setNewInputFor] = useState<string | null>(null);
  const [history, setHistory] = useState<CardTerminalEvent[] | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [following, setFollowing] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selection = `${props.projectId}:${props.deckId}:${props.cardId}:${runId}`;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    setNewInputFor(null); setHistory(null); setShowTranscript(false);
    setHistoryBusy(false); setHistoryError(null); setDeleted(false); setDeleteConfirmed(false); setFollowing(true);
    setSelectedTaskId(null);
  }, [selection]);
  const state = run?.state || run?.status || '';
  const active = run ? state === 'pending' || state === 'running' : busy;
  const dormant = !active && (!run || !runId || newInputFor === runId);
  const events = reconcileTerminalEvents(history ?? run?.terminal?.events ?? []);
  useEffect(() => {
    if (following && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [run?.terminal?.events, history, following, showTranscript]);
  if (!props.enabled) return <>{props.children}</>;
  if (dormant) return <div data-testid="adaptive-card-dormant">
    {props.children}
    {runId ? <button type="button" onClick={() => setNewInputFor(null)}>Previous result</button> : null}
  </div>;

  const terminal = run?.terminal;
  const count = active && typeof terminal?.activeAgentCount === 'number' && Number.isSafeInteger(terminal.activeAgentCount)
    ? terminal.activeAgentCount : 0;
  const starting = active && (!run || state === 'pending');
  const finalText = terminal?.finalText || run?.output || '';
  const failure = terminal?.errorSummary || run?.error;
  const transcriptAvailable = Boolean(terminal?.transcript.sessionId && terminal.transcript.unavailableReason === null);
  const loadTranscript = async () => {
    setShowTranscript(true); setHistoryError(null);
    if (!transcriptAvailable || !runId || deleted) return;
    setHistoryBusy(true);
    try {
      const result = await requestCardTranscript({ action: 'transcript', projectId: props.projectId,
        deckId: props.deckId, cardId: props.cardId, runId });
      if (selectionRef.current === selection) setHistory(result.events || []);
    } catch (error) {
      if (selectionRef.current === selection) setHistoryError(error instanceof Error ? error.message : 'card_transcript_failed');
    } finally { if (selectionRef.current === selection) setHistoryBusy(false); }
  };
  const deleteTranscript = async () => {
    if (!deleteConfirmed) { setDeleteConfirmed(true); return; }
    setHistoryBusy(true); setHistoryError(null);
    try {
      const result = await requestCardTranscript({ action: 'delete_transcript', projectId: props.projectId,
        deckId: props.deckId, cardId: props.cardId, runId });
      if (selectionRef.current === selection) {
        if (!result.deleted) throw new Error('native_transcript_not_deleted');
        setHistory([]); setDeleted(true); setDeleteConfirmed(false);
      }
    } catch (error) {
      if (selectionRef.current === selection) setHistoryError(error instanceof Error ? error.message : 'card_transcript_delete_failed');
    } finally { if (selectionRef.current === selection) setHistoryBusy(false); }
  };
  return <section data-testid="adaptive-card-terminal" data-state={starting ? 'starting' : state}
    data-run-id={runId} data-card-id={props.cardId}
    style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8,
      background: '#171C1D', color: '#D9E4E8', fontSize: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span role="status">{starting ? 'Starting…' : active ? 'Running' : state}</span>
      {count > 0 ? <span data-testid="terminal-active-agents" aria-label={`${count} active agents`}>{count}</span> : null}
      {active && runtime.kind === 'hermes' && props.onStop
        ? <button type="button" onClick={props.onStop}>Stop</button> : null}
    </div>
    {runtime.kind === 'autogen' && runtime.mode === 'magentic_one' ? <div>Orchestrator · Magentic-One</div> : null}
    <RuntimeConfigurationHeader configuration={terminal?.configuration} />
    {!active && finalText ? <div data-testid="card-terminal-final"><BoundedText text={finalText} /></div> : null}
    {failure ? <div role="alert">{terminal?.errorCode ? `${terminal.errorCode}: ` : ''}{failure}</div> : null}
    {run?.observationError ? <div role="alert">{run.observationError}</div> : null}
    {terminal?.unavailableReason ? <div role="status">{terminal.unavailableReason === 'autogen_adapter_completion_only'
      ? 'This AutoGen adapter reports output at completion; live output is unavailable.'
      : terminal.unavailableReason}</div> : null}
    {active || showTranscript ? <>
      {terminal?.nativeTasks ? <label>Task <select aria-label="Terminal task filter" value={selectedTaskId || ''}
        onChange={(event) => setSelectedTaskId(event.target.value || null)}>
        <option value="">All tasks</option>
        {terminal.nativeTasks.map((task) => <option key={String(task.id)} value={String(task.id)}>{String(task.title || task.id)}</option>)}
      </select></label> : null}
      <div ref={scrollRef} data-testid="card-terminal-output" role="log" aria-live="polite"
        onScroll={() => {
          const view = scrollRef.current;
          if (view) setFollowing(view.scrollHeight - view.scrollTop - view.clientHeight < 32);
        }} style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 8 }}>
        <RuntimeEventList events={events} taskId={selectedTaskId} />
      </div>
      {!following ? <button type="button" onClick={() => setFollowing(true)}>Return to live</button> : null}
    </> : null}
    {!active ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" onClick={() => setNewInputFor(runId)}>New input</button>
      <button type="button" disabled={historyBusy} onClick={() => showTranscript ? setShowTranscript(false) : void loadTranscript()}>
        {showTranscript ? 'Hide transcript' : 'Show transcript'}
      </button>
      {showTranscript && transcriptAvailable && !deleted ? <button type="button" disabled={historyBusy}
        onClick={() => void deleteTranscript()}>{deleteConfirmed ? 'Confirm delete transcript' : 'Delete transcript'}</button> : null}
    </div> : null}
    {props.onRejoin && (run?.observationError || (active && terminal?.observation === 'unavailable' && runtime.kind === 'hermes'))
      ? <button type="button" onClick={props.onRejoin}>Reconnect to this Run</button> : null}
    {showTranscript && !transcriptAvailable ? <div role="status">Native transcript unavailable: {terminal?.transcript.unavailableReason || 'native_session_identity_unavailable'}</div> : null}
    {historyBusy ? <div role="status">Reading native transcript…</div> : null}
    {deleted ? <div role="status">Transcript deleted. The saved Run and final result are unchanged.</div> : null}
    {historyError ? <div role="alert">{historyError}</div> : null}
  </section>;
}
