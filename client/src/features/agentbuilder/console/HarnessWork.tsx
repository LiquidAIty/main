import { useState, type CSSProperties } from 'react';
import type { NativeSessionEvent } from './openClaudeSessionClient';

/**
 * Compact INLINE work for the active Harness turn, shown directly beneath the
 * active assistant message in normal chat (not a separate transcript/pane).
 *
 * Shows only real actions the Harness session emits: tool calls, the actual
 * command when a shell tool runs, returned output, MCP calls/results,
 * permission/action_required (with inline answer controls that resume the same
 * session), and errors. Normal model text is NOT here — it streams into the
 * chat reply. Rows are concise; long real output collapses into an expandable
 * detail. While the turn runs the rows are live; once done they collapse into a
 * single expandable "work" summary. No fabricated lines, no raw event-JSON dump.
 */

export type HarnessWorkProps = {
  events: NativeSessionEvent[];
  busy: boolean;
  pendingQuestion: { promptId: string; question: string; promptType?: string } | null;
  onAnswer: (promptId: string, reply: string) => void;
};

type Tone = 'cmd' | 'tool' | 'mcp' | 'result' | 'error';
type Row = { tone: Tone; label: string; detail?: string };

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function isBashTool(name: string): boolean {
  return /(^|_|:)bash$|(^|_|:)shell$/i.test(name) || name.toLowerCase() === 'bash';
}
function isMcpTool(name: string): boolean {
  return /^mcp__|liquidaity|describe_agent_fabric|execute_visible_flow|project_context/i.test(name);
}

/** First meaningful line of real output, capped — full text stays in `detail`. */
function preview(text: string, cap = 96): string {
  const firstLine = (text.split('\n').find((l) => l.trim().length > 0) ?? '').trim();
  const multi = text.includes('\n') && text.trim().split('\n').length > 1;
  if (firstLine.length > cap) return `${firstLine.slice(0, cap)}…`;
  return multi ? `${firstLine} …` : firstLine;
}

/** Pretty-print real tool args for the expandable detail (never dumped inline). */
function prettyArgs(argsRaw: string): string {
  if (!argsRaw || argsRaw === '{}') return '';
  try {
    return JSON.stringify(JSON.parse(argsRaw), null, 2);
  } catch {
    return argsRaw;
  }
}

function toRows(events: NativeSessionEvent[]): Row[] {
  const rows: Row[] = [];
  for (const e of events) {
    if (e.kind === 'tool_start') {
      const name = asStr((e as { toolName?: unknown }).toolName);
      const argsRaw = asStr((e as { argsJson?: unknown }).argsJson);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsRaw || '{}');
      } catch {
        /* keep raw */
      }
      if (isBashTool(name) && args.command) {
        rows.push({ tone: 'cmd', label: `$ ${asStr(args.command)}` });
      } else {
        rows.push({ tone: isMcpTool(name) ? 'mcp' : 'tool', label: name, detail: prettyArgs(argsRaw) });
      }
    } else if (e.kind === 'tool_result') {
      const out = asStr((e as { output?: unknown }).output);
      if (!out.trim()) continue;
      const isError = Boolean((e as { isError?: unknown }).isError);
      rows.push({ tone: isError ? 'error' : 'result', label: preview(out), detail: out });
    } else if (e.kind === 'error') {
      rows.push({ tone: 'error', label: asStr((e as { message?: unknown }).message) });
    }
    // `permission` is handled live by pendingQuestion; it is transient, not a row.
  }
  return rows;
}

const TONE: Record<Tone, string> = {
  cmd: '#8fb8ff',
  tool: '#8fb8ff',
  mcp: '#7fd6c2',
  result: 'rgba(215,224,234,0.7)',
  error: '#e06c75',
};
const TAG: Record<Tone, string> = {
  cmd: '$',
  tool: '⚙',
  mcp: '⛁',
  result: '↳',
  error: '✕',
};

const wrap: CSSProperties = {
  margin: '2px 0 8px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.5,
};
const pre: CSSProperties = {
  margin: '3px 0 0',
  padding: '6px 8px',
  maxHeight: 200,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  borderRadius: 6,
  background: 'rgba(0,0,0,0.22)',
  color: 'rgba(215,224,234,0.82)',
};

function RowView({ row }: { row: Row }) {
  const color = TONE[row.tone];
  const head = (
    <span>
      <span style={{ opacity: 0.6, marginRight: 6 }}>{TAG[row.tone]}</span>
      {row.label}
    </span>
  );
  if (row.detail && row.detail.trim() && row.detail.trim() !== row.label.trim()) {
    return (
      <details style={{ color }}>
        <summary style={{ cursor: 'pointer', listStyle: 'none', overflowWrap: 'anywhere' }}>{head}</summary>
        <pre style={pre}>{row.detail}</pre>
      </details>
    );
  }
  return <div style={{ color, overflowWrap: 'anywhere' }}>{head}</div>;
}

export default function HarnessWork({ events, busy, pendingQuestion, onAnswer }: HarnessWorkProps) {
  // Completed work collapses by default; the real detail stays one click away.
  const [openLog, setOpenLog] = useState(false);
  const rows = toRows(events);
  if (!busy && rows.length === 0 && !pendingQuestion) return null;

  const rowList = (
    <div data-testid="harness-work-rows">
      {rows.map((r, i) => (
        <RowView key={i} row={r} />
      ))}
      {busy ? <div style={{ color: 'rgba(159,179,200,0.6)' }}>working…</div> : null}
    </div>
  );

  return (
    <div data-testid="harness-work" style={wrap}>
      {busy ? (
        // Live: latest action visible, earlier completed actions compact above.
        rowList
      ) : rows.length > 0 ? (
        // Done: transient rows collapse into one expandable summary.
        <details open={openLog} onToggle={(e) => setOpenLog((e.target as HTMLDetailsElement).open)}>
          <summary style={{ color: 'rgba(159,179,200,0.6)', cursor: 'pointer', listStyle: 'none' }}>
            {openLog ? '▾ work' : `▸ work (${rows.length})`}
          </summary>
          {rowList}
        </details>
      ) : null}

      {pendingQuestion ? (
        <div data-testid="harness-work-question" style={{ marginTop: 6 }}>
          <div style={{ color: '#f0a35e', marginBottom: 4 }}>{pendingQuestion.question}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="harness-answer-yes"
              onClick={() => onAnswer(pendingQuestion.promptId, 'yes')}
            >
              Yes
            </button>
            <button
              type="button"
              data-testid="harness-answer-no"
              onClick={() => onAnswer(pendingQuestion.promptId, 'no')}
            >
              No
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
