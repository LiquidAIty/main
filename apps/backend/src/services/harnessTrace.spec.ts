import { describe, expect, it } from 'vitest';
import { formatHarnessTrace, redactTrace } from './harnessTrace';

const CORR = 'req_abc12345';

describe('formatHarnessTrace — only real events, concise, with correlation id', () => {
  it('formats a real tool_start with the actual tool name + correlation id', () => {
    expect(formatHarnessTrace({ kind: 'tool_start', toolName: 'mcp__liquidaity__thinkgraph_get_graph_slice' }, CORR))
      .toBe(`[tool] mcp__liquidaity__thinkgraph_get_graph_slice started corr=${CORR}`);
  });

  it('maps a card-run tool call to an [agent] doorway line', () => {
    expect(formatHarnessTrace({ kind: 'tool_start', toolName: 'mcp__liquidaity__card_run_assistant_agent' }, CORR))
      .toBe(`[agent] card doorway started corr=${CORR}`);
  });

  it('distinguishes completed vs failed tool_result', () => {
    expect(formatHarnessTrace({ kind: 'tool_result', toolName: 'run_mag_one', isError: false }, CORR))
      .toBe(`[tool] run_mag_one completed corr=${CORR}`);
    expect(formatHarnessTrace({ kind: 'tool_result', toolName: 'run_mag_one', isError: true }, CORR))
      .toBe(`[tool] run_mag_one failed corr=${CORR}`);
  });

  it('reports an error with a redacted reason', () => {
    const line = formatHarnessTrace({ kind: 'error', message: 'auth failed key=sk-abcdefghijklmnop tail' }, CORR);
    expect(line).toContain(`[result] failed corr=${CORR}`);
    expect(line).not.toContain('sk-abcdefghijklmnop');
    expect(line).toContain('<redacted>');
  });

  it('ignores noisy / non-lifecycle events (no fabricated lines)', () => {
    expect(formatHarnessTrace({ kind: 'text', text: 'hello world' }, CORR)).toBeNull();
    expect(formatHarnessTrace({ kind: 'done', fullText: 'the whole answer' }, CORR)).toBeNull();
    expect(formatHarnessTrace({ kind: 'session', sessionId: 'mag1:p:c' }, CORR)).toBeNull();
    expect(formatHarnessTrace({ kind: 'made_up_event' }, CORR)).toBeNull();
  });

  it('never prints full model output (done text is dropped, not echoed)', () => {
    expect(formatHarnessTrace({ kind: 'done', fullText: 'SECRET WHOLE ANSWER TEXT' }, CORR)).toBeNull();
  });
});

describe('redactTrace', () => {
  it('masks provider keys / bearer tokens and bounds length', () => {
    expect(redactTrace('Bearer sk-ABCDEFGHIJKLMNOP')).not.toContain('sk-ABCDEFGHIJKLMNOP');
    expect(redactTrace('x'.repeat(500)).length).toBeLessThanOrEqual(200);
  });
});
