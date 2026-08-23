import React, { useState } from 'react';

import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
} from '../../components/graph/graphVisualTokens';
import type { KanbanShow, KanbanTask } from './types';
import { KANBAN_STATUS_LABELS } from './types';

export type TaskTabActions = {
  busy: (key: string) => boolean;
  onEdit: (result: string, summary?: string) => void;
  onBlock: (reason: string) => void;
  onUnblock: (reason?: string) => void;
  onPromote: () => void;
  onComplete: (result?: string) => void;
  onArchive: () => void;
  onComment: (text: string) => void;
  onAssign: (assignee: string) => void;
  onLink: (parent: string) => void;
  onUnlink: (parent: string) => void;
  onOpenWorker: (runId: string) => void;
  onReclaim: () => void;
  onTerminateRun: (runId: string) => void;
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ margin: '0 0 14px' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: GRAPH_THEME.surface.text,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '0 0 8px' }}>
      <div
        style={{
          fontSize: 11,
          color: GRAPH_THEME.surface.mutedText,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function fmtEpoch(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtElapsed(startedAt: number | null | undefined): string {
  if (!startedAt) return '—';
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - startedAt);
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function TaskTab({
  task,
  statusLabel,
  actions,
  assignees,
}: {
  task: KanbanTask;
  statusLabel: string;
  actions: TaskTabActions;
  assignees: string[];
}) {
  const [result, setResult] = useState('');
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [assignee, setAssignee] = useState(task.assignee || '');
  const isDone = task.status === 'done';
  const isBlocked = task.status === 'blocked' || task.status === 'scheduled';
  return (
    <div>
      <Section title="Task">
        <Field label="ID">
          <span data-testid="hermes-kanban-task-id" style={{ fontSize: 11, color: '#7DE0DA', fontFamily: 'ui-monospace, monospace' }}>
            {task.id}
          </span>
        </Field>
        <Field label="Status">
          <span data-testid="hermes-kanban-task-status" style={{ fontSize: 12, color: GRAPH_THEME.surface.text, fontWeight: 700 }}>
            {statusLabel}
          </span>
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label="Priority">
            <span style={{ fontSize: 12, color: GRAPH_THEME.surface.text }}>
              {task.priority ?? 0}
            </span>
          </Field>
          <Field label="Created">
            <span style={{ fontSize: 11, color: GRAPH_THEME.surface.mutedText }}>
              {fmtEpoch(task.created_at)}
            </span>
          </Field>
        </div>
        {/* ------------ Actions ------------ */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
          {isBlocked ? (
            <button
              type="button"
              data-testid="hermes-kanban-task-unblock"
              disabled={actions.busy('unblock')}
              onClick={() => actions.onUnblock(reason.trim() || undefined)}
              style={graphDrawerButtonStyle({ color: '#63D8A0', borderColor: 'rgba(99,216,160,0.42)' })}
            >
              Unblock
            </button>
          ) : (
            <button
              type="button"
              data-testid="hermes-kanban-task-block"
              disabled={actions.busy('block') || isDone}
              onClick={() => actions.onBlock(reason.trim())}
              style={graphDrawerButtonStyle({ color: '#E06C6C', borderColor: 'rgba(224,108,108,0.42)' })}
            >
              Block
            </button>
          )}
          <button
            type="button"
            data-testid="hermes-kanban-task-promote"
            disabled={actions.busy('promote') || isDone}
            title="Move to ready (native promote)"
            onClick={actions.onPromote}
            style={graphDrawerButtonStyle({ color: '#F2A64A', borderColor: 'rgba(242,166,74,0.42)' })}
          >
            Promote
          </button>
          <button
            type="button"
            data-testid="hermes-kanban-task-complete"
            disabled={actions.busy('complete') || isDone}
            onClick={() => actions.onComplete()}
            style={graphDrawerButtonStyle({ color: '#63D8A0', borderColor: 'rgba(99,216,160,0.42)' })}
          >
            Complete
          </button>
          <button
            type="button"
            data-testid="hermes-kanban-task-archive"
            disabled={actions.busy('archive')}
            onClick={actions.onArchive}
            style={graphDrawerButtonStyle({
              color: '#A7B0BA',
              borderColor: 'rgba(167,176,186,0.35)',
              background: 'rgba(167,176,186,0.06)',
            })}
          >
            Archive
          </button>
        </div>
        {!isDone ? (
          <div style={{ marginTop: 8 }}>
            <input
              data-testid="hermes-kanban-task-block-reason"
              placeholder="reason / note (block or unblock)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={graphDrawerInputStyle()}
            />
          </div>
        ) : null}
      </Section>

      <Section title="Title / Body">
        <Field label="Title">
          <div data-testid="hermes-kanban-task-title" style={{ fontSize: 13, fontWeight: 800, color: GRAPH_THEME.surface.text, lineHeight: 1.4 }}>
            {task.title || '(untitled)'}
          </div>
        </Field>
        <Field label="Body">
          <pre
            data-testid="hermes-kanban-task-body"
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.5,
              color: GRAPH_THEME.surface.text,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
              overflowY: 'auto',
              background: 'rgba(11,14,18,0.5)',
              border: '1px solid rgba(126,232,226,0.12)',
              borderRadius: 8,
              padding: '8px 9px',
            }}
          >
            {(task.body || '').trim() || '(no body)'}
          </pre>
        </Field>
      </Section>

      <Section title="Assignment">
        <Field label="Assignee">
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input
              data-testid="hermes-kanban-task-assignee"
              list="hermes-kanban-assignee-list"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              style={{ ...graphDrawerInputStyle(), flex: 1 }}
            />
            <datalist id="hermes-kanban-assignee-list">
              {assignees.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <button
              type="button"
              data-testid="hermes-kanban-task-assign"
              disabled={actions.busy('assign') || !assignee.trim()}
              onClick={() => actions.onAssign(assignee.trim())}
              style={graphDrawerButtonStyle({ color: '#7DE0DA' })}
            >
              Assign
            </button>
          </div>
        </Field>
        <Field label="Workspace">
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace' }}>
            {task.workspace_path || task.workspace_kind || '—'}
          </div>
        </Field>
        <Field label="Model / Provider override">
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>
            {task.model_override ? `${task.model_override}` : '—'}
            {task.provider_override ? ` (${task.provider_override})` : ''}
          </div>
        </Field>
      </Section>

      <Section title="Comment">
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input
            data-testid="hermes-kanban-task-comment-input"
            placeholder="Append a comment…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ ...graphDrawerInputStyle(), flex: 1 }}
          />
          <button
            type="button"
            data-testid="hermes-kanban-task-comment"
            disabled={actions.busy('comment') || !comment.trim()}
            onClick={() => actions.onComment(comment.trim())}
            style={graphDrawerButtonStyle({ color: '#7DE0DA' })}
          >
            Comment
          </button>
        </div>
      </Section>

      {isDone ? (
        <Section title="Edit Result (native edit)">
          <Field label="Result">
            <textarea
              data-testid="hermes-kanban-task-edit-result"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={3}
              placeholder="Backfilled result text"
              style={{ ...graphDrawerInputStyle(), resize: 'vertical' }}
            />
          </Field>
          <Field label="Summary (optional)">
            <input
              data-testid="hermes-kanban-task-edit-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              style={graphDrawerInputStyle()}
            />
          </Field>
          <button
            type="button"
            data-testid="hermes-kanban-task-edit"
            disabled={actions.busy('edit') || !result.trim()}
            onClick={() => actions.onEdit(result.trim(), summary.trim() || undefined)}
            style={graphDrawerButtonStyle({ color: '#F2A64A', borderColor: 'rgba(242,166,74,0.42)' })}
          >
            Save result
          </button>
        </Section>
      ) : null}
    </div>
  );
}

export function DependenciesTab({
  taskShow,
  actions,
}: {
  taskShow: KanbanShow;
  actions: TaskTabActions;
}) {
  const [parentId, setParentId] = useState('');
  return (
    <div>
      <Section title="Parents">
        {taskShow.parents.length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No parents.</div>
        ) : (
          taskShow.parents.map((p) => (
            <div
              key={p}
              data-testid="hermes-kanban-dependency-parent"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                fontSize: 11,
                color: GRAPH_THEME.surface.text,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {p}
              <button
                type="button"
                data-testid={`hermes-kanban-dependency-unlink-${p}`}
                disabled={actions.busy(`unlink:${p}`)}
                onClick={() => actions.onUnlink(p)}
                style={graphDrawerButtonStyle({ padding: '2px 6px', minWidth: 0, color: '#E06C6C' })}
              >
                unlink
              </button>
            </div>
          ))
        )}
      </Section>
      <Section title="Children">
        {taskShow.children.length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No children.</div>
        ) : (
          taskShow.children.map((c) => (
            <div key={c} data-testid="hermes-kanban-dependency-child" style={{ fontSize: 11, color: GRAPH_THEME.surface.text, fontFamily: 'ui-monospace, monospace', padding: '3px 6px' }}>
              {c}
            </div>
          ))
        )}
      </Section>
      <Section title="Link parent">
        <Field label="Parent task id">
          <div style={{ display: 'flex', gap: 5 }}>
            <input
              data-testid="hermes-kanban-dependency-link-input"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              placeholder="t_xxxx"
              style={{ ...graphDrawerInputStyle(), flex: 1 }}
            />
            <button
              type="button"
              data-testid="hermes-kanban-dependency-link"
              disabled={actions.busy('link') || !parentId.trim()}
              onClick={() => actions.onLink(parentId.trim())}
              style={graphDrawerButtonStyle({ color: '#7DE0DA' })}
            >
              Link
            </button>
          </div>
        </Field>
        <div style={{ fontSize: 9, color: GRAPH_THEME.surface.mutedText, lineHeight: 1.4 }}>
          Adds a parent→child dependency. Scheduled/blocked queues are managed
          by the native board.
        </div>
      </Section>
    </div>
  );
}

export function ActivityTab({
  taskShow,
  currentWorkerLabel,
  actions,
}: {
  taskShow: KanbanShow;
  currentWorkerLabel: string | null;
  actions: TaskTabActions;
}) {
  const running = taskShow.runs.filter((run) => run.ended_at == null && taskShow.task.status === 'running');
  return (
    <div>
      <Section title="Worker / Session">
        {running.length > 0 ? (
          running.map((run, i) => {
            const runId = String(run.run_id || run.id || '');
            return (
              <div
                key={runId || i}
                style={{ margin: '0 0 6px', padding: '7px 9px', borderRadius: 8, border: '1px solid rgba(242,166,74,0.4)', background: 'rgba(242,166,74,0.08)' }}
              >
                <button
                  type="button"
                  data-testid={`hermes-kanban-activity-run-${runId || i}`}
                  onClick={() => actions.onOpenWorker(runId)}
                  style={{ width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: GRAPH_THEME.surface.text, fontSize: 11, cursor: 'pointer' }}
                >
                  <div style={{ fontWeight: 800 }}>{runId || 'worker'}</div>
                  <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, marginTop: 2 }}>
                    started {fmtEpoch(Number(run.started_at ?? 0) || null)} · elapsed {fmtElapsed(Number(run.started_at ?? 0) || null)}
                    {run.profile ? ` · ${String(run.profile)}` : ''}
                  </div>
                  <div style={{ fontSize: 9, color: '#F2A64A', marginTop: 3 }}>Open worker inspector →</div>
                </button>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    disabled={!runId || actions.busy(`terminate:${runId}`)}
                    onClick={() => actions.onTerminateRun(runId)}
                    data-testid={`hermes-kanban-terminate-run-${runId || i}`}
                  >
                    Terminate native run
                  </button>
                  <button
                    type="button"
                    disabled={actions.busy('reclaim')}
                    onClick={actions.onReclaim}
                    data-testid="hermes-kanban-reclaim-task"
                  >
                    Reclaim native task
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>
            {currentWorkerLabel ? `Last submission: ${currentWorkerLabel}` : 'No running worker.'}
          </div>
        )}
        <div style={{ fontSize: 9, color: GRAPH_THEME.surface.mutedText, marginTop: 4 }}>
          Run data is the native <code>kanban show --json</code> runs list.
        </div>
      </Section>
      <Section title="Comments">
        {taskShow.comments.length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No comments.</div>
        ) : (
          taskShow.comments.map((c, i) => (
            <div
              key={i}
              data-testid="hermes-kanban-activity-comment"
              style={{
                padding: '7px 8px',
                margin: '0 0 6px',
                borderRadius: 8,
                background: 'rgba(11,14,18,0.55)',
                border: '1px solid rgba(126,232,226,0.1)',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: '#7DE0DA' }}>
                {c.author || 'unknown'} <span style={{ color: GRAPH_THEME.surface.mutedText, fontWeight: 400 }}>· {fmtEpoch(c.created_at)}</span>
              </div>
              <pre style={{ margin: '4px 0 0', fontSize: 10, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: GRAPH_THEME.surface.text }}>
                {c.body}
              </pre>
            </div>
          ))
        )}
      </Section>
      <Section title="Task Events">
        {taskShow.events.length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No events recorded.</div>
        ) : (
          taskShow.events.map((e, i) => (
            <div
              key={i}
              data-testid="hermes-kanban-activity-event"
              style={{
                padding: '5px 7px',
                fontSize: 10,
                borderBottom: '1px solid rgba(167,176,186,0.1)',
                display: 'flex',
                gap: 6,
                alignItems: 'baseline',
              }}
            >
              <span style={{ color: '#F2A64A', fontWeight: 700, flexShrink: 0 }}>{e.kind}</span>
              <span style={{ color: GRAPH_THEME.surface.mutedText, flexShrink: 0 }}>{fmtEpoch(e.created_at)}</span>
              <span style={{ color: GRAPH_THEME.surface.text, wordBreak: 'break-word', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {Object.entries(e.payload || {})
                  .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                  .join(' ')}
              </span>
            </div>
          ))
        )}
      </Section>
      <Section title="Runs">
        {taskShow.runs.length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No runs recorded.</div>
        ) : (
          taskShow.runs.map((r, i) => (
            <div key={i} data-testid="hermes-kanban-activity-run-row" style={{ fontSize: 10, color: GRAPH_THEME.surface.text, padding: '4px 0', borderBottom: '1px solid rgba(167,176,186,0.1)' }}>
              <span style={{ color: GRAPH_THEME.surface.mutedText }}>{String(r.run_id || r.id || 'run')}</span>
              {' — '}
              {String(r.status || '?')}
              {r.outcome ? ` · ${String(r.outcome)}` : ''}
              {r.exit_code !== undefined && r.exit_code !== null ? ` · exit ${String(r.exit_code)}` : ''}
            </div>
          ))
        )}
      </Section>
    </div>
  );
}

export function ResultTab({ taskShow }: { taskShow: KanbanShow }) {
  const { task } = taskShow;
  return (
    <div>
      <Section title="Result">
        <pre
          data-testid="hermes-kanban-result-body"
          style={{
            margin: 0,
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: GRAPH_THEME.surface.text,
            background: 'rgba(11,14,18,0.5)',
            border: '1px solid rgba(126,232,226,0.12)',
            borderRadius: 8,
            padding: '8px 9px',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {(task.result || '').trim() || '(no result recorded)'}
        </pre>
      </Section>
      {taskShow.latest_summary ? (
        <Section title="Handoff summary">
          <pre
            data-testid="hermes-kanban-latest-summary"
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: GRAPH_THEME.surface.mutedText,
            }}
          >
            {taskShow.latest_summary}
          </pre>
        </Section>
      ) : null}
      <Section title="Block / error reason">
        <pre
          data-testid="hermes-kanban-block-reason"
          style={{
            margin: 0,
            fontSize: 10,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: task.status === 'blocked' ? '#E06C6C' : GRAPH_THEME.surface.mutedText,
          }}
        >
          {/* Block/error reasons surface as event payloads / comments. */}
          {(taskShow.events
            .filter((e) => /block|error|fail/i.test(e.kind))
            .map((e) => `${fmtEvt(e)}`)
            .join('\n') || '(none recorded)')}
        </pre>
      </Section>
      <Section title="Artifacts / output refs">
        {task.workspace_path ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.text, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word', marginBottom: 4 }}>
            workspace: {task.workspace_path}
          </div>
        ) : null}
        {task.branch_name ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.text, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word', marginBottom: 4 }}>
            branch: {task.branch_name}
          </div>
        ) : null}
        {task.session_id ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.text, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word', marginBottom: 4 }}>
            session: {task.session_id}
          </div>
        ) : null}
        {(task.skills || []).length > 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, marginTop: 4 }}>
            skills: {task.skills.join(', ')}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function fmtEvt(e: { kind: string; created_at: number | null; payload: Record<string, unknown> }): string {
  const extra = Object.entries(e.payload || {})
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  return `${e.kind}${extra ? ` (${extra})` : ''}`;
}

export function WorkerTab({
  run,
  task,
  childTaskIds,
  events,
  actions,
}: {
  run: Record<string, unknown> | null;
  task: KanbanTask;
  childTaskIds: string[];
  events: KanbanShow['events'];
  actions: TaskTabActions;
}) {
  const runEvents = run?.run_id
    ? events.filter((e) => e.run_id === run.run_id)
    : events;
  const started = Number((run && (run.started_at as number)) ?? 0) || null;
  const toolEvents = runEvents.filter((e) => /tool|call/i.test(e.kind));
  return (
    <div>
      <Section title="Worker">
        {run ? (
          <Field label="Worker ID">
            <span data-testid="hermes-kanban-worker-id" style={{ fontSize: 11, color: '#7DE0DA', fontFamily: 'ui-monospace, monospace' }}>
              {String(run.run_id || run.id || 'worker')}
            </span>
          </Field>
        ) : (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No run selected.</div>
        )}
        <Field label="Parent task">
          <span style={{ fontSize: 11, color: GRAPH_THEME.surface.text, fontFamily: 'ui-monospace, monospace' }}>{task.id}</span>
        </Field>
        <Field label="Profile / assignee">
          <span style={{ fontSize: 11, color: GRAPH_THEME.surface.text }}>{String(run?.profile || task.assignee || '—')}</span>
        </Field>
        <Field label="Elapsed">
          <span style={{ fontSize: 11, color: GRAPH_THEME.surface.text }}>{fmtElapsed(started)}</span>
        </Field>
        <Field label="Outcome / exit">
          <span style={{ fontSize: 11, color: GRAPH_THEME.surface.text }}>
            {String(run?.status || '?')}
            {run?.outcome ? ` · ${String(run.outcome)}` : ''}
            {run?.exit_code !== undefined && run?.exit_code !== null ? ` · exit ${String(run.exit_code)}` : ''}
          </span>
        </Field>
      </Section>
      <Section title="Tool Activity">
        {toolEvents.length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No tool events recorded.</div>
        ) : (
          toolEvents.map((e, i) => (
            <div key={i} data-testid="hermes-kanban-worker-tool" style={{ fontSize: 10, color: GRAPH_THEME.surface.text, padding: '3px 0', borderBottom: '1px solid rgba(167,176,186,0.1)' }}>
              {fmtEvt(e)}
            </div>
          ))
        )}
      </Section>
      <Section title="Delegates / children">
        <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>
          {childTaskIds.length === 0 ? 'No child tasks.' : childTaskIds.join(', ')}
        </div>
        <button
          type="button"
          data-testid="hermes-kanban-worker-close"
          onClick={() => actions.onOpenWorker('')}
          style={{ ...graphDrawerButtonStyle({ marginTop: 8 }), color: GRAPH_THEME.surface.mutedText }}
        >
          Back to task
        </button>
      </Section>
    </div>
  );
}
