import { useState, type CSSProperties } from 'react';
import type { NativeSessionEvent } from './openClaudeSessionClient';

/**
 * Compact INLINE work for the active Harness turn, shown directly beneath the
 * active assistant message in normal chat (not a separate transcript/pane).
 *
 * Shows only real actions the Harness session emits: tool calls, the actual
 * command when a shell/code tool runs, returned output, MCP calls/results,
 * permission/action_required (with inline Yes/No that resumes the same session),
 * and errors. Normal model text is NOT here — it streams into the chat reply.
 * While the turn runs the work is visible; once done it collapses naturally.
 * No fabricated lines.
 */

export type HarnessWorkProps = {
  events: NativeSessionEvent[];
  busy: boolean;
  pendingQuestion: { promptId: string; question: string; promptType?: string } | null;
  onAnswer: (promptId: string, reply: string) => void;
};

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function isBashTool(name: string): boolean {
  return /(^|_|:)bash$|(^|_|:)shell$/i.test(name) || name.toLowerCase() === 'bash';
}

type Line = { tone: 'cmd' | 'tool' | 'result' | 'error' | 'meta'; text: string };

function toLines(events: NativeSessionEvent[]): Line[] {
  const lines: Line[] = [];
  for (const e of events) {
    if (e.kind === 'tool_start') {
      const name = asStr((e as { toolName?: unknown }).toolName);
      const argsRaw = asStr((e as { argsJson?: unknown }).argsJson);
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsRaw || '{}'); } catch { /* keep raw */ }
      if (isBashTool(name) && args.command) lines.push({ tone: 'cmd', text: `$ ${asStr(args.command)}` });
      else lines.push({ tone: 'tool', text: `${name}${argsRaw && argsRaw !== '{}' ? ` ${argsRaw}` : ''}` });
    } else if (e.kind === 'tool_result') {
      const out = asStr((e as { output?: unknown }).output);
      if (out.trim()) lines.push({ tone: (e as { isError?: unknown }).isError ? 'error' : 'result', text: out });
    } else if (e.kind === 'permission') {
      lines.push({ tone: 'meta', text: asStr((e as { question?: unknown }).question) });
    } else if (e.kind === 'error') {
      lines.push({ tone: 'error', text: asStr((e as { message?: unknown }).message) });
    }
  }
  return lines;
}

const TONE: Record<Line['tone'], string> = {
  cmd: '#8fb8ff',
  tool: '#8fb8ff',
  result: 'rgba(215,224,234,0.7)',
  error: '#e06c75',
  meta: '#f0a35e',
};

const wrap: CSSProperties = {
  margin: '2px 0 8px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.5,
};

export default function HarnessWork({ events, busy, pendingQuestion, onAnswer }: HarnessWorkProps) {
  const [open, setOpen] = useState(true);
  const lines = toLines(events);
  if (!busy && lines.length === 0 && !pendingQuestion) return null;

  const lineList = (
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {lines.map((l, i) => (
        <div key={i} style={{ color: TONE[l.tone], paddingLeft: l.tone === 'result' ? 10 : 0 }}>
          {l.text}
        </div>
      ))}
      {busy ? <div style={{ color: 'rgba(159,179,200,0.6)' }}>working…</div> : null}
    </div>
  );

  return (
    <div data-testid="harness-work" style={wrap}>
      {busy ? (
        lineList
      ) : (
        <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ color: 'rgba(159,179,200,0.6)', cursor: 'pointer', listStyle: 'none' }}>
            {open ? '▾ work' : `▸ work (${lines.length})`}
          </summary>
          {lineList}
        </details>
      )}

      {pendingQuestion ? (
        <div data-testid="harness-work-question" style={{ marginTop: 6 }}>
          <div style={{ color: '#f0a35e', marginBottom: 4 }}>{pendingQuestion.question}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" data-testid="harness-answer-yes" onClick={() => onAnswer(pendingQuestion.promptId, 'yes')}>
              Yes
            </button>
            <button type="button" data-testid="harness-answer-no" onClick={() => onAnswer(pendingQuestion.promptId, 'no')}>
              No
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
