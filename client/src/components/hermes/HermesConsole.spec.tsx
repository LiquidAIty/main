// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import HermesConsole, {
  EMPTY_HERMES_TERMINAL_STATE,
  reduceHermesTerminalEvent,
  type HermesTerminalState,
  type HermesStreamEvent,
} from './HermesConsole';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLElement[] = [];

async function render(node: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

function reduce(events: HermesStreamEvent[]): HermesTerminalState {
  return events.reduce(reduceHermesTerminalEvent, EMPTY_HERMES_TERMINAL_STATE);
}

const START: HermesStreamEvent = {
  kind: 'tool_start',
  toolName: 'Agent',
  toolUseId: 'agent-call-1',
  argsJson: JSON.stringify({
    subagent_type: 'card_hermes_steward',
    description: 'Find project gaps',
    prompt: 'Read ThinkGraph and identify three gaps.',
  }),
};

describe('Hermes native child terminal', () => {
  it('accepts only the matching Hermes invocation and retains text delta order', () => {
    const state = reduce([
      {
        kind: 'tool_start',
        toolName: 'Agent',
        toolUseId: 'other-agent',
        argsJson: JSON.stringify({ subagent_type: 'card_local_coder', prompt: 'code' }),
      },
      START,
      {
        kind: 'progress',
        parentToolUseId: 'other-agent',
        data: { type: 'agent_text_delta', agentType: 'card_hermes_steward', text: 'wrong' },
      },
      {
        kind: 'progress',
        parentToolUseId: 'agent-call-1',
        data: { type: 'agent_text_delta', agentType: 'card_hermes_steward', text: 'First ' },
      },
      {
        kind: 'progress',
        parentToolUseId: 'agent-call-1',
        data: { type: 'agent_text_delta', agentType: 'card_hermes_steward', text: 'second.' },
      },
    ]);

    expect(state.invocationId).toBe('agent-call-1');
    expect(state.objective).toBe('Read ThinkGraph and identify three gaps.');
    expect(state.responseText).toBe('First second.');
  });

  it('keeps child tool events intact and structurally scoped to Hermes', () => {
    const state = reduce([
      START,
      {
        kind: 'tool_start',
        toolName: 'mcp__liquidaity__thinkgraph_get_graph_slice',
        toolUseId: 'graph-read',
        invokingCardId: 'card_hermes_steward',
      },
      {
        kind: 'tool_start',
        toolName: 'mcp__liquidaity__codegraph_search',
        toolUseId: 'not-hermes',
        invokingCardId: 'card_main_chat',
      },
      {
        kind: 'tool_result',
        toolName: 'mcp__liquidaity__thinkgraph_get_graph_slice',
        toolUseId: 'graph-read',
        output: '{"ok":true}',
        isError: false,
      },
    ]);

    expect(state.childToolUseIds).toEqual(['graph-read']);
    expect(state.activity.map((entry) => entry.text)).toEqual([
      'mcp__liquidaity__thinkgraph_get_graph_slice started',
      'mcp__liquidaity__thinkgraph_get_graph_slice completed',
    ]);
  });

  it('reconciles the final Agent result once instead of duplicating streamed prose', () => {
    const state = reduce([
      START,
      {
        kind: 'progress',
        parentToolUseId: 'agent-call-1',
        data: { type: 'agent_text_delta', agentType: 'card_hermes_steward', text: 'Three gaps.' },
      },
      {
        kind: 'tool_result',
        toolName: 'Agent',
        toolUseId: 'agent-call-1',
        output: 'Three gaps.\n<usage>tool_uses: 1</usage>',
        isError: false,
      },
    ]);

    expect(state.status).toBe('completed');
    expect(state.responseText.match(/Three gaps\./g)).toHaveLength(1);
    expect(state.responseText).toContain('<usage>tool_uses: 1</usage>');
  });

  it('shows failure honestly and resets on the next Hermes invocation', () => {
    const failed = reduce([
      START,
      { kind: 'error', code: 'harness_turn_timeout', message: 'harness_turn_timeout:120000' },
    ]);
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('harness_turn_timeout:120000');

    const reset = reduceHermesTerminalEvent(failed, {
      ...START,
      toolUseId: 'agent-call-2',
      argsJson: JSON.stringify({ subagent_type: 'card_hermes_steward', prompt: 'Try again.' }),
    });
    expect(reset).toMatchObject({
      invocationId: 'agent-call-2',
      objective: 'Try again.',
      status: 'running',
      responseText: '',
      error: null,
    });
  });

  it('renders the live objective, activity, and response without polling', async () => {
    const terminal = reduce([
      START,
      {
        kind: 'tool_start',
        toolName: 'mcp__liquidaity__thinkgraph_get_graph_slice',
        toolUseId: 'graph-read',
        invokingCardId: 'card_hermes_steward',
      },
      {
        kind: 'progress',
        parentToolUseId: 'agent-call-1',
        data: { type: 'agent_text_delta', agentType: 'card_hermes_steward', text: 'Gap one.' },
      },
    ]);
    const host = await render(<HermesConsole terminal={terminal} />);

    expect(host.querySelector('[data-testid="hermes-terminal-status"]')?.textContent).toBe('running');
    expect(host.querySelector('[data-testid="hermes-terminal-objective"]')?.textContent).toContain(
      'Read ThinkGraph and identify three gaps.',
    );
    expect(host.querySelector('[data-testid="hermes-terminal-activity"]')?.textContent).toContain(
      'thinkgraph_get_graph_slice started',
    );
    expect(host.querySelector('[data-testid="hermes-terminal-response"]')?.textContent).toBe('Gap one.');
  });
});
